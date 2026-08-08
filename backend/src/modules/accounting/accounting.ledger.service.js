/**
 * 会计总账 / 报表 Service（文档 10 · Phase 2 · 设计 §4.4/§9）
 *
 * 采用**实时汇总法**（不建 acct_account_balances 投影表）：总账/科目余额/试算平衡/报表
 * 一律从 acct_voucher_entries 按期间 + 借贷方向实时 SUM，期初=期间前累计。数据量有限，
 * 实时算最简单、绝不漂移（与库存缓存/资金余额的"投影易漂移"相反，这里没有投影可漂）。
 *
 * ⚠️ 状态口径（关键）：**所有汇总均包含全部凭证，不按 status 过滤**。红字冲销是「原凭证
 * (status=3已冲销) + 红字凭证(is_reversal=1,status=1) 借贷反向」成对存在，二者相抵为零；
 * 若过滤掉 status=3 只留红字，反而把该笔算成「负的原始额」。故账簿/试算平衡/报表全量纳入，
 * 冲销对自然抵消，且明细账保留红冲痕迹（审计要求）。
 *
 * 余额方向：资产/成本/费用(balance_dir=1)期末=借−贷；负债/权益/收入(balance_dir=2)期末=贷−借。
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// 期间 YYYYMM → { start:'YYYY-MM-01', end:'YYYY-MM-最后一天' }
function periodRange(period) {
  const p = String(period || '').trim()
  if (!/^\d{6}$/.test(p)) throw new AppError('会计期间格式应为 YYYYMM', 400)
  const y = Number(p.slice(0, 4)); const m = Number(p.slice(4, 6))
  if (m < 1 || m > 12) throw new AppError('会计期间月份非法', 400)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

const CATEGORY_NAME = { 1: '资产', 2: '负债', 3: '权益', 4: '成本', 5: '损益(收入)', 6: '损益(费用)' }

// ── 科目余额表 / 试算平衡 ─────────────────────────────────────────────────────

/**
 * 试算平衡 / 科目余额表：每个有活动或有余额的科目，期初/本期发生/期末。
 * 含**父级汇总行**（is_leaf=0 的汇总科目 = 其全部后代末级科目之和，缩进展示）——
 * 会计对表以「1122 应收账款」这种一级科目合计为准，只列末级会对不上。
 * @param {{period:string}} 会计期间 YYYYMM
 */
