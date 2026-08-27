const { pool } = require('../../config/db')
const { beijingTodayYmd } = require('../../utils/backendTime')

/**
 * 资金看板：账户余额分布、收支趋势、费用构成。
 *
 * 全部从 finance_account_transactions（账户流水）与 expense_claims 汇总，
 * 不新增任何冗余统计表——统计一旦落库就会与事实源漂移，而这里的查询量很小，实时算即可。
 */

/** 默认统计区间：近 6 个自然月（北京时间为准，显式 backendTime，不依赖进程 TZ） */
function defaultRange() {
  const endDate = beijingTodayYmd()
  const [y, m] = endDate.split('-').map(Number)
  let startY = y, startM = m - 5
  if (startM <= 0) { startY -= 1; startM += 12 }
  return { startDate: `${startY}-${String(startM).padStart(2, '0')}-01`, endDate }
}

async function overview({ startDate, endDate } = {}) {
  const range = { ...defaultRange(), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }

  // 账户余额分布（当前时点，不受区间影响）
  const [accounts] = await pool.query(
    `SELECT id, code, name, type, current_balance
       FROM finance_accounts
      WHERE deleted_at IS NULL AND is_active = 1
      ORDER BY current_balance DESC`,
  )
  const totalBalance = accounts.reduce((s, a) => s + Number(a.current_balance), 0)

  // 区间内收支合计
  const [[flow]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE 0 END),0) AS inAmount,
            COALESCE(SUM(CASE WHEN direction=2 THEN amount ELSE 0 END),0) AS outAmount
       FROM finance_account_transactions
      WHERE happened_at BETWEEN ? AND ?`,
    [range.startDate, range.endDate],
  )

  // 按月收支趋势
  const [monthly] = await pool.query(
    `SELECT DATE_FORMAT(happened_at, '%Y-%m') AS month,
            COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE 0 END),0) AS inAmount,
            COALESCE(SUM(CASE WHEN direction=2 THEN amount ELSE 0 END),0) AS outAmount
       FROM finance_account_transactions
      WHERE happened_at BETWEEN ? AND ?
      GROUP BY month ORDER BY month ASC`,
    [range.startDate, range.endDate],
  )

  // 业务类型构成（收款/付款/报销/调整各占多少）
  const [byBizType] = await pool.query(
    `SELECT biz_type,
            COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE 0 END),0) AS inAmount,
            COALESCE(SUM(CASE WHEN direction=2 THEN amount ELSE 0 END),0) AS outAmount,
            COUNT(*) AS txCount
       FROM finance_account_transactions
      WHERE happened_at BETWEEN ? AND ?
      GROUP BY biz_type ORDER BY biz_type`,
    [range.startDate, range.endDate],
  )

  // 费用构成：只统计已付款的报销，未付的还不算真实支出
  const [expenseByCategory] = await pool.query(
    `SELECT i.category_name AS categoryName,
            COALESCE(SUM(i.amount),0) AS amount,
            COUNT(DISTINCT i.claim_id) AS claimCount
       FROM expense_claim_items i
       JOIN expense_claims c ON c.id = i.claim_id
      WHERE c.deleted_at IS NULL AND c.status = 4
        AND DATE(c.paid_at) BETWEEN ? AND ?
      GROUP BY i.category_name
      ORDER BY amount DESC`,
    [range.startDate, range.endDate],
  )
  const expenseTotal = expenseByCategory.reduce((s, r) => s + Number(r.amount), 0)

  // 待办：待审批与已批准待付款的报销
  const [[pending]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN status=2 THEN total_amount ELSE 0 END),0) AS pendingApproveAmount,
            COALESCE(SUM(CASE WHEN status=2 THEN 1 ELSE 0 END),0) AS pendingApproveCount,
            COALESCE(SUM(CASE WHEN status=3 THEN total_amount ELSE 0 END),0) AS pendingPayAmount,
            COALESCE(SUM(CASE WHEN status=3 THEN 1 ELSE 0 END),0) AS pendingPayCount
       FROM expense_claims WHERE deleted_at IS NULL`,
  )

  const BIZ_NAME = { 1: '收款', 2: '付款', 3: '费用报销', 4: '余额调整' }
  const TYPE_NAME = { 1: '银行账户', 2: '现金', 3: '支付宝', 4: '微信', 5: '其他' }

  return {
    range,
    summary: {
      totalBalance,
      accountCount: accounts.length,
      inAmount: Number(flow.inAmount),
      outAmount: Number(flow.outAmount),
      netAmount: Number(flow.inAmount) - Number(flow.outAmount),
      expenseTotal,
    },
    accounts: accounts.map(a => ({
      id: Number(a.id), code: a.code, name: a.name,
      typeName: TYPE_NAME[Number(a.type)] || '其他',
      balance: Number(a.current_balance),
      share: totalBalance > 0 ? Number(a.current_balance) / totalBalance : 0,
    })),
    monthly: monthly.map(m => ({
      month: m.month,
      inAmount: Number(m.inAmount),
      outAmount: Number(m.outAmount),
      netAmount: Number(m.inAmount) - Number(m.outAmount),
    })),
    byBizType: byBizType.map(b => ({
      bizType: Number(b.biz_type),
      bizTypeName: BIZ_NAME[Number(b.biz_type)] || '其他',
      inAmount: Number(b.inAmount),
      outAmount: Number(b.outAmount),
      txCount: Number(b.txCount),
    })),
    expenseByCategory: expenseByCategory.map(r => ({
      categoryName: r.categoryName,
      amount: Number(r.amount),
      claimCount: Number(r.claimCount),
      share: expenseTotal > 0 ? Number(r.amount) / expenseTotal : 0,
    })),
    pending: {
      approveAmount: Number(pending.pendingApproveAmount),
      approveCount: Number(pending.pendingApproveCount),
      payAmount: Number(pending.pendingPayAmount),
      payCount: Number(pending.pendingPayCount),
    },
  }
}

module.exports = { overview }
