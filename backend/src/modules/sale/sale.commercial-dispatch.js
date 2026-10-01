'use strict'
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertQtyScale } = require('../../utils/qtyPrecision')
const { roundQty } = require('../../utils/unitConversion')
const { loadGroups } = require('./sale.commercial-store')
const { assertOutboundPhysicalAvailable } = require('../../engine/inventoryEngine')
async function select(conn, order, requested, scope) {
  if (!Array.isArray(requested) || !requested.length || requested.length>200) throw new AppError('请选择本批要发的套或商品及数量',400,'SALE_COMMERCIAL_DISPATCH_REQUIRED')
  if (new Set(requested.map(g => Number(g.groupId))).size!==requested.length) throw new AppError('本批发货成交明细重复，请重新核对',400,'SALE_COMMERCIAL_DISPATCH_DUPLICATE')
  const [pending] = await conn.query('SELECT id FROM warehouse_tasks WHERE sale_order_id=? AND (adjustment_requested_at IS NOT NULL OR cancel_requested_at IS NOT NULL) AND deleted_at IS NULL FOR SHARE',[order.id])
  if (pending.length) throw new AppError('已有任务待归还或待确认改单，不能再次派发',409,'SALE_COMMERCIAL_PENDING')
  const groups = await loadGroups(conn,order.id,{lock:true}), byId = new Map(groups.map(g => [g.id,g]))
  const [dispatch] = await conn.query(`SELECT dg.group_id,dg.quantity FROM sale_dispatch_groups dg JOIN warehouse_tasks wt ON wt.id=dg.task_id JOIN sale_commercial_groups g ON g.id=dg.group_id
    WHERE g.order_id=? AND dg.active=1 AND wt.status<>8 AND wt.deleted_at IS NULL ORDER BY dg.id FOR SHARE`,[order.id])
  const used = new Map(); for (const d of dispatch) used.set(Number(d.group_id),roundQty((used.get(Number(d.group_id))||0)+Number(d.quantity)))
  const selected = requested.map(r => {
    const g=byId.get(Number(r.groupId)); if (!g) throw new AppError('所选成交明细已更新，请保留输入并重新核对',409,'SALE_COMMERCIAL_GROUP_CHANGED')
    assertInScope(scope,g.warehouseId,'销售单'); assertQtyScale(r.qty,'本批发货数量')
    const qty=Number(r.qty)
    if (!(qty>0) || (g.kind==='kit' && !Number.isSafeInteger(qty)) || qty>roundQty(g.targetQty-(used.get(g.id)||0))) throw new AppError('本批数量超过可发数量；套单须按整数套发货',400,'SALE_COMMERCIAL_DISPATCH_QTY')
    return { ...g,dispatchQty:qty }
  })
  const vector=new Map()
  for (const g of selected) for (const c of g.components) {
    const qty=g.kind==='kit'?roundQty(c.baseQty*g.dispatchQty):g.dispatchQty
    const old=vector.get(c.saleItemId)||{ id:c.saleItemId,qty:0,productId:c.productId,productName:c.productName,warehouseId:g.warehouseId }
    old.qty=roundQty(old.qty+qty);vector.set(c.saleItemId,old)
  }
  for (const i of [...vector.values()].sort((a,b)=>a.productId-b.productId || a.warehouseId-b.warehouseId)) await assertOutboundPhysicalAvailable(conn,{ productId:i.productId,productName:i.productName,warehouseId:i.warehouseId,qty:i.qty,reservationRefType:'sale_order',reservationRefId:order.id })
  return { selected,items:[...vector.values()].map(i=>({id:i.id,qty:i.qty})) }
}
async function record(conn,taskId,warehouseId,selected,orderId) {
  const rows=selected.filter(g=>g.warehouseId===warehouseId).map(g=>[orderId,taskId,g.id,g.dispatchQty])
  if (rows.length) await conn.query('INSERT INTO sale_dispatch_groups (order_id,task_id,group_id,quantity) VALUES ?',[rows])
}
async function replaceUnconfirmed(conn,orderId,taskId) {
  const [existing] = await conn.query('SELECT id,confirmed_at FROM sale_dispatch_groups WHERE task_id=? FOR UPDATE',[taskId])
  if (existing.some(g=>g.confirmed_at)) throw new AppError('原出库批次已经发货，不能修改',409,'SALE_COMMERCIAL_CONFIRMED_IMMUTABLE')
  await conn.query('UPDATE sale_dispatch_groups SET active=0 WHERE task_id=?',[taskId])
  const groups=await loadGroups(conn,orderId)
  const rows=groups.filter(g=>g.targetQty>0).map(g=>[orderId,taskId,g.id,g.targetQty])
  if (rows.length) await conn.query('INSERT INTO sale_dispatch_groups (order_id,task_id,group_id,quantity) VALUES ? ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),active=1',[rows])
}
module.exports={select,record,replaceUnconfirmed}