async function getTrialBalance({ period }) {
  const { start, end } = periodRange(period)
  const [rows] = await pool.query(`
    SELECT a.id, a.code, a.name, a.category, a.balance_dir, a.is_leaf,
      COALESCE(SUM(CASE WHEN v.voucher_date <  ? AND e.direction=1 THEN e.amount END),0) AS preDebit,
      COALESCE(SUM(CASE WHEN v.voucher_date <  ? AND e.direction=2 THEN e.amount END),0) AS preCredit,
      COALESCE(SUM(CASE WHEN v.voucher_date BETWEEN ? AND ? AND e.direction=1 THEN e.amount END),0) AS periodDebit,
      COALESCE(SUM(CASE WHEN v.voucher_date BETWEEN ? AND ? AND e.direction=2 THEN e.amount END),0) AS periodCredit
    FROM acct_accounts a
    LEFT JOIN acct_voucher_entries e ON e.account_id = a.id
    LEFT JOIN acct_vouchers v ON v.id = e.voucher_id
    WHERE a.deleted_at IS NULL AND a.is_leaf = 1
    GROUP BY a.id, a.code, a.name, a.category, a.balance_dir, a.is_leaf
    ORDER BY a.code ASC`,
    [start, start, start, end, start, end])

  // 全部科目（含汇总科目），用于把末级发生额上卷到父级
  const [allAccounts] = await pool.query(
    'SELECT id, code, name, category, balance_dir, parent_id, level, is_leaf FROM acct_accounts WHERE deleted_at IS NULL',
  )
  const childrenOf = new Map()
  for (const a of allAccounts) {
    const pid = a.parent_id != null ? Number(a.parent_id) : null
    if (pid == null) continue
    if (!childrenOf.has(pid)) childrenOf.set(pid, [])
    childrenOf.get(pid).push(Number(a.id))
  }

  // 末级科目的四段金额（原始值，未拆方向列）
  const rawById = new Map(rows.map(r => [Number(r.id), {
    preD: round2(r.preDebit), preC: round2(r.preCredit),
    pD: round2(r.periodDebit), pC: round2(r.periodCredit),
  }]))
  // 自底向上累加（先排序保证子级先于父级处理）
  const aggById = new Map()
  const byLevelDesc = [...allAccounts].sort((a, b) => (b.level || 1) - (a.level || 1))
  for (const a of byLevelDesc) {
    const id = Number(a.id)
    const own = rawById.get(id) || { preD: 0, preC: 0, pD: 0, pC: 0 }
    const agg = { ...own }
    for (const cid of childrenOf.get(id) || []) {
      const child = aggById.get(cid)
      if (!child) continue
      agg.preD += child.preD; agg.preC += child.preC; agg.pD += child.pD; agg.pC += child.pC
    }
    aggById.set(id, agg)
  }

  const totals = { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 }
  const list = []
  // 按编码排序输出（父级编码天然排在子级前：2221 < 222101），父子相邻
  const ordered = [...allAccounts].sort((a, b) => String(a.code).localeCompare(String(b.code)))
  for (const a of ordered) {
    const agg = aggById.get(Number(a.id))
    if (!agg) continue
    const isLeaf = Number(a.is_leaf) === 1
    const dir = a.balance_dir
    const openNet = dir === 1 ? agg.preD - agg.preC : agg.preC - agg.preD
    const closeNet = dir === 1 ? (agg.preD + agg.pD) - (agg.preC + agg.pC) : (agg.preC + agg.pC) - (agg.preD + agg.pD)
    const openingDebit = dir === 1 ? Math.max(openNet, 0) : Math.max(-openNet, 0)
    const openingCredit = dir === 2 ? Math.max(openNet, 0) : Math.max(-openNet, 0)
    const closingDebit = dir === 1 ? Math.max(closeNet, 0) : Math.max(-closeNet, 0)
    const closingCredit = dir === 2 ? Math.max(closeNet, 0) : Math.max(-closeNet, 0)
    // 只展示有期初/发生/期末的科目（父级任一代非零即非零，已被上卷）
    if (!(openingDebit || openingCredit || agg.pD || agg.pC || closingDebit || closingCredit)) continue
    if (isLeaf) {
      totals.openingDebit += openingDebit; totals.openingCredit += openingCredit
      totals.periodDebit += agg.pD; totals.periodCredit += agg.pC
      totals.closingDebit += closingDebit; totals.closingCredit += closingCredit
    }
    list.push({
      accountId: Number(a.id), code: a.code, name: a.name, category: a.category, categoryName: CATEGORY_NAME[a.category],
      balanceDir: dir, level: Number(a.level) || 1, isLeaf,
      openingDebit: round2(openingDebit), openingCredit: round2(openingCredit),
      periodDebit: round2(agg.pD), periodCredit: round2(agg.pC),
      closingDebit: round2(closingDebit), closingCredit: round2(closingCredit),
    })
  }

  Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]) })
  return {
    period, start, end, list, totals,
    balanced: {
      period: totals.periodDebit === totals.periodCredit,
      closing: totals.closingDebit === totals.closingCredit,
    },
  }
}

// ── 明细账 ────────────────────────────────────────────────────────────────────

