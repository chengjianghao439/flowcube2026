/**
 * 会计期末结转与期间锁定（用户 2026-08-09 确认：本系统是正式账）。
 *
 * 规则：
 *  - 期间结账（acct_periods.status=2）后，该期间的凭证禁止新建/红冲/删除/重算生成——要改先反结账。
 *  - 结账前置：当期损益（category 4/5/6）必须已结转到 4103 本年利润，且结转凭证内容与当前业务
 *    重算结果一致（source_hash 比对）——不允许"结转了但之后又来了新业务凭证"的半新不旧状态结账；
 *    12 月 additionally 要求「4103 → 4104 利润分配」的年结凭证同样是最新的。
 *  - 结转凭证走 voucher-engine 的 upsertVoucher（UNIQUE(source_type,source_id) 幂等 + source_hash
 *    跳过未变），与业务凭证同一套语义；损益全零的期间不产生结转凭证（not_required）。
 */
const { excludeClosingReversals } = require('./accounting.report-basis')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { beijingTodayYmd } = require('../../utils/backendTime')
const engine = require('./voucher-engine')
const { SOURCE_TYPES } = require('../../constants/voucherSource')
const { lockAccountingCompany } = require('./accounting.period-lock')

const PERIOD_RE = /^\d{6}$/

function assertPeriodFormat(period) {
  const p = String(period || '')
  if (!PERIOD_RE.test(p)) throw new AppError('会计期间格式应为 YYYYMM', 400)
  const m = Number(p.slice(4, 6))
  if (m < 1 || m > 12) throw new AppError('会计期间月份非法', 400)
  return p
}

function periodRange(period) {
  const p = assertPeriodFormat(period)
  const y = Number(p.slice(0, 4)), m = Number(p.slice(4, 6))
  const start = `${p.slice(0, 4)}-${p.slice(4, 6)}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${p.slice(0, 4)}-${p.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`
  return { start, end, lastDay }
}

/** 期间已结账则抛 409。所有落凭证的写路径都必须先过这道闸。 */
async function assertPeriodOpen(conn, period, companyId = 1) {
  const p = assertPeriodFormat(period)
  await lockAccountingCompany(conn, companyId)
  const [[row]] = await conn.query('SELECT status FROM acct_periods WHERE period = ? AND company_id = ? FOR UPDATE', [p, companyId])
  if (row && Number(row.status) === 2) {
    throw new AppError(`会计期间 ${p} 已结账，凭证不可变动；如需调整请先反结账`, 409, 'ACCT_PERIOD_CLOSED')
  }
}

/** 当期损益类末级科目的本期净额（收入=贷−借；费用=借−贷），用于构造结转分录 */
async function loadPlNets(conn, period, companyId = 1) {
  const { start, end } = periodRange(period)
  const [rows] = await conn.query(
    `SELECT a.code, a.name, a.category, a.balance_dir,
            COALESCE(SUM(CASE WHEN e.direction=1 THEN e.amount END),0) AS d,
            COALESCE(SUM(CASE WHEN e.direction=2 THEN e.amount END),0) AS c
       FROM acct_accounts a
       JOIN acct_voucher_entries e ON e.account_id = a.id
       JOIN acct_vouchers v ON v.id = e.voucher_id
        AND v.voucher_date BETWEEN ? AND ?
        AND v.source_type NOT IN (?, ?) AND ${excludeClosingReversals()}
      WHERE a.company_id = ? AND a.deleted_at IS NULL AND a.is_leaf = 1 AND a.category IN (4, 5, 6)
      GROUP BY a.id, a.code, a.name, a.category, a.balance_dir
      ORDER BY a.code ASC`,
    // INNER JOIN + ON 条件：范围/来源过滤交给 JOIN，行不命中直接不参与——
    // 之前用 LEFT JOIN 时范围外的凭证留成 NULL 行，SUM 照常加进去，等于全期汇总
    [start, end, SOURCE_TYPES.PERIOD_CLOSE, SOURCE_TYPES.PERIOD_CLOSE_Y, companyId],
  )
  return rows.map(r => ({
    code: r.code, name: r.name, category: Number(r.category),
    // 净额统一表达：>0 表示在该科目正常方向上的净发生（收入>0=赚、费用>0=花了）
    net: engine.round2(Number(r.category) === 5 ? Number(r.c) - Number(r.d) : Number(r.d) - Number(r.c)),
  })).filter(r => r.net !== 0)
}

