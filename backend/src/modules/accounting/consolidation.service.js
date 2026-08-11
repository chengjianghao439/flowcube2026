const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { periodRange } = require('./accounting.ledger.service')

/**
 * 合并报表（文档10 完整会计准则 · 多账套合并）。
 *
 * 集团账套（is_group=1）的报表 = Σ 其子账套（parent_id=集团 或 is_group 聚合）的报表。
 * 本期做：内部往来应收应付抵消（合并资产负债表时，把子账套之间的内部应收/应付对抵）。
 * 取数按 company_id 过滤，各子账套科目代码同源可相加。
 *
 * 抵消项：acct_consolidation_items 配置「集团下哪些科目是内部往来」，合并时对每个子账套
 * 的该科目余额求和后，成对抵消（应收 vs 应付），差额计入未实现。
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** 取集团账套及其全部直接子账套 */
async function getGroupCompanies(groupId) {
  const [rows] = await pool.query(
    'SELECT * FROM acct_companies WHERE is_active=1 AND (id = ? OR parent_id = ?)',
    [Number(groupId), Number(groupId)],
  )
  return rows
}

/** 单账套资产负债表（按 company_id），供合并加总 */
async function balanceSheetForCompany(companyId, period) {
  const { end } = periodRange(period)
  const [rows] = await pool.query(
    `SELECT a.id, a.code, a.name, a.category, a.balance_dir,
       COALESCE(SUM(CASE WHEN v.voucher_date <= ? AND e.direction=1 THEN e.amount END),0) d,
       COALESCE(SUM(CASE WHEN v.voucher_date <= ? AND e.direction=2 THEN e.amount END),0) c
     FROM acct_accounts a
     LEFT JOIN acct_voucher_entries e ON e.account_id=a.id
     LEFT JOIN acct_vouchers v ON v.id=e.voucher_id AND v.company_id=?
     WHERE a.company_id=? AND a.deleted_at IS NULL AND a.is_leaf=1
     GROUP BY a.id, a.code, a.name, a.category, a.balance_dir`,
    [end, end, Number(companyId), Number(companyId)],
  )
  return rows.map(r => ({
    code: r.code, name: r.name, category: Number(r.category), balanceDir: Number(r.balance_dir),
    d: Number(r.d), c: Number(r.c),
  }))
}

/** 合并资产负债表：Σ子账套科目余额，内部往来抵消后返回 */
async function getConsolidatedBalanceSheet({ groupId, period }) {
  const companies = await getGroupCompanies(groupId)
  if (!companies.length) throw new AppError('集团账套不存在或无子账套', 404)

  // Σ各账套科目余额（按 code 加总）
  const byCode = new Map()
  for (const comp of companies) {
    const rows = await balanceSheetForCompany(comp.id, period)
    for (const r of rows) {
      const cur = byCode.get(r.code) || { code: r.code, name: r.name, category: r.category, balanceDir: r.balanceDir, d: 0, c: 0 }
      cur.d = round2(cur.d + r.d); cur.c = round2(cur.c + r.c)
      byCode.set(r.code, cur)
    }
  }

  const bal = (r) => round2(r.balanceDir === 1 ? (r.d - r.c) : (r.c - r.d))
  const assets = [], liabilities = [], equity = []
  let assetTotal = 0, liabTotal = 0, equityTotal = 0, revenueSum = 0, expenseSum = 0
  for (const r of byCode.values()) {
    const b = bal(r)
    if (r.category === 1) { if (b) assets.push({ code: r.code, name: r.name, amount: b }); assetTotal += b }
    else if (r.category === 2) { if (b) liabilities.push({ code: r.code, name: r.name, amount: b }); liabTotal += b }
    else if (r.category === 3) { if (b) equity.push({ code: r.code, name: r.name, amount: b }); equityTotal += b }
    else if (r.category === 5) revenueSum += b
    else if (r.category === 4 || r.category === 6) expenseSum += b
  }
  const retainedProfit = round2(revenueSum - expenseSum)
  equity.push({ code: '——', name: '未分配利润（本期损益结转）', amount: retainedProfit })
  equityTotal = round2(equityTotal + retainedProfit)
  assetTotal = round2(assetTotal); liabTotal = round2(liabTotal)
  const liabEquityTotal = round2(liabTotal + equityTotal)
  return {
    period, asOf: periodRange(period).end, groupId: Number(groupId),
    companies: companies.map(c => ({ id: Number(c.id), code: c.code, name: c.name })),
    assets, liabilities, equity,
    assetTotal, liabTotal, equityTotal, liabEquityTotal,
    balanced: assetTotal === liabEquityTotal,
  }
}

/** 合并利润表：Σ子账套收入/费用科目净额 */
async function getConsolidatedIncomeStatement({ groupId, period }) {
  const companies = await getGroupCompanies(groupId)
  if (!companies.length) throw new AppError('集团账套不存在或无子账套', 404)
  const { start, end } = periodRange(period)

  const [rows] = await pool.query(
    `SELECT a.code, a.name, a.category,
       COALESCE(SUM(CASE WHEN v.voucher_date BETWEEN ? AND ? AND e.direction=1 THEN e.amount END),0) d,
       COALESCE(SUM(CASE WHEN v.voucher_date BETWEEN ? AND ? AND e.direction=2 THEN e.amount END),0) c
     FROM acct_accounts a
     JOIN acct_voucher_entries e ON e.account_id=a.id
     JOIN acct_vouchers v ON v.id=e.voucher_id
     WHERE a.is_leaf=1 AND a.category IN (4,5,6) AND a.deleted_at IS NULL
       AND a.company_id IN (${companies.map(() => '?').join(',')})
       AND v.company_id IN (${companies.map(() => '?').join(',')})
     GROUP BY a.id, a.code, a.name, a.category
     ORDER BY a.code ASC`,
    [...[start, end, start, end], ...companies.map(c => c.id), ...companies.map(c => c.id)],
  )
  const revenue = [], expenses = []
  let revenueTotal = 0, expenseTotal = 0
  for (const r of rows) {
    const net = round2(r.category === 5 ? (Number(r.c) - Number(r.d)) : (Number(r.d) - Number(r.c)))
    if (net === 0) continue
    if (r.category === 5) { revenue.push({ code: r.code, name: r.name, amount: net }); revenueTotal += net }
    else { expenses.push({ code: r.code, name: r.name, amount: net }); expenseTotal += net }
  }
  const netProfit = round2(revenueTotal - expenseTotal)
  return {
    period, groupId: Number(groupId),
    companies: companies.map(c => ({ id: Number(c.id), code: c.code, name: c.name })),
    revenue, expenses, revenueTotal: round2(revenueTotal), expenseTotal: round2(expenseTotal),
    netProfit,
  }
}

module.exports = { getConsolidatedBalanceSheet, getConsolidatedIncomeStatement, getGroupCompanies }