/** 某科目在期间内的明细账（逐笔 + 逐笔余额），含期初余额。汇总科目含其全部末级后代的分录。 */
async function getAccountLedger({ accountId, period }) {
  const { start, end } = periodRange(period)
  const [[acct]] = await pool.query('SELECT id, code, name, balance_dir, is_leaf FROM acct_accounts WHERE id=? AND deleted_at IS NULL', [Number(accountId)])
  if (!acct) throw new AppError('科目不存在', 404)
  const dir = acct.balance_dir

  // 汇总科目：收集全部末级后代，明细按「后代替换 IN」取数（余额方向沿父级）
  let accountIds = [Number(accountId)]
  if (Number(acct.is_leaf) !== 1) {
    const [all] = await pool.query('SELECT id, parent_id, is_leaf FROM acct_accounts WHERE deleted_at IS NULL')
    const childrenOf = new Map()
    for (const a of all) {
      if (a.parent_id == null) continue
      const pid = Number(a.parent_id)
      if (!childrenOf.has(pid)) childrenOf.set(pid, [])
      childrenOf.get(pid).push(Number(a.id))
    }
    const leaves = []
    const stack = [Number(accountId)]
    while (stack.length) {
      const cur = stack.pop()
      for (const cid of childrenOf.get(cur) || []) stack.push(cid)
      if (!childrenOf.has(cur)) leaves.push(cur)
    }
    // 当前节点本身非叶时不入列；leaves 收集的是末端节点
    accountIds = leaves.filter(id => {
      const meta = all.find(a => Number(a.id) === id)
      return meta && Number(meta.is_leaf) === 1
    })
    if (!accountIds.length) throw new AppError('该汇总科目下没有末级科目', 400)
  }
  const placeholders = accountIds.map(() => '?').join(',')

  const [[pre]] = await pool.query(`
    SELECT COALESCE(SUM(CASE WHEN e.direction=1 THEN e.amount END),0) d,
           COALESCE(SUM(CASE WHEN e.direction=2 THEN e.amount END),0) c
      FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
     WHERE e.account_id IN (${placeholders}) AND v.voucher_date < ?`, [...accountIds, start])
  let running = dir === 1 ? round2(pre.d - pre.c) : round2(pre.c - pre.d)
  const openingBalance = running

  const [entries] = await pool.query(`
    SELECT v.voucher_no, v.voucher_date, e.direction, e.amount, e.summary, e.aux_name, e.line_no, v.id AS voucher_id,
           e.account_code, e.account_name
      FROM acct_voucher_entries e JOIN acct_vouchers v ON v.id=e.voucher_id
     WHERE e.account_id IN (${placeholders}) AND v.voucher_date BETWEEN ? AND ?
     ORDER BY v.voucher_date ASC, v.id ASC, e.line_no ASC`, [...accountIds, start, end])

  const list = entries.map(e => {
    const amt = round2(e.amount)
    running = round2(running + (dir === 1 ? (e.direction === 1 ? amt : -amt) : (e.direction === 2 ? amt : -amt)))
    return {
      voucherId: e.voucher_id, voucherNo: e.voucher_no, voucherDate: e.voucher_date,
      accountCode: e.account_code, accountName: e.account_name,
      summary: e.summary, auxName: e.aux_name,
      debit: e.direction === 1 ? amt : 0, credit: e.direction === 2 ? amt : 0,
      balance: running,
    }
  })
  return { account: { id: acct.id, code: acct.code, name: acct.name, balanceDir: dir, isLeaf: Number(acct.is_leaf) === 1 }, period, start, end, openingBalance, closingBalance: running, list }
}

// ── 报表取数（简版） ──────────────────────────────────────────────────────────

// 汇总某分类科目在期间的发生净额（按 category），用于利润表
async function categoryNet(start, end) {
  const [rows] = await pool.query(`
    SELECT a.category, a.balance_dir,
      COALESCE(SUM(CASE WHEN v.voucher_date BETWEEN ? AND ? AND e.direction=1 THEN e.amount END),0) d,
      COALESCE(SUM(CASE WHEN v.voucher_date BETWEEN ? AND ? AND e.direction=2 THEN e.amount END),0) c,
      a.code, a.name
    FROM acct_accounts a
    LEFT JOIN acct_voucher_entries e ON e.account_id=a.id
    LEFT JOIN acct_vouchers v ON v.id=e.voucher_id
    WHERE a.deleted_at IS NULL AND a.is_leaf=1
    GROUP BY a.id, a.category, a.balance_dir, a.code, a.name`, [start, end, start, end])
  return rows
}

/** 利润表：主营收入 − 主营成本 − 销售费用 − 管理费用 = 净利润（简版） */
async function getIncomeStatement({ period }) {
  const { start, end } = periodRange(period)
  const rows = await categoryNet(start, end)
  const net = (code) => { const r = rows.find(x => x.code === code); if (!r) return 0; return round2((r.balance_dir === 1 ? (r.d - r.c) : (r.c - r.d))) }
  // 收入类(贷方净额)取正，费用/成本类(借方净额)取正
  const revenue = net('6001')
  const cost = net('6401')
  const sellExp = net('6601')
  const adminExp = net('6602')
  const grossProfit = round2(revenue - cost)
  const profit = round2(revenue - cost - sellExp - adminExp)
  return {
    period, start, end,
    rows: [
      { name: '一、主营业务收入', amount: revenue },
      { name: '减：主营业务成本', amount: cost },
      { name: '二、主营业务利润', amount: grossProfit, bold: true },
      { name: '减：销售费用', amount: sellExp },
      { name: '减：管理费用', amount: adminExp },
      { name: '三、净利润', amount: profit, bold: true },
    ],
    profit,
  }
}