/**
 * 构造某期间的损益结转 spec（收入/费用清零，差额落 4103 本年利润）。
 * 损益全零返回 null（该期间无需结转）。
 */
async function buildPlClosingSpec(conn, period, companyId = 1) {
  const { end } = periodRange(period)
  const nets = await loadPlNets(conn, period, companyId)
  if (!nets.length) return null
  const legs = []
  let profit = 0
  for (const n of nets) {
    // 清零方向：正常方向的净额 → 反方向结平
    legs.push({ code: n.code, direction: n.net > 0 ? (n.category === 5 ? 1 : 2) : (n.category === 5 ? 2 : 1), amount: Math.abs(n.net), summary: `期末结转 ${n.name}` })
    profit += n.category === 5 ? n.net : -n.net
  }
  profit = engine.round2(profit)
  if (profit > 0) legs.push({ code: '4103', direction: 2, amount: profit, summary: '结转本期利润' })
  else if (profit < 0) legs.push({ code: '4103', direction: 1, amount: -profit, summary: '结转本期亏损' })
  // 净利润为零仍须结平非零损益科目；仅省略没有金额的 4103 差额腿。
  return {
    sourceType: SOURCE_TYPES.PERIOD_CLOSE, sourceId: Number(period), sourceNo: `结转-${period}`,
    voucherDate: end, summary: `${period} 期末损益结转`, legs,
  }
}

/**
 * 构造年结 spec（仅 12 月）：4103 本年利润全年净额转 4104 利润分配。
 * 全年净利润 = 4103 贷方−借方（含各月损益结转）；净额为 0 返回 null。
 *
 * 必须排除**年结凭证自身**（2026-09-18 审计 P1）：本函数产出的凭证正是「借 4103 / 贷 4104」，
 * 若把它也算进来，生成后 4103 被自身借方冲平 → profit 变 0 → 返回 null → closingStatus 判为
 * 'stale' → closePeriod 永远拒绝结账（12 月无出路）；人工冲销后原凭证 status=3 又被
 * upsertVoucher 永久跳过，状态反转成 'missing' 继续拒绝。排除后 yspec 在任何状态下都等于
 * 当前应记金额，source_hash 可稳定比对为 current。
 */
