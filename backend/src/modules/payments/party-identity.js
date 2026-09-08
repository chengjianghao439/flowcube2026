const AppError = require('../../utils/AppError')

async function recordParty(conn, recordId, type) {
  const [[row]] = await conn.query(
    `SELECT CASE WHEN pr.type=2 THEN so.customer_id ELSE po.supplier_id END party_id
     FROM payment_records pr
     LEFT JOIN sale_orders so ON pr.type=2 AND so.id=pr.order_id
     LEFT JOIN purchase_orders po ON pr.type=1 AND po.id=pr.order_id
     WHERE pr.id=? AND pr.type=?`, [recordId,type],
  )
  return row?.party_id ? Number(row.party_id) : null
}
async function resolveReceiptParty(conn, { type, partyId = null, partyName, allocations = [] }) {
  const specified = partyId == null ? null : Number(partyId)
  if (specified != null) {
    if (!Number.isSafeInteger(specified) || specified < 1) throw new AppError('往来单位编号无效',400)
    const table = Number(type) === 2 ? 'sale_customers' : 'supply_suppliers'
    const [[party]] = await conn.query(`SELECT id FROM ${table} WHERE id=? AND deleted_at IS NULL`, [specified])
    if (!party) throw new AppError('往来单位不存在',400)
  }
  const recordIds = new Set(allocations.filter(a => a.recordId).map(a => Number(a.recordId)))
  for (const allocation of allocations.filter(a => a.statementId)) {
    const [rows] = await conn.query('SELECT record_id FROM reconciliation_statement_items WHERE statement_id=?', [allocation.statementId])
    rows.forEach(r => recordIds.add(Number(r.record_id)))
  }
  if (recordIds.size) {
    const owners = new Set()
    for (const id of recordIds) owners.add(await recordParty(conn,id,type))
    if (owners.size !== 1 || (specified != null && !owners.has(specified))) throw new AppError('核销账款往来单位不一致或归属不明确',409)
    return [...owners][0]
  }
  if (specified != null) return specified
  // 旧客户端仍可登记无主档的历史款项；不猜测其归属，保留 NULL 待财务核查。
  const [[row]] = await conn.query(
    `SELECT IF(COUNT(DISTINCT party_id)=1,MIN(party_id),NULL) party_id
     FROM party_identity_names WHERE type=? AND BINARY party_name=BINARY ?`, [type,partyName],
  )
  return row.party_id ? Number(row.party_id) : null
}
async function assertAllocationParty(conn, recordId, receipt) {
  const expected = receipt.party_id == null ? null : Number(receipt.party_id)
  if (await recordParty(conn, recordId, receipt.type) !== expected) {
    throw new AppError('汇款与账款的单位归属不一致；未归属汇款须先核实，不能核销到已知单位',409)
  }
}
module.exports = { recordParty, resolveReceiptParty, assertAllocationParty }
