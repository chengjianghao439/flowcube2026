const AppError = require('../../utils/AppError')
const { normalizePagination } = require('../../utils/pagination')

const NAMES = {
  OPENING_RECORD: '历史账款结转', OPENING_ADVANCE: '历史预收预付结转',
  CHARGE: '账款入账', CHARGE_ADJUSTMENT: '账款调整', RETURN: '退货冲减', REFUND: '退款',
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function parseQuery(input) {
  const type = Number(input.type), partyId = Number(input.partyId)
  if (![1, 2].includes(type) || !Number.isSafeInteger(partyId) || partyId < 1) throw new AppError('往来单位参数无效', 400)
  const { startDate = '', endDate = '' } = input
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate)) || (startDate && endDate && startDate > endDate)) throw new AppError('查询日期无效', 400)
  const snapshotId = input.snapshotId == null ? null : Number(input.snapshotId)
  if (snapshotId != null && (!Number.isSafeInteger(snapshotId) || snapshotId < 0)) throw new AppError('快照参数无效', 400)
  if (input.snapshotCount != null && (!Number.isSafeInteger(Number(input.snapshotCount)) || Number(input.snapshotCount) < 0)) throw new AppError('快照参数无效',400)
  for (const key of ['page', 'pageSize']) {
    if (input[key] != null && (!Number.isSafeInteger(Number(input[key])) || Number(input[key]) < 1)) throw new AppError('分页参数无效', 400)
  }
  return { type, partyId, startDate, endDate, snapshotId, ...normalizePagination(input) }
}

/** 财务公司级只读接口。单位 ID 按事件快照归属；不按名称搜索混入其他单位。 */
async function readLedger(input, conn) {
  const q = parseQuery(input)
  const table = q.type === 2 ? 'sale_customers' : 'supply_suppliers'
  const [[party]] = await conn.query(`SELECT id,code,name FROM ${table} WHERE id=?`, [q.partyId])
  if (!party) throw new AppError('客户或供应商不存在', 404)
  const [[meta]] = await conn.query("SELECT DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s') startedAt FROM party_ledger_meta WHERE id=1")
  const [[latest]] = await conn.query('SELECT COALESCE(MAX(id),0) id FROM party_ledger_events')
  const snapshotId = q.snapshotId ?? Number(latest.id)
  const scope = 'type=? AND party_id=? AND id<=?'
  const baseArgs = [q.type, q.partyId, snapshotId]
  const start = q.startDate ? `${q.startDate} 00:00:00` : '1000-01-01 00:00:00'
  const end = q.endDate || '9999-12-30'
  const range = 'occurred_at>=? AND occurred_at<DATE_ADD(?, INTERVAL 1 DAY)'
  const [[summary]] = await conn.query(
    `SELECT COALESCE(SUM(IF(occurred_at<?,delta,0)),0) openingBalance,
      COALESCE(SUM(IF(${range} AND delta>0,delta,0)),0) increase,
      COALESCE(SUM(IF(${range} AND delta<0,-delta,0)),0) decrease,
      COALESCE(SUM(IF(occurred_at<DATE_ADD(?, INTERVAL 1 DAY),delta,0)),0) closingBalance,
      SUM(IF(${range},1,0)) total
     FROM party_ledger_events WHERE ${scope}`,
    [start,start,end,start,end,end,start,end,...baseArgs],
  )
  const [rows] = await conn.query(
    `WITH balances AS (
       SELECT e.*, SUM(delta) OVER(ORDER BY occurred_at,id ROWS UNBOUNDED PRECEDING) balance_after
       FROM party_ledger_events e WHERE ${scope}
     ) SELECT *, DATE_FORMAT(occurred_at,'%Y-%m-%d %H:%i:%s') happened,
       DATE_FORMAT(business_date,'%Y-%m-%d') business_day
       FROM balances WHERE ${range} ORDER BY occurred_at,id LIMIT ? OFFSET ?`,
    [...baseArgs,start,end,q.pageSize,q.offset],
  )
  const [[scopeCount]] = await conn.query(`SELECT COUNT(*) count FROM party_ledger_events WHERE ${scope}`, baseArgs)
  if (input.snapshotCount != null && Number(input.snapshotCount) !== Number(scopeCount.count)) {
    throw new AppError('往来记录在分批读取期间发生变化，请刷新重查',409)
  }
  const [[unassigned]] = await conn.query(
    'SELECT COUNT(*) count FROM party_ledger_events WHERE type=? AND party_id IS NULL AND id<=?', [q.type,snapshotId],
  )
  return {
    party: { id: Number(party.id), code: party.code, name: party.name }, type: q.type,
    snapshotId, snapshotCount: Number(scopeCount.count), historyStartedAt: meta.startedAt,
    historyIncomplete: !!q.startDate && q.startDate < meta.startedAt.slice(0,10),
    unassignedCount: Number(unassigned.count),
    summary: Object.fromEntries(['openingBalance','increase','decrease','closingBalance'].map(k => [k,Number(summary[k])])),
    pagination: { page:q.page, pageSize:q.pageSize, total:Number(summary.total || 0) },
    list: rows.map(r => ({
      id: Number(r.id), occurredAt:r.happened, businessDate:r.business_day,
      eventType:r.event_type,
      eventName: NAMES[r.event_type] || (q.type === 2 ? '客户收款' : '供应商付款'),
      documentNo:r.document_no, orderId:r.order_id ? Number(r.order_id) : null,
      recordId:r.record_id ? Number(r.record_id) : null,
      receiptId:r.receipt_id ? Number(r.receipt_id) : null,
      increase: Math.max(0,Number(r.delta)), decrease: Math.max(0,-Number(r.delta)), balanceAfter:Number(r.balance_after),
    })),
  }
}
async function findLedger(input, connection) {
  if (connection) return readLedger(input, connection)
  const { pool } = require('../../config/db')
  const conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('SET TRANSACTION READ ONLY')
    await conn.beginTransaction()
    const result = await readLedger(input, conn)
    await conn.commit()
    return result
  } catch (err) { await conn.rollback(); throw err } finally { conn.release() }
}
module.exports = { findLedger, parseQuery }
