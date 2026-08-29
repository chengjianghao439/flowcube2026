const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode, generateMasterCode } = require('../../utils/codeGenerator')
const engine = require('../accounting/voucher-engine')
const { SOURCE_TYPES, DIR } = require('../../constants/voucherSource')
const { normalizePagination } = require('../../utils/pagination')

/**
 * 固定资产（文档10 完整会计准则 · 固定资产折旧）。
 *
 * 卡片 → 按月计提折旧（直线法）→ 处置/报废。凭证走 voucher-engine（source_type =
 * asset_acquire/asset_depreciation/asset_disposal），只读本模块表、只写 acct_*。
 *
 * 折旧口径：月折旧额 = round2(原值×(1−残值率)/使用月数)；购置当月开始计提；
 * 已提足（累计折旧达到原值−残值）停提；处置当期计提最后一期后停提。
 */

const STATUS = { USING: 1, FULLY_DEPRECIATED: 2, DISPOSED: 3 }
const DISPOSE_TYPE_LABEL = { 1: '出售', 2: '报废' }

function fmtAsset(r) {
  return {
    id: Number(r.id),
    assetNo: r.asset_no,
    assetName: r.asset_name,
    category: r.category,
    departmentId: r.department_id != null ? Number(r.department_id) : null,
    departmentName: r.department_name,
    acquireDate: r.acquire_date,
    originalCost: Number(r.original_cost),
    residualRate: Number(r.residual_rate),
    usefulMonths: Number(r.useful_months),
    deprMethod: Number(r.depr_method),
    status: Number(r.status),
    disposeDate: r.dispose_date,
    disposeType: r.dispose_type != null ? Number(r.dispose_type) : null,
    disposeTypeName: r.dispose_type != null ? DISPOSE_TYPE_LABEL[r.dispose_type] : null,
    disposeIncome: r.dispose_income != null ? Number(r.dispose_income) : null,
    isActive: !!r.is_active,
    remark: r.remark,
    // 派生：月折旧额、已计提期数、累计折旧、账面净值
    monthlyDepr: Number(r.monthly_depr || 0),
    periodsDepreciated: Number(r.periods_depreciated || 0),
    accumDepr: Number(r.accum_depr || 0),
    netBookValue: Number(r.net_book_value || 0),
    createdAt: r.created_at,
  }
}

const MONTHLY_DEPR_SQL = `(CASE WHEN fa.useful_months > 0
  THEN ROUND(fa.original_cost * (1 - fa.residual_rate) / fa.useful_months, 2) ELSE 0 END)`

/** 校验会计期间未结账（固定资产模块内联，带 company_id，acct_periods 主键已改 (company_id,period)） */
async function assertPeriodOpenInline(conn, companyId, period) {
  const [[row]] = await conn.query('SELECT status FROM acct_periods WHERE company_id = ? AND period = ?', [Number(companyId) || 1, period])
  if (row && Number(row.status) === 2) {
    throw new AppError(`会计期间 ${period} 已结账，凭证不可变动；如需调整请先反结账`, 409, 'ACCT_PERIOD_CLOSED')
  }
}