/** 资产负债表（期末时点，简版）：资产 = 负债 + 权益 + 本期利润(未分配) */
async function getBalanceSheet({ period }) {
  const { end } = periodRange(period)
  // 期末余额 = 建账以来累计（<= end）
  const [rows] = await pool.query(`
    SELECT a.id, a.code, a.name, a.category, a.balance_dir,
      COALESCE(SUM(CASE WHEN v.voucher_date <= ? AND e.direction=1 THEN e.amount END),0) d,
      COALESCE(SUM(CASE WHEN v.voucher_date <= ? AND e.direction=2 THEN e.amount END),0) c
    FROM acct_accounts a
    LEFT JOIN acct_voucher_entries e ON e.account_id=a.id
    LEFT JOIN acct_vouchers v ON v.id=e.voucher_id
    WHERE a.deleted_at IS NULL AND a.is_leaf=1
    GROUP BY a.id, a.code, a.name, a.category, a.balance_dir`, [end, end])

  const bal = (r) => round2(r.balance_dir === 1 ? (r.d - r.c) : (r.c - r.d))
  const assets = [], liabilities = [], equity = []
  let assetTotal = 0, liabTotal = 0, equityTotal = 0, revenueSum = 0, expenseSum = 0
  for (const r of rows) {
    const b = bal(r)
    if (r.category === 1) { if (b) assets.push({ code: r.code, name: r.name, amount: b }); assetTotal += b }
    else if (r.category === 2) { if (b) liabilities.push({ code: r.code, name: r.name, amount: b }); liabTotal += b }
    else if (r.category === 3) { if (b) equity.push({ code: r.code, name: r.name, amount: b }); equityTotal += b }
    else if (r.category === 5) revenueSum += b // 收入贷方为正
    else if (r.category === 4 || r.category === 6) expenseSum += b // 成本/费用借方为正
  }
  // 未分配利润（本期净利润累计，简版：收入−成本费用），并入权益使等式成立
  const retainedProfit = round2(revenueSum - expenseSum)
  equity.push({ code: '——', name: '未分配利润（本期损益结转）', amount: retainedProfit })
  equityTotal = round2(equityTotal + retainedProfit)
  assetTotal = round2(assetTotal); liabTotal = round2(liabTotal)
  const liabEquityTotal = round2(liabTotal + equityTotal)
  return {
    period, asOf: end,
    assets, liabilities, equity,
    assetTotal, liabTotal, equityTotal, liabEquityTotal,
    balanced: assetTotal === liabEquityTotal,
  }
}

/** 现金流量表（简版）：从资金流水 finance_account_transactions 归集经营活动现金流 */
async function getCashFlow({ period }) {
  const { start, end } = periodRange(period)
  const [rows] = await pool.query(`
    SELECT biz_type, direction, COALESCE(SUM(amount),0) amt
      FROM finance_account_transactions
     WHERE happened_at BETWEEN ? AND ?
     GROUP BY biz_type, direction`, [start, end])
  const sum = (bt, d) => round2(rows.filter(r => r.biz_type === bt && r.direction === d).reduce((s, r) => s + Number(r.amt), 0))
  const inflowReceipt = sum(1, 1)          // 收款流入
  const outflowPayment = sum(2, 2)         // 付款流出
  const outflowExpense = sum(3, 2)         // 报销流出
  const otherIn = sum(4, 1)                // 余额调整(收)
  const otherOut = sum(4, 2)               // 余额调整(付)
  const operatingIn = round2(inflowReceipt)
  const operatingOut = round2(outflowPayment + outflowExpense)
  const net = round2(operatingIn - operatingOut + otherIn - otherOut)
  return {
    period, start, end,
    rows: [
      { name: '一、经营活动现金流入', amount: operatingIn, bold: true },
      { name: '　　销售收款', amount: inflowReceipt },
      { name: '二、经营活动现金流出', amount: operatingOut, bold: true },
      { name: '　　采购/供应商付款', amount: outflowPayment },
      { name: '　　费用报销', amount: outflowExpense },
      ...(otherIn || otherOut ? [{ name: '三、其他（账户调整）', amount: round2(otherIn - otherOut) }] : []),
      { name: '经营活动现金流量净额', amount: net, bold: true },
    ],
    net,
  }
}

module.exports = { getTrialBalance, getAccountLedger, getIncomeStatement, getBalanceSheet, getCashFlow, periodRange }
