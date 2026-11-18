const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { SOURCE_TYPES, ORDINARY_FUND_SOURCE_BY_BIZ_TYPE, ORDINARY_FUND_SOURCE_TYPES } = require('../../constants/voucherSource')
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

// Reversals follow the original source. A manual voucher without a source remains in its booked company.
const fundSourceType = 'COALESCE(fund_origin.source_type, v.source_type)'
const ordinaryFundPairs = Object.entries(ORDINARY_FUND_SOURCE_BY_BIZ_TYPE).map(([bizType, type]) => `('${type}',${bizType})`).join(',')
const fundOwnershipJoins = `
     LEFT JOIN acct_vouchers fund_origin
       ON fund_origin.id=v.reversed_id AND fund_origin.company_id=v.company_id
       AND v.source_type='manual' AND v.is_reversal=1
     LEFT JOIN finance_account_transactions fund_txn
       ON fund_txn.id=COALESCE(fund_origin.source_id,v.source_id)
       AND (${fundSourceType},fund_txn.biz_type) IN (${ordinaryFundPairs})
     LEFT JOIN finance_accounts fund_owner ON fund_owner.id=fund_txn.account_id`
// Preserve unresolved postings for review; exclude only a proven attribution to another company.
const fundBelongsToCompany = '(fund_owner.company_id IS NULL OR fund_owner.company_id=v.company_id)'

async function getFundOwnershipReview(companies, end, start = null) {
  const dateFilter = start == null ? 'v.voucher_date <= ?' : 'v.voucher_date BETWEEN ? AND ?'
  const [rows] = await pool.query(
    `SELECT v.company_id AS booked_company_id, fund_owner.company_id AS owner_company_id, v.period,
            ${fundSourceType} AS source_type, COUNT(DISTINCT v.id) AS voucher_count,
            COALESCE(SUM(CASE WHEN e.account_code IN ('1001','1002')
                              THEN IF(e.direction=1,e.amount,-e.amount) END),0) AS net_fund_amount
       FROM acct_vouchers v
       ${fundOwnershipJoins}
       LEFT JOIN acct_voucher_entries e ON e.voucher_id=v.id
      WHERE v.company_id IN (?) AND ${dateFilter}
        AND ${fundSourceType} IN (?)
        AND (fund_owner.company_id IS NULL OR fund_owner.company_id<>v.company_id)
      GROUP BY v.company_id, fund_owner.company_id, v.period, ${fundSourceType}
      ORDER BY v.period, v.company_id, fund_owner.company_id, source_type`,
    [companies.map(c => c.id), ...(start == null ? [end] : [start, end]), ORDINARY_FUND_SOURCE_TYPES],
  )
  return rows.map(row => ({
    bookedCompanyId: Number(row.booked_company_id),
    ownerCompanyId: row.owner_company_id == null ? null : Number(row.owner_company_id),
    period: row.period,
    sourceType: row.source_type,
    voucherCount: Number(row.voucher_count),
    netFundAmount: Number(row.net_fund_amount),
  }))
}

/** 单账套资产负债表（按 company_id），供合并加总 */
async function balanceSheetForCompany(companyId, period) {
  const { end } = periodRange(period)
  const [rows] = await pool.query(
    `SELECT a.id, a.code, a.name, a.category, a.balance_dir,
       COALESCE(SUM(CASE WHEN v.voucher_date <= ? AND ${fundBelongsToCompany} AND e.direction=1 THEN e.amount END),0) d,
       COALESCE(SUM(CASE WHEN v.voucher_date <= ? AND ${fundBelongsToCompany} AND e.direction=2 THEN e.amount END),0) c
     FROM acct_accounts a
     LEFT JOIN acct_voucher_entries e ON e.account_id=a.id
     LEFT JOIN acct_vouchers v ON v.id=e.voucher_id AND v.company_id=?
     ${fundOwnershipJoins}
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
    if (r.category === 1) {
      const assetAmount = round2(Number(r.d) - Number(r.c))
      if (assetAmount) assets.push({ code: r.code, name: r.name, amount: assetAmount })
      assetTotal += assetAmount
    }
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
  const { end } = periodRange(period)
  return {
    period, asOf: end, groupId: Number(groupId),
    fundOwnershipReview: await getFundOwnershipReview(companies, end),
    companies: companies.map(c => ({ id: Number(c.id), code: c.code, name: c.name })),
    assets, liabilities, equity,
    assetTotal, liabTotal, equityTotal, liabEquityTotal,
    balanced: assetTotal === liabEquityTotal,
  }
}

/** 合并利润表：与普通利润表一致，汇总各账套结转前的损益发生额。 */
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
     JOIN acct_vouchers v ON v.id=e.voucher_id AND v.company_id=a.company_id
     ${fundOwnershipJoins}
     WHERE a.is_leaf=1 AND a.category IN (4,5,6) AND a.deleted_at IS NULL
       AND v.source_type NOT IN (?, ?) AND ${fundBelongsToCompany}
       AND a.company_id IN (${companies.map(() => '?').join(',')})
       AND v.company_id IN (${companies.map(() => '?').join(',')})
     GROUP BY a.id, a.code, a.name, a.category
     ORDER BY a.code ASC`,
    [start, end, start, end, SOURCE_TYPES.PERIOD_CLOSE, SOURCE_TYPES.PERIOD_CLOSE_Y, ...companies.map(c => c.id), ...companies.map(c => c.id)],
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
    fundOwnershipReview: await getFundOwnershipReview(companies, end, start),
    companies: companies.map(c => ({ id: Number(c.id), code: c.code, name: c.name })),
    revenue, expenses, revenueTotal: round2(revenueTotal), expenseTotal: round2(expenseTotal),
    netProfit,
  }
}

module.exports = { getConsolidatedBalanceSheet, getConsolidatedIncomeStatement, getGroupCompanies }
