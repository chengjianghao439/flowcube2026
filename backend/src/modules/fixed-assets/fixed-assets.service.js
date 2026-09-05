const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode, generateMasterCode } = require('../../utils/codeGenerator')
const engine = require('../accounting/voucher-engine')
const { SOURCE_TYPES, DIR } = require('../../constants/voucherSource')
const { normalizePagination } = require('../../utils/pagination')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { assertPeriodOpen } = require('../accounting/accounting.period.service')

const dateOnly = value => value instanceof Date ? beijingTodayYmd(value) : value == null ? null : String(value).slice(0, 10)

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
    acquireDate: dateOnly(r.acquire_date),
    originalCost: Number(r.original_cost),
    residualRate: Number(r.residual_rate),
    usefulMonths: Number(r.useful_months),
    deprMethod: Number(r.depr_method),
    status: Number(r.status),
    disposeDate: dateOnly(r.dispose_date),
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
    id: Number(d.id), period: d.period, deprDate: dateOnly(d.depr_date),
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

/**
 * 台账与折旧凭证同事务落地。调用方先锁账套，再锁资产；历史只允许按时间追加，
 * 已有期间重试直接复用，累计与凭证都采用本次实际计提额（末期补差）。
 */
async function depreciateAsset(conn, fa, { period, date, isDisposal = false }, accountMap, allocSeq, operator, companyId) {
  const [history] = await conn.query(
    'SELECT * FROM fixed_asset_depr WHERE asset_id = ? ORDER BY period ASC FOR UPDATE', [fa.id],
  )
  const accum = engine.round2(history.reduce((sum, row) => sum + Number(row.monthly_amount), 0))
  const existing = history.find(row => row.period === period)
  const latest = history.at(-1)?.period
  if (isDisposal && latest && latest > period) {
    throw new AppError('处置期间不能早于已有折旧期间', 409, 'ASSET_DEPRECIATION_ORDER')
  }
  if (existing) return { skipped: true, accum }
  if (latest && latest > period) {
    throw new AppError('不能在已有折旧期间之前补提；请按期间顺序计提', 409, 'ASSET_DEPRECIATION_ORDER')
  }
  const totalDepr = engine.round2(Number(fa.original_cost) * (1 - Number(fa.residual_rate)))
  const remaining = engine.round2(Math.max(0, totalDepr - accum))
  const monthly = engine.round2(Number(fa.original_cost) * (1 - Number(fa.residual_rate)) / Number(fa.useful_months))
  const actualMonthly = Math.min(monthly, remaining)
  if (remaining === 0) {
    await conn.query('UPDATE fixed_assets SET status = 2 WHERE id = ?', [fa.id])
    return { skipped: true, accum }
  }
  if (actualMonthly <= 0) return { skipped: true, accum }
  const newAccum = engine.round2(accum + actualMonthly)
  const [row] = await conn.query(
    `INSERT INTO fixed_asset_depr (company_id, asset_id, period, depr_date, monthly_amount, accum_amount, is_disposal, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [companyId, fa.id, period, date, actualMonthly, newAccum, isDisposal ? 1 : 0, operator?.userId ?? null],
  )
  const voucher = await engine.upsertVoucher(conn, {
    sourceType: SOURCE_TYPES.ASSET_DEPRECIATION,
    sourceId: Number(row.insertId),
    sourceNo: fa.asset_no,
    summary: `固定资产折旧 ${fa.asset_name}（${period}）`,
    voucherDate: date,
    legs: [
      { code: '660203', direction: DIR.DEBIT, amount: actualMonthly, summary: `${fa.asset_name} 折旧`, auxId: fa.department_id != null ? Number(fa.department_id) : null, auxName: fa.department_name || null },
      { code: '1602', direction: DIR.CREDIT, amount: actualMonthly, summary: `${fa.asset_name} 累计折旧` },
    ],
  }, accountMap, allocSeq, operator?.userId ?? null, companyId)
  if (newAccum >= totalDepr) await conn.query('UPDATE fixed_assets SET status = 2 WHERE id = ?', [fa.id])
  return { skipped: false, accum: newAccum, monthly: actualMonthly, voucher }
}

/** 计提折旧：已生成期间幂等跳过，新期间按历史顺序追加。 */
async function runDepreciation({ period, companyId = 1 }, operator) {
  const p = String(period || '')
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 与期间结账共用账套锁，之后按 id 锁资产；处置沿用同一顺序。
    await assertPeriodOpen(conn, p, cid)
    const accountMap = await engine.loadAccountMap(conn, cid)
    const allocSeq = await engine.makeSeqAllocator(conn, cid)
    const [assets] = await conn.query(
      `SELECT * FROM fixed_assets
       WHERE company_id = ? AND status = 1 AND deleted_at IS NULL
         AND DATE_FORMAT(acquire_date, '%Y%m') <= ?
       ORDER BY id ASC FOR UPDATE`,
      [cid, p],
    )
    const results = { period: p, ran: 0, skipped: 0, vouchers: [] }
    for (const fa of assets) {
      const result = await depreciateAsset(conn, fa, {
        period: p, date: `${p.slice(0, 4)}-${p.slice(4, 6)}-28`,
      }, accountMap, allocSeq, operator, cid)
      if (result.skipped) results.skipped += 1
      else {
        results.ran += 1
        results.vouchers.push({ assetId: Number(fa.id), assetName: fa.asset_name, monthly: result.monthly, voucher: result.voucher })
      }
    }
    await conn.commit()
    return results
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 处置/报废：生成处置单 + 处置凭证（净值→清理→收入/费用→处置损益），并做处置当期计提。 */
async function disposeAsset(id, { disposeType, disposeDate, income = 0, expense = 0 }, operator, companyId = 1) {
  const dDate = String(disposeDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dDate)) throw new AppError('请填写处置日期', 400)
  const cid = Number(companyId) || 1
  const dPeriod = dDate.slice(0, 4) + dDate.slice(5, 7)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertPeriodOpen(conn, dPeriod, cid)
    const [[fa]] = await conn.query(
      'SELECT * FROM fixed_assets WHERE id = ? AND company_id = ? AND deleted_at IS NULL FOR UPDATE',
      [Number(id), cid],
    )
    if (!fa) throw new AppError('固定资产不存在', 404)
    if (Number(fa.status) === 3) throw new AppError('该资产已处置，请勿重复操作', 400)
    if (![1, 2].includes(Number(disposeType))) throw new AppError('处置类型无效：1出售 2报废', 400)
    if (dDate < dateOnly(fa.acquire_date)) throw new AppError('处置日期不能早于购置日期', 400)
    const inc = Number(income) || 0
    const exp = Number(expense) || 0
    const accountMap = await engine.loadAccountMap(conn, cid)
    const allocSeq = await engine.makeSeqAllocator(conn, cid)
    const depreciation = await depreciateAsset(conn, fa, {
      period: dPeriod, date: dDate, isDisposal: true,
    }, accountMap, allocSeq, operator, cid)
    const accum = depreciation.accum

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