async function buildYearClosingSpec(conn, period, companyId = 1) {
  const y = period.slice(0, 4)
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN e.direction=2 THEN e.amount END),0) AS c,
            COALESCE(SUM(CASE WHEN e.direction=1 THEN e.amount END),0) AS d
       FROM acct_voucher_entries e
       JOIN acct_vouchers v ON v.id = e.voucher_id
       JOIN acct_accounts a ON a.id = e.account_id
      WHERE a.code = '4103' AND a.company_id = ? AND a.deleted_at IS NULL
        AND v.source_type <> ? AND ${excludeClosingReversals(true)}
        AND v.voucher_date BETWEEN ? AND ?`,
    [companyId, SOURCE_TYPES.PERIOD_CLOSE_Y, `${y}-01-01`, `${y}-12-31`],
  )
  const profit = engine.round2(Number(row.c) - Number(row.d))
  if (profit === 0) return null
  const legs = profit > 0
    ? [{ code: '4103', direction: 1, amount: profit, summary: '年结转出净利润' },
       { code: '4104', direction: 2, amount: profit, summary: '净利润转入利润分配' }]
    : [{ code: '4104', direction: 1, amount: -profit, summary: '净亏损转入利润分配' },
       { code: '4103', direction: 2, amount: -profit, summary: '年结转出净亏损' }]
  return {
    sourceType: SOURCE_TYPES.PERIOD_CLOSE_Y, sourceId: Number(y), sourceNo: `年结-${y}`,
    voucherDate: `${y}-12-31`, summary: `${y} 年度利润结转`, legs,
  }
}

async function currentClosingVoucher(conn, companyId, sourceType, sourceId) {
  const [[voucher]] = await conn.query(
    `SELECT v.id, v.source_hash, v.status FROM acct_vouchers root
       JOIN acct_vouchers v ON (v.id=root.id OR v.source_root_id=root.id)
        AND v.company_id=root.company_id AND v.is_reversal=0
      WHERE root.company_id=? AND root.source_type=? AND root.source_id=?
      ORDER BY v.id DESC LIMIT 1`, [companyId,sourceType,sourceId])
  return voucher
}

function closingFreshness(spec, voucher) {
  const active = voucher && Number(voucher.status) !== 3
  if (!spec) return active ? 'stale' : 'not_required'
  if (!active) return 'missing'
  return voucher.source_hash === engine.hashSpec(spec.voucherDate,spec.legs) ? 'current' : 'stale'
}

async function closingStatus(conn, period, companyId = 1) {
  const spec = await buildPlClosingSpec(conn,period,companyId)
  const voucher = await currentClosingVoucher(conn,companyId,SOURCE_TYPES.PERIOD_CLOSE,Number(period))
  let year = null
  if (period.endsWith('12')) {
    const yearSpec = await buildYearClosingSpec(conn,period,companyId)
    const yearVoucher = await currentClosingVoucher(conn,companyId,SOURCE_TYPES.PERIOD_CLOSE_Y,Number(period.slice(0,4)))
    year = closingFreshness(yearSpec,yearVoucher)
  }
  return { pl:closingFreshness(spec,voucher), year }
}

/** 结转快照写入（文档10 功能3）：把结转凭证各分录落 acct_closing_details，供追溯。 */
async function writeClosingDetails(conn, companyId, period, closingType, voucherId, legs) {
  for (const l of legs) {
    const amount = engine.round2(l.amount)
    if (amount <= 0) continue
    await conn.query(
      `INSERT INTO acct_closing_details (company_id, period, closing_type, closing_voucher_id, source_account_code, source_account_name, amount, direction)
       VALUES (?,?,?,?,?,?,?,?)`,
      [Number(companyId) || 1, period, closingType, voucherId, l.code, l.summary || l.code, amount, l.direction],
    )
  }
}

/** 生成/重生成某期间的结转凭证（12 月连带年结凭证）。期间已结账则拒。 */
async function generateClosingVouchers(period, userId, companyId = 1) {
  const p = assertPeriodFormat(period)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertPeriodOpen(conn, p, companyId)
    const accountMap = await engine.loadAccountMap(conn, companyId)
    const allocSeq = await engine.makeSeqAllocator(conn, companyId)
    const results = []
    // 年结必须在本月损益结转完成后重读 4103。
    for (const annual of p.endsWith('12') ? [false,true] : [false]) {
      const sourceType = annual ? SOURCE_TYPES.PERIOD_CLOSE_Y : SOURCE_TYPES.PERIOD_CLOSE
      const sourceId = Number(annual ? p.slice(0,4) : p)
      let spec = await (annual ? buildYearClosingSpec : buildPlClosingSpec)(conn,p,companyId)
      if (!spec) {
        const previous = await currentClosingVoucher(conn,companyId,sourceType,sourceId)
        if (!previous || Number(previous.status) === 3) continue
        // 归零仍须冲回最后一版实际分录；保留原凭证、明细及来源锚点供以后追溯。
        spec = {sourceType,sourceId,voucherDate:periodRange(p).end,legs:[]}
      }
      const r = await engine.upsertVoucher(conn,spec,accountMap,allocSeq,userId,companyId)
      if (r.skipped && r.reason === 'reversed') {
        const kind = annual ? '年终结转' : '损益结转'
        throw new AppError(`${p} 的${kind}凭证已人工冲销，请核对冲销记录后处理`,409,
          annual ? 'ACCT_YEAR_CLOSING_VOUCHER_REVERSED' : 'ACCT_CLOSING_VOUCHER_REVERSED',
          {voucherId:r.id, period:p})
      }
      results.push({kind:annual ? '年终结转' : '损益结转',...r})
      if ((r.created || r.updated) && spec.legs.length) {
        await writeClosingDetails(conn,companyId,p,annual ? 'year' : 'pl_month',r.id,spec.legs)
      }
    }
    const status = await closingStatus(conn, p, companyId)
    await conn.commit()
    logger.info(`生成结转凭证 period=${p}`, { userId, results }, 'accounting')
    return { period: p, generated: results.length, results, status }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/** 结账：结转凭证必须是最新的（或本期间无需结转），防止"结完又来新业务"的账面漂移。 */
async function closePeriod(period, operator, companyId = 1) {
  const p = assertPeriodFormat(period)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, companyId)
    await require('./accounting.period-completeness').assertPeriodComplete(conn, p, companyId, engine)
    // First ordinary business snapshot follows the company X gate; no reverse RF/PR locks.
    await require('./voucher-supplier-refunds').assertPeriodCurrent(conn,p,companyId)
    const [[existing]] = await conn.query('SELECT status FROM acct_periods WHERE period = ? AND company_id = ? FOR UPDATE', [p, companyId])
    if (existing && Number(existing.status) === 2) throw new AppError(`会计期间 ${p} 已是结账状态`, 409)
    await engine.assertSalePeriodCurrent(conn, p, companyId)
    const st = await closingStatus(conn, p, companyId)
    const bad = []
    if (st.pl === 'missing') bad.push('损益结转凭证未生成')
    if (st.pl === 'stale') bad.push('损益结转凭证已过期（结转后又有新业务发生）')
    if (st.year === 'missing') bad.push('年终结转凭证未生成')
    if (st.year === 'stale') bad.push('年终结转凭证已过期')
    if (bad.length) {
      throw new AppError(`期间 ${p} 尚不能结账：${bad.join('；')}。请先生成/重新生成结转凭证`, 409, 'ACCT_CLOSING_VOUCHER_REQUIRED')
    }
    await conn.query(
      `INSERT INTO acct_periods (company_id, period, status, closed_by, closed_by_name, closed_at)
       VALUES (?, ?, 2, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE status = 2, closed_by = VALUES(closed_by), closed_by_name = VALUES(closed_by_name), closed_at = NOW()`,
      [companyId, p, operator?.userId ?? null, operator?.realName ?? null],
    )
    await conn.commit()
    logger.info(`结账 period=${p}`, { userId: operator?.userId }, 'accounting')
    return { period: p, status: 2 }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/** 反结账：重新开放期间（要改已结账期间的凭证必须先走这里；留操作日志） */
async function reopenPeriod(period, operator, companyId = 1) {
  const p = assertPeriodFormat(period)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockAccountingCompany(conn, companyId)
    const [[existing]] = await conn.query('SELECT status FROM acct_periods WHERE period = ? AND company_id = ? FOR UPDATE', [p, companyId])
    if (!existing || Number(existing.status) !== 2) throw new AppError(`会计期间 ${p} 未处于结账状态`, 409)
    await conn.query('UPDATE acct_periods SET status = 1 WHERE period = ? AND company_id = ?', [p, companyId])
    await conn.commit()
    logger.info(`反结账 period=${p}`, { userId: operator?.userId }, 'accounting')
    return { period: p, status: 1 }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/** 期间列表：出现过凭证的期间 + 当前期间，带出结账状态与结转凭证新鲜度 */
async function listPeriods(companyId = 1) {
  const [rows] = await pool.query('SELECT DISTINCT period FROM acct_vouchers WHERE company_id = ? ORDER BY period DESC LIMIT 36', [companyId])
  // 当前期间 = 北京时间的 YYYYMM（显式 backendTime，不依赖进程 TZ；历史依赖 TZ=Asia/Shanghai 容器配置）
  const current = beijingTodayYmd().replace(/-/g, '').slice(0, 6)
  const periods = [...new Set([current, ...rows.map(r => r.period)])].sort().reverse()
  const [closedRows] = await pool.query('SELECT period, status, closed_by_name, closed_at FROM acct_periods WHERE company_id = ?', [companyId])
  const stateMap = new Map(closedRows.map(r => [r.period, r]))
  const conn = await pool.getConnection()
  try {
    const list = []
    for (const p of periods) {
      const st = await closingStatus(conn, p, companyId)
      const meta = stateMap.get(p)
      list.push({
        period: p,
        closed: meta ? Number(meta.status) === 2 : false,
        closedByName: meta?.closed_by_name || null,
        closedAt: meta?.closed_at || null,
        closingStatus: st.pl,       // current/stale/missing/not_required
        yearClosingStatus: st.year, // 仅 12 月非 null
      })
    }
    return list
  } finally { conn.release() }
}

module.exports = { assertPeriodOpen, listPeriods, generateClosingVouchers, closePeriod, reopenPeriod, closingStatus }