async function listAssets({ page = 1, pageSize = 20, keyword = '', status = '', companyId = 1 }) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['fa.deleted_at IS NULL', 'fa.company_id = ?']
  const params = [Number(companyId) || 1]
  if (status) { conds.push('fa.status = ?'); params.push(Number(status)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(fa.asset_no LIKE ? OR fa.asset_name LIKE ? OR fa.category LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`) }
  const where = `WHERE ${conds.join(' AND ')}`

  const [rows] = await pool.query(
    `SELECT fa.*,
            ${MONTHLY_DEPR_SQL} AS monthly_depr,
            COALESCE(d.periods_depreciated, 0) AS periods_depreciated,
            COALESCE(d.accum_depr, 0) AS accum_depr,
            ROUND(fa.original_cost - COALESCE(d.accum_depr, 0), 2) AS net_book_value
     FROM fixed_assets fa
     LEFT JOIN (
       SELECT asset_id, COUNT(*) AS periods_depreciated, SUM(monthly_amount) AS accum_depr
       FROM fixed_asset_depr GROUP BY asset_id
     ) d ON d.asset_id = fa.id
     ${where}
     ORDER BY fa.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM fixed_assets fa ${where}`, params)
  return { list: rows.map(fmtAsset), pagination: { page: p, pageSize: ps, total } }
}

async function findAsset(id, companyId = 1) {
  const [[row]] = await pool.query(
    `SELECT fa.*,
            ${MONTHLY_DEPR_SQL} AS monthly_depr,
            COALESCE(d.periods_depreciated, 0) AS periods_depreciated,
            COALESCE(d.accum_depr, 0) AS accum_depr,
            ROUND(fa.original_cost - COALESCE(d.accum_depr, 0), 2) AS net_book_value
     FROM fixed_assets fa
     LEFT JOIN (
       SELECT asset_id, COUNT(*) AS periods_depreciated, SUM(monthly_amount) AS accum_depr
       FROM fixed_asset_depr GROUP BY asset_id
     ) d ON d.asset_id = fa.id
     WHERE fa.id = ? AND fa.company_id = ? AND fa.deleted_at IS NULL`,
    [Number(id), Number(companyId) || 1],
  )
  if (!row) throw new AppError('固定资产不存在', 404)
  const detail = fmtAsset(row)
  const [deprRows] = await pool.query(
    'SELECT * FROM fixed_asset_depr WHERE asset_id = ? ORDER BY period ASC', [Number(id)],
  )
  detail.deprHistory = deprRows.map(d => ({
    id: Number(d.id), period: d.period, deprDate: d.depr_date,
    monthlyAmount: Number(d.monthly_amount), accumAmount: Number(d.accum_amount),
    isDisposal: !!d.is_disposal,
  }))
  return detail
}

/** 新增固定资产卡片。校验：原值>0、残值率 0-1、年限>0、购置日期有效。 */
async function createAsset({ assetName, category, departmentId, departmentName, acquireDate, originalCost, residualRate, usefulMonths, remark }, operator, companyId = 1) {
  const cost = Number(originalCost)
  if (!String(assetName || '').trim()) throw new AppError('请填写资产名称', 400)
  if (!Number.isFinite(cost) || cost <= 0) throw new AppError('原值必须大于 0', 400)
  const rate = residualRate == null || residualRate === '' ? 0.05 : Number(residualRate)
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) throw new AppError('残值率须在 [0,1) 之间', 400)
  const months = Number(usefulMonths)
  if (!Number.isInteger(months) || months <= 0) throw new AppError('使用年限必须为正整数（月）', 400)
  if (!String(acquireDate || '').match(/^\d{4}-\d{2}-\d{2}$/)) throw new AppError('请填写有效的购置日期', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const assetNo = await generateMasterCode(conn, '固', 'fixed_assets', 'asset_no')
    const [r] = await conn.query(
      `INSERT INTO fixed_assets
        (company_id, asset_no, asset_name, category, department_id, department_name, acquire_date, original_cost, residual_rate, useful_months, depr_method, remark, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      [Number(companyId) || 1, assetNo, String(assetName).trim(), category || null,
        departmentId ? Number(departmentId) : null, departmentName || null,
        acquireDate, cost, rate, months, remark || null, operator?.userId ?? null, operator?.realName ?? null],
    )
    await conn.commit()
    return { id: r.insertId, assetNo }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 计提折旧：跑某期间（默认当前月），对「使用中且该期间应计提」的卡片生成折旧台账 + 凭证。 */
async function runDepreciation({ period, companyId = 1 }, operator) {
  const p = String(period || '').slice(0, 6)
  if (!/^\d{6}$/.test(p)) throw new AppError('请提供有效的计提期间 YYYYMM', 400)
  const cid = Number(companyId) || 1

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 该期间必须未结账（事务内，带 company_id）
    await assertPeriodOpenInline(conn, cid, p)
    const accountMap = await engine.loadAccountMap(conn, cid)
    const allocSeq = await engine.makeSeqAllocator(conn, cid)

    // 取使用中卡片；判断「该期间是否应计提」：购置期间 <= 目标期间，且未处置（或处置期 >= 目标期间）
    const [assets] = await conn.query(
      `SELECT * FROM fixed_assets
        WHERE company_id = ? AND status = 1 AND deleted_at IS NULL
          AND DATE_FORMAT(acquire_date, '%Y%m') <= ?
          AND (dispose_date IS NULL OR DATE_FORMAT(dispose_date, '%Y%m') >= ?)`,
      [cid, p, p],
    )
    const results = { period: p, ran: 0, skipped: 0, vouchers: [] }
    for (const fa of assets) {
      const monthly = engine.round2(Number(fa.original_cost) * (1 - Number(fa.residual_rate)) / Number(fa.useful_months))
      if (monthly <= 0) { results.skipped += 1; continue }

      // 已提期数（台账 count）与累计已提
      const [[agg]] = await conn.query(
        'SELECT COUNT(*) AS n, COALESCE(SUM(monthly_amount),0) AS accum FROM fixed_asset_depr WHERE asset_id = ?',
        [fa.id],
      )
      const accum = engine.round2(Number(agg.accum))
      const totalDepr = engine.round2(Number(fa.original_cost) * (1 - Number(fa.residual_rate)))
      // 已提足 → 停提（状态 2）。用「已提累计 >= 应提总额 - 1e-6」判断，而不是 accum+monthly 提前停：
      // 旧写法 accum+monthly >= totalDepr-0.01 会在「提满前一期」就停，最后一个月折旧永远漏提，
      // 累计折旧恒低于原值−残值、账面净值虚高（审计 2026-08-30）。
      if (accum >= totalDepr - 1e-6) {
        await conn.query('UPDATE fixed_assets SET status = 2 WHERE id = ?', [fa.id])
        results.skipped += 1
        continue
      }

      // 处置当期：处置日期所在期间 == 目标期间 → 提最后一期
      const isDisposalPeriod = fa.dispose_date != null && String(fa.dispose_date).slice(0, 6) === p
      // 最后一期：若本期计提后超过应提总额，差额计提（clamp 到 totalDepr），避免累计折旧超过「原值−残值」
      const lastPeriodMonthly = engine.round2(totalDepr - accum)
      const actualMonthly = lastPeriodMonthly < monthly ? lastPeriodMonthly : monthly
      const newAccum = engine.round2(accum + actualMonthly)

      // 台账行（UNIQUE(asset_id, period) 幂等）
      await conn.query(
        `INSERT INTO fixed_asset_depr (company_id, asset_id, period, depr_date, monthly_amount, accum_amount, is_disposal, created_by)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE monthly_amount=VALUES(monthly_amount), accum_amount=VALUES(accum_amount), is_disposal=VALUES(is_disposal)`,
        [cid, fa.id, p, `${p.slice(0,4)}-${p.slice(4,6)}-28`, actualMonthly, newAccum, isDisposalPeriod ? 1 : 0, operator?.userId ?? null],
      )
      const [[deprRow]] = await conn.query(
        'SELECT id FROM fixed_asset_depr WHERE asset_id = ? AND period = ?', [fa.id, p],
      )

      // 凭证：借 折旧费用(660203) / 贷 累计折旧(1602)
      const spec = {
        sourceType: SOURCE_TYPES.ASSET_DEPRECIATION,
        sourceId: Number(deprRow.id),
        sourceNo: fa.asset_no,
        summary: `固定资产折旧 ${fa.asset_name}（${p}）`,
        voucherDate: `${p.slice(0,4)}-${p.slice(4,6)}-28`,
        legs: [
          { code: '660203', direction: DIR.DEBIT, amount: monthly, summary: `${fa.asset_name} 折旧`, auxId: fa.department_id != null ? Number(fa.department_id) : null, auxName: fa.department_name || null },
          { code: '1602', direction: DIR.CREDIT, amount: monthly, summary: `${fa.asset_name} 累计折旧` },
        ],
      }
      const r = await engine.upsertVoucher(conn, spec, accountMap, allocSeq, operator?.userId ?? null, cid)
      results.ran += 1
      results.vouchers.push({ assetId: Number(fa.id), assetName: fa.asset_name, monthly, voucher: r })

      // 若本期间处置且已提最后一期 → 状态 3（处置标记，处置凭证由 dispose() 生成）
      if (isDisposalPeriod) {
        await conn.query('UPDATE fixed_assets SET status = 3 WHERE id = ?', [fa.id])
      }
    }
    await conn.commit()
    return results
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 处置/报废：生成处置单 + 处置凭证（净值→清理→收入/费用→处置损益），并做处置当期计提。 */
async function disposeAsset(id, { disposeType, disposeDate, income = 0, expense = 0 }, operator, companyId = 1) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[fa]] = await conn.query(
      'SELECT * FROM fixed_assets WHERE id = ? AND company_id = ? AND deleted_at IS NULL FOR UPDATE',
      [Number(id), Number(companyId) || 1],
    )
    if (!fa) throw new AppError('固定资产不存在', 404)
    if (Number(fa.status) === 3) throw new AppError('该资产已处置，请勿重复操作', 400)
    if (![1, 2].includes(Number(disposeType))) throw new AppError('处置类型无效：1出售 2报废', 400)
    const dDate = String(disposeDate || '')
    if (!dDate.match(/^\d{4}-\d{2}-\d{2}$/)) throw new AppError('请填写处置日期', 400)
    const inc = Number(income) || 0
    const exp = Number(expense) || 0
    const cid = Number(companyId) || 1
    const dPeriod = dDate.slice(0, 4) + dDate.slice(5, 7)

    // 处置期间必须未结账
    await assertPeriodOpenInline(conn, cid, dPeriod)

    // 累计已提（到处置当期之前）+ 处置当期应提（若本期间还没提过）
    const [[agg]] = await conn.query(
      'SELECT COALESCE(SUM(monthly_amount),0) AS accum FROM fixed_asset_depr WHERE asset_id = ?',
      [fa.id],
    )
    let accum = engine.round2(Number(agg.accum))

    // 处置当期还没提 → 提这一期（在台账加一行），否则直接用已有累计
    const [[deprThisPeriod]] = await conn.query(
      'SELECT id FROM fixed_asset_depr WHERE asset_id = ? AND period = ?', [fa.id, dPeriod],
    )
    const accountMap = await engine.loadAccountMap(conn, cid)
    const allocSeq = await engine.makeSeqAllocator(conn, cid)
    if (!deprThisPeriod) {
      const monthly = engine.round2(Number(fa.original_cost) * (1 - Number(fa.residual_rate)) / Number(fa.useful_months))
      accum = engine.round2(accum + monthly)
      await conn.query(
        `INSERT INTO fixed_asset_depr (company_id, asset_id, period, depr_date, monthly_amount, accum_amount, is_disposal, created_by)
         VALUES (?,?,?,?,?,?,1,?)`,
        [cid, fa.id, dPeriod, dDate, monthly, accum, operator?.userId ?? null],
      )
    }

    // 生成处置凭证：借 累计折旧 / 借(贷) 固定资产清理 → 收入 → 结平
    const netBook = engine.round2(Number(fa.original_cost) - accum)
    const disposeNo = await generateDailyCode(conn, '固处', 'fixed_asset_disposals', 'dispose_no')
    const [dr] = await conn.query(
      `INSERT INTO fixed_asset_disposals
        (company_id, dispose_no, asset_id, dispose_date, dispose_type, income, expense, status, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,1,?,?)`,
      [cid, disposeNo, fa.id, dDate, Number(disposeType), inc, exp, operator?.userId ?? null, operator?.realName ?? null],
    )
    // 标准固定资产清理中转分录：
    //   ① 账面转出：借 累计折旧 / 借 固定资产清理(净值) / 贷 固定资产(原值)
    //   ② 收入：借 银行(收入) / 贷 固定资产清理
    //   ③ 费用：借 固定资产清理 / 贷 银行(费用)
    //   ④ 结平：清理科目余额 = 净值 − 收入 + 费用；余额>0 → 损失借 6115 / 贷 1606；<0 → 收益借 1606 / 贷 6115
    const legs = [
      { code: '1602', direction: DIR.DEBIT, amount: accum, summary: `${fa.asset_name} 累计折旧转出` },
      { code: '1606', direction: DIR.DEBIT, amount: netBook, summary: `${fa.asset_name} 账面净值转清理` },
      { code: '1601', direction: DIR.CREDIT, amount: Number(fa.original_cost), summary: `${fa.asset_name} 原值转出` },
    ]
    if (inc > 0) {
      legs.push({ code: '1002', direction: DIR.DEBIT, amount: inc, summary: `${fa.asset_name} 处置收入` })
      legs.push({ code: '1606', direction: DIR.CREDIT, amount: inc, summary: `${fa.asset_name} 处置收入冲减清理` })
    }
    if (exp > 0) {
      legs.push({ code: '1606', direction: DIR.DEBIT, amount: exp, summary: `${fa.asset_name} 清理费用` })
      legs.push({ code: '1002', direction: DIR.CREDIT, amount: exp, summary: `${fa.asset_name} 支付清理费` })
    }
    // 清理科目余额 = 净值 − 收入 + 费用；>0 = 净损失，<0 = 净收益
    const balance = engine.round2(netBook - inc + exp)
    if (balance >= 0) {
      legs.push({ code: '6115', direction: DIR.DEBIT, amount: balance, summary: `${fa.asset_name} 处置净损失` })
      legs.push({ code: '1606', direction: DIR.CREDIT, amount: balance, summary: `${fa.asset_name} 清理科目结平` })
    } else {
      legs.push({ code: '1606', direction: DIR.DEBIT, amount: Math.abs(balance), summary: `${fa.asset_name} 清理科目结平` })
      legs.push({ code: '6115', direction: DIR.CREDIT, amount: Math.abs(balance), summary: `${fa.asset_name} 处置净收益` })
    }
    const spec = {
      sourceType: SOURCE_TYPES.ASSET_DISPOSAL,
      sourceId: Number(dr.insertId),
      sourceNo: disposeNo,
      summary: `固定资产${Number(disposeType) === 1 ? '出售' : '报废'} ${fa.asset_name}`,
      voucherDate: dDate,
      legs,
    }
    const r = await engine.upsertVoucher(conn, spec, accountMap, allocSeq, operator?.userId ?? null, cid)

    await conn.query(
      'UPDATE fixed_assets SET status = 3, dispose_date = ?, dispose_type = ?, dispose_income = ? WHERE id = ?',
      [dDate, Number(disposeType), inc, fa.id],
    )
    await conn.commit()
    return { id: Number(dr.insertId), disposeNo, netBook, gain: balance, voucher: r }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 折旧汇总（按期间，供列表/看板）：计提张数、金额合计 */
async function depreciationSummary({ period, companyId = 1 }) {
  const p = String(period || '').slice(0, 6)
  const cid = Number(companyId) || 1
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(monthly_amount),0) AS total
     FROM fixed_asset_depr WHERE company_id = ? AND (? = '' OR period = ?)`,
    [cid, p, p],
  )
  return { period: p || null, count: Number(row.count), total: Number(row.total) }
}

module.exports = { STATUS, listAssets, findAsset, createAsset, runDepreciation, disposeAsset, depreciationSummary }
