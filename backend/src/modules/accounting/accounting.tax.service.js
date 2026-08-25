const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { SOURCE_TYPES } = require('../../constants/voucherSource')

/**
 * 替代报税数据支持（文档10 完整会计准则 · 功能5）。
 *
 * 从会计数据（科目发生额/余额）实时投影报税口径，产出一张"申报表要素"：
 *   - 增值税：销项税额（222102 贷方）/ 进项税额（222101 借方）/ 应纳税额
 *   - 所得税：利润总额（损益科目净额）/ 纳税调整后所得 / 应纳所得税额（25% 可配）
 * 税会差异用手工调整项（tax_filing_adjustments）。不改凭证，纯只读投影 + 可导出。
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function loadAdjustments(companyId, period, taxType) {
  const [rows] = await pool.query(
    'SELECT adjust_item, amount FROM tax_filing_adjustments WHERE company_id=? AND period=? AND tax_type=?',
    [Number(companyId) || 1, period, taxType],
  )
  return rows.map(r => ({ item: r.adjust_item, amount: Number(r.amount) }))
}

/** 科目某期间借/贷发生额（按 company_id + 期间过滤） */
async function accountTurnover(companyId, period, code) {
  const [[row]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN e.direction=1 THEN e.amount END),0) AS d,
       COALESCE(SUM(CASE WHEN e.direction=2 THEN e.amount END),0) AS c
     FROM acct_voucher_entries e
     JOIN acct_vouchers v ON v.id=e.voucher_id
     JOIN acct_accounts a ON a.id=e.account_id
     WHERE a.company_id=? AND a.code=? AND a.deleted_at IS NULL
       AND v.company_id=? AND v.voucher_date BETWEEN ? AND ?`,
    [Number(companyId) || 1, code, Number(companyId) || 1, `${period.slice(0,4)}-${period.slice(4,6)}-01`, `${period.slice(0,4)}-${period.slice(4,6)}-31`],
  )
  return { debit: Number(row.d), credit: Number(row.c) }
}

/** 损益净额（收入贷−借、费用借−贷），= 利润表净利润同口径 */
async function profitAndLoss(companyId, period) {
  const [rows] = await pool.query(
    `SELECT a.category,
       COALESCE(SUM(CASE WHEN e.direction=1 THEN e.amount END),0) AS d,
       COALESCE(SUM(CASE WHEN e.direction=2 THEN e.amount END),0) AS c
     FROM acct_voucher_entries e
     JOIN acct_vouchers v ON v.id=e.voucher_id
        AND v.source_type NOT IN (?, ?)
     JOIN acct_accounts a ON a.id=e.account_id
     WHERE a.company_id=? AND a.is_leaf=1 AND a.category IN (4,5,6) AND a.deleted_at IS NULL
       AND v.company_id=? AND v.voucher_date BETWEEN ? AND ?
     GROUP BY a.category`,
    [SOURCE_TYPES.PERIOD_CLOSE, SOURCE_TYPES.PERIOD_CLOSE_Y, Number(companyId) || 1, Number(companyId) || 1, `${period.slice(0,4)}-${period.slice(4,6)}-01`, `${period.slice(0,4)}-${period.slice(4,6)}-31`],
  )
  let revenue = 0, expense = 0
  for (const r of rows) {
    if (Number(r.category) === 5) revenue += Number(r.c) - Number(r.d)
    else if (Number(r.category) === 4 || Number(r.category) === 6) expense += Number(r.d) - Number(r.c)
  }
  return { revenue: round2(revenue), expense: round2(expense), profit: round2(revenue - expense) }
}

/** 增值税申报要素（简版）：销项 222102 / 进项 222101 / 应纳税额 = max(销项−进项, 0) + 调整 */
async function getVatReport({ companyId = 1, period }) {
  if (!/^\d{6}$/.test(String(period || ''))) throw new AppError('请提供申报期间 YYYYMM', 400)
  const cid = Number(companyId) || 1
  const p = String(period)
  const salesTax = await accountTurnover(cid, p, '222102')
  const inputTax = await accountTurnover(cid, p, '222101')
  const adjustments = await loadAdjustments(cid, p, 1)
  const adjustTotal = round2(adjustments.reduce((s, a) => s + a.amount, 0))
  const sales = round2(salesTax.credit)      // 销项税额 = 贷方发生额
  const input = round2(inputTax.debit)       // 进项税额 = 借方发生额
  const taxDue = round2(Math.max(0, sales - input) + adjustTotal)
  return {
    period: p, companyId: cid,
    salesTaxAmount: sales, inputTaxAmount: input,
    netPayable: round2(sales - input),
    adjustments: adjustments.map(a => ({ ...a })),
    taxDue: Math.max(0, taxDue),
  }
}

/** 所得税申报要素：利润总额 + 调整 = 应纳税所得额 → 25% 应纳所得税额 */
async function getIncomeTaxReport({ companyId = 1, period, taxRate = 0.25 }) {
  if (!/^\d{6}$/.test(String(period || ''))) throw new AppError('请提供申报期间 YYYYMM', 400)
  const cid = Number(companyId) || 1
  const p = String(period)
  const pl = await profitAndLoss(cid, p)
  const adjustments = await loadAdjustments(cid, p, 2)
  const adjustTotal = round2(adjustments.reduce((s, a) => s + a.amount, 0))
  const taxableIncome = round2(Math.max(0, pl.profit + adjustTotal))
  const rate = Number(taxRate) || 0.25
  const taxDue = round2(taxableIncome * rate)
  return {
    period: p, companyId: cid,
    revenue: pl.revenue, expense: pl.expense, profitTotal: pl.profit,
    adjustments: adjustments.map(a => ({ ...a })),
    taxableIncome,
    taxRate: rate,
    taxDue,
  }
}

// ── 调整项 CRUD ────────────────────────────────────────────────────────

async function listAdjustments({ companyId = 1, period, taxType }) {
  const cid = Number(companyId) || 1
  const conds = ['company_id = ?']
  const params = [cid]
  if (period) { conds.push('period = ?'); params.push(String(period)) }
  if (taxType) { conds.push('tax_type = ?'); params.push(Number(taxType)) }
  const [rows] = await pool.query(
    `SELECT * FROM tax_filing_adjustments WHERE ${conds.join(' AND ')} ORDER BY period DESC, tax_type ASC, id ASC`,
    params,
  )
  return rows.map(r => ({
    id: Number(r.id), period: r.period, taxType: Number(r.tax_type),
    adjustItem: r.adjust_item, amount: Number(r.amount), remark: r.remark,
  }))
}

async function upsertAdjustment({ companyId = 1, period, taxType, adjustItem, amount, remark }, operatorId) {
  const cid = Number(companyId) || 1
  if (!/^\d{6}$/.test(String(period || ''))) throw new AppError('请提供期间 YYYYMM', 400)
  if (![1, 2].includes(Number(taxType))) throw new AppError('税种无效：1增值税 2所得税', 400)
  if (!String(adjustItem || '').trim()) throw new AppError('请填写调整项名称', 400)
  await pool.query(
    `INSERT INTO tax_filing_adjustments (company_id, period, tax_type, adjust_item, amount, remark, created_by)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE amount=VALUES(amount), remark=VALUES(remark)`,
    [cid, String(period), Number(taxType), String(adjustItem).trim(), Number(amount) || 0, remark || null, operatorId ?? null],
  )
  return { period: String(period), taxType: Number(taxType), adjustItem: String(adjustItem).trim() }
}

async function removeAdjustment(id, companyId = 1) {
  const [r] = await pool.query(
    'DELETE FROM tax_filing_adjustments WHERE id = ? AND company_id = ?',
    [Number(id), Number(companyId) || 1],
  )
  if (!r.affectedRows) throw new AppError('调整项不存在', 404)
  return { id: Number(id) }
}

module.exports = { getVatReport, getIncomeTaxReport, listAdjustments, upsertAdjustment, removeAdjustment }
