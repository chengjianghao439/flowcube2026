const { pool } = require('../../config/db')
const { beijingTodayYmd } = require('../../utils/backendTime')

/**
 * 应收 / 应付账龄分析（as-of 今天）。
 *
 * 账龄回答的是「未结清的账款拖了多久、敞口分布在哪些区间」，是资金看板与催收的核心视图。
 * 口径：
 *   - 只统计**未结清**账款（status<>3 且 balance>0），已付清的不占用敞口。
 *   - 逾期天数 = 今天 − 到期日；到期日为空时回退到创建日（现结账款到期日恒等于下单日，
 *     历史数据可能没回填 due_date，回退能避免它们被漏进「未到期」桶）。
 *   - **与结算方式无关**：现结在账款页、月结在对账页，但账龄是「谁欠钱、欠多久」，
 *     必须跨两个分流页汇总才是完整敞口。这与 payments.findAll 按 settlement_type 分流不同，
 *     是刻意的——账龄看全量，不看分流。
 *   - 全部实时从 payment_records 算，不落任何统计缓存（口径与 finance-dashboard 一致，
 *     统计一旦落库就会与事实源漂移）。
 *
 * type：1=应付（我欠供应商）2=应收（客户欠我）。
 */

/** 账龄分桶定义。max=null 表示无上界；current 桶 max=0 即「今天及以前都没到期」。 */
const BUCKETS = [
  { key: 'current', label: '未到期', max: 0 },
  { key: 'd1_30', label: '逾期 1–30 天', max: 30 },
  { key: 'd31_60', label: '逾期 31–60 天', max: 60 },
  { key: 'd61_90', label: '逾期 61–90 天', max: 90 },
  { key: 'd90p', label: '逾期 90 天以上', max: null },
]

// 逾期天数表达式：到期日无则回退创建日。负值/0 = 未到期。
const OVERDUE_DAYS = 'DATEDIFF(CURDATE(), COALESCE(due_date, DATE(created_at)))'

// 分桶 CASE：与 BUCKETS 边界严格对应（<=0 未到期，<=30/60/90 各段，其余 90+）
const BUCKET_CASE = `
  CASE
    WHEN ${OVERDUE_DAYS} <= 0 THEN 'current'
    WHEN ${OVERDUE_DAYS} <= 30 THEN 'd1_30'
    WHEN ${OVERDUE_DAYS} <= 60 THEN 'd31_60'
    WHEN ${OVERDUE_DAYS} <= 90 THEN 'd61_90'
    ELSE 'd90p'
  END`

/** 某一方向（应收/应付）的分桶敞口 */
async function bucketsFor(type) {
  const [rows] = await pool.query(
    `SELECT ${BUCKET_CASE} AS bucket, COUNT(*) AS cnt, COALESCE(SUM(balance), 0) AS amt
       FROM payment_records
      WHERE type = ? AND status <> 3 AND balance > 0
      GROUP BY bucket`,
    [type],
  )
  const byKey = Object.fromEntries(rows.map(r => [r.bucket, r]))
  const buckets = BUCKETS.map(b => ({
    key: b.key,
    label: b.label,
    count: Number(byKey[b.key]?.cnt || 0),
    amount: Number(byKey[b.key]?.amt || 0),
  }))
  const total = buckets.reduce((s, b) => s + b.amount, 0)
  const totalCount = buckets.reduce((s, b) => s + b.count, 0)
  // 逾期 = 除「未到期」外的所有桶
  const overdueAmount = buckets.filter(b => b.key !== 'current').reduce((s, b) => s + b.amount, 0)
  const overdueCount = buckets.filter(b => b.key !== 'current').reduce((s, b) => s + b.count, 0)
  return { buckets, total, totalCount, overdueAmount, overdueCount }
}

/** 某方向敞口最大的若干往来方（催收/催付名单），带其逾期额与最长逾期天数 */
async function topParties(type, limit = 8) {
  const [rows] = await pool.query(
    `SELECT party_name AS partyName,
            COUNT(*) AS cnt,
            COALESCE(SUM(balance), 0) AS amt,
            COALESCE(SUM(CASE WHEN ${OVERDUE_DAYS} > 0 THEN balance ELSE 0 END), 0) AS overdueAmt,
            MAX(${OVERDUE_DAYS}) AS maxOverdue
       FROM payment_records
      WHERE type = ? AND status <> 3 AND balance > 0
      GROUP BY party_name
      ORDER BY amt DESC
      LIMIT ?`,
    [type, Number(limit)],
  )
  return rows.map(r => ({
    partyName: r.partyName,
    count: Number(r.cnt),
    amount: Number(r.amt),
    overdueAmount: Number(r.overdueAmt),
    maxOverdueDays: Math.max(0, Number(r.maxOverdue)),
  }))
}

/**
 * 完整账龄报告：应收与应付两个方向各自的分桶敞口 + Top 往来方名单。
 * @param {number} topLimit Top 往来方取前几名（默认 8）
 */
async function aging({ topLimit = 8 } = {}) {
  const [receivable, payable, arTop, apTop] = await Promise.all([
    bucketsFor(2),
    bucketsFor(1),
    topParties(2, topLimit),
    topParties(1, topLimit),
  ])
  return {
    asOf: beijingTodayYmd(),
    receivable: { ...receivable, topParties: arTop },
    payable: { ...payable, topParties: apTop },
  }
}

module.exports = { aging, bucketsFor, topParties, BUCKETS }
