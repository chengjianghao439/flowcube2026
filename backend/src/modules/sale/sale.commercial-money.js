'use strict'
// Commercial money adapters only; quantities remain WT/WTI and real QA facts.
const AppError = require('../../utils/AppError')
const { loadGroups } = require('./sale.commercial-store')
const { snapshot } = require('./sale.commercial-resolver')
const { projectCommercialBatch } = require('./sale.commercial-money.math')
const { roundQty } = require('../../utils/unitConversion')
function invalid(reason) { throw new AppError(`套单执行记录不完整：${reason}`,409,'SALE_COMMERCIAL_SOURCE_INVALID') }
async function orderMoney(conn, orderId) {
  // Current reads select only evidence rows, never the source-budget mutex or another return document.
  const [dispatch] = await conn.query('SELECT id,confirmed_gross,basis_origin FROM sale_dispatch_groups WHERE order_id=? AND confirmed_at IS NOT NULL ORDER BY id FOR SHARE', [orderId])
  if(dispatch.some(d=>!['real_confirmation','legacy_verified'].includes(d.basis_origin)))invalid('原出库批次的折扣依据尚未核对')
  if (dispatch.some(d => d.confirmed_gross == null)) invalid('原出库批次缺少成交金额')
  const [returns] = await conn.query('SELECT id,refund_amount,financial_amount FROM sale_commercial_refund_receipts WHERE order_id=? ORDER BY id FOR SHARE', [orderId])
  if(returns.some(r=>r.financial_amount==null))invalid('原退货批次缺少实际账款减少额')
  return { returnedFinancial:returns.reduce((s,r)=>s+Math.round(Number(r.financial_amount)*10000),0)/10000, shippedGross:dispatch.reduce((s,d) => s+Math.round(Number(d.confirmed_gross)*100),0)/100,
    returnedGross:returns.reduce((s,r) => s+Math.round(Number(r.refund_amount)*100),0)/100 }
}
async function prepareShipment(conn, task, sale) {
  const groups = await loadGroups(conn, sale.id, { lock:true })
  const byId = new Map(groups.map(g => [g.id,g]))
  const [dispatch] = await conn.query('SELECT * FROM sale_dispatch_groups WHERE task_id=? AND active=1 ORDER BY id FOR UPDATE', [task.id])
  if (!dispatch.length || dispatch.some(d => d.confirmed_at)) invalid('本批仓库任务缺少有效成交明细')
  // Confirmation is committed atomically with real WT7 and cannot be reversed.
  // Lock only evidence rows, not JOINed WT/group/source-budget identities.
  const [prior] = await conn.query('SELECT group_id,quantity,order_gross_basis,discount_basis,basis_origin FROM sale_dispatch_groups WHERE order_id=? AND confirmed_at IS NOT NULL ORDER BY id FOR SHARE', [sale.id])
  if(prior.some(d=>!['real_confirmation','legacy_verified'].includes(d.basis_origin)))invalid('原出库批次的折扣依据尚未核对')
  const shippedByGroup = new Map()
  for (const d of prior) shippedByGroup.set(Number(d.group_id),roundQty((shippedByGroup.get(Number(d.group_id))||0)+Number(d.quantity)))
  const [wti] = await conn.query('SELECT id,product_id,product_name,picked_qty,required_qty FROM warehouse_task_items WHERE task_id=? ORDER BY id FOR UPDATE', [task.id])
  const vector = new Map(), money = []
  for (const d of dispatch) {
    const g = byId.get(Number(d.group_id)); if (!g || Number(g.warehouseId)!==Number(task.warehouse_id)) invalid('本批成交明细与仓库任务不一致')
    const before = shippedByGroup.get(g.id)||0, after = roundQty(before+Number(d.quantity))
    if (after>g.targetQty) invalid('本批发货超过订单当前数量')
    const projection = projectCommercialBatch(snapshot(g), { beforeQty:before,afterQty:after })
    money.push({ dispatchId:Number(d.id),group:g,quantity:Number(d.quantity),projection })
    for (const c of g.components) vector.set(c.productId,roundQty((vector.get(c.productId)||0)+(g.kind==='kit'?c.baseQty*Number(d.quantity):Number(d.quantity))))
  }
  if (vector.size!==wti.length || wti.some(i => Number(i.picked_qty)!==vector.get(Number(i.product_id)) || Number(i.required_qty)!==vector.get(Number(i.product_id)))) invalid('实际拣货数量与本批套内配件不一致')
  const [physical] = await conn.query('SELECT product_id,unit_price FROM sale_order_items WHERE order_id=? AND warehouse_id=?', [sale.id,task.warehouse_id])
  const prices = new Map(physical.map(p => [Number(p.product_id),Number(p.unit_price)]))
  const basis=prior.length ? {orderGross:Number(prior[0].order_gross_basis),discount:Number(prior[0].discount_basis)} : {orderGross:Number(sale.total_amount),discount:Number(sale.discount_amount)}
  if(!(basis.orderGross>0))invalid('原出库批次缺少折扣依据')
  return { money,basis, items:wti.map(i => ({ productId:Number(i.product_id),productName:i.product_name,quantity:Number(i.picked_qty),unitPrice:prices.get(Number(i.product_id)) })) }
}
async function confirmShipment(conn, prepared) {
  const rows = prepared.money.flatMap(m => m.group.components.map((c,n) => [m.dispatchId,c.id,m.group.kind==='kit'?roundQty(c.baseQty*m.quantity):m.quantity,m.projection.components[n].amount]))
  if (rows.length) await conn.query('INSERT INTO sale_dispatch_component_money (dispatch_group_id,component_id,source_qty,confirmed_amount) VALUES ?', [rows])
  if (prepared.money.length) {
    const cases=prepared.money.map(()=>'WHEN ? THEN ?').join(' ')
    await conn.query(`UPDATE sale_dispatch_groups SET confirmed_gross=CASE id ${cases} ELSE confirmed_gross END,confirmed_at=NOW(),basis_origin='real_confirmation',order_gross_basis=?,discount_basis=? WHERE id IN (?) AND confirmed_at IS NULL`,[...prepared.money.flatMap(m=>[m.dispatchId,m.projection.grossAmount]),prepared.basis.orderGross,prepared.basis.discount,prepared.money.map(m=>m.dispatchId)])
  }
}
module.exports = { orderMoney, prepareShipment, confirmShipment, invalid }
