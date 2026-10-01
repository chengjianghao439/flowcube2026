'use strict'
const {partialReleaseByProduct}=require('../../engine/reservationEngine')
const {lockStockDimension,CONTAINER_STATUS}=require('../../engine/containerEngine')
const AppError=require('../../utils/AppError')
const invalid=reason=>{throw new AppError(`套单拣货归还记录不一致：${reason}，请联系管理员核对原拣货记录`,409,'SALE_COMMERCIAL_PICK_SOURCE_INVALID')}
function quantityUnits(value){const n=Number(value),u=Math.round(n*100);if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(u))invalid('数量无效');return u}
async function refreshReserved(conn,orderId) {
  await conn.query(`UPDATE sale_order_items i SET reserved_qty=(SELECT COALESCE(SUM(r.qty),0) FROM stock_reservations r WHERE r.ref_type='sale_order' AND r.ref_id=i.order_id AND r.product_id=i.product_id AND r.warehouse_id=i.warehouse_id AND r.status=1) WHERE i.order_id=?`,[orderId])
}
// Caller holds SO/WT, then dimensions and containers. Read only active PICK facts,
// including the historical NULL=1 convention; CHECK/CANCEL_RETURN are not picks.
async function pickedQuantities(conn,tasks,items,containers) {
  if(!containers.length)return new Map()
  const byTask=new Map(tasks.map(t=>[Number(t.id),t])),byItem=new Map(items.map(i=>[Number(i.id),i])),byContainer=new Map(containers.map(c=>[Number(c.id),c]))
  const [scans]=await conn.query('SELECT id,task_id,item_id,container_id,product_id,qty FROM scan_logs WHERE task_id IN (?) AND container_id IN (?) AND COALESCE(scan_purpose,1)=1 ORDER BY id FOR UPDATE',[tasks.map(t=>t.id),containers.map(c=>c.id)])
  const picked=new Map(),byItemQty=new Map()
  for(const s of scans){
    const c=byContainer.get(Number(s.container_id)),t=byTask.get(Number(s.task_id)),i=byItem.get(Number(s.item_id)),qty=quantityUnits(s.qty)
    if(!c||!t||!i||!qty||Number(c.locked_by_task_id)!==Number(t.id)||Number(i.task_id)!==Number(t.id)||Number(i.product_id)!==Number(c.product_id)||Number(s.product_id)!==Number(c.product_id)||Number(c.warehouse_id)!==Number(t.warehouse_id))invalid('原拣货与任务、商品或仓库不符')
    picked.set(Number(c.id),(picked.get(Number(c.id))||0)+qty)
    byItemQty.set(Number(i.id),(byItemQty.get(Number(i.id))||0)+qty)
  }
  for(const c of containers){const qty=picked.get(Number(c.id));if(Number(c.status)!==CONTAINER_STATUS.ACTIVE||c.deleted_at!=null)invalid('待归还条码不是有效在库实物');if(!qty)invalid('待归还条码缺少有效拣货记录');if(qty>quantityUnits(c.remaining_qty))invalid('原拣货数量超过条码实物量')}
  for(const i of items)if((byItemQty.get(Number(i.id))||0)>quantityUnits(i.picked_qty))invalid('原拣货数量超过任务已拣量')
  return picked
}
async function releaseUnpicked(conn,orderId) {
  const [physical]=await conn.query('SELECT product_id,warehouse_id FROM sale_order_items WHERE order_id=? ORDER BY product_id,warehouse_id FOR UPDATE',[orderId])
  const [tasks]=await conn.query('SELECT id,sale_order_id,warehouse_id FROM warehouse_tasks WHERE sale_order_id=? AND cancel_requested_at IS NOT NULL ORDER BY id FOR UPDATE',[orderId])
  const [items]=tasks.length?await conn.query('SELECT id,task_id,product_id,picked_qty FROM warehouse_task_items WHERE task_id IN (?) ORDER BY task_id,id FOR UPDATE',[tasks.map(t=>t.id)]):[[]]
  // Dimensions precede every container/scan/reservation lock. Stable physical
  // rows include pending history; no current RR aggregate is used as quantity proof.
  const dimensions=new Map(physical.map(p=>[`${p.product_id}:${p.warehouse_id}`,p]))
  for(const p of dimensions.values())await lockStockDimension(conn,Number(p.product_id),Number(p.warehouse_id))
  const [containers]=tasks.length?await conn.query('SELECT id,product_id,warehouse_id,remaining_qty,locked_by_task_id,status,deleted_at FROM inventory_containers WHERE locked_by_task_id IN (?) ORDER BY id FOR UPDATE',[tasks.map(t=>t.id)]):[[]]
  const picks=await pickedQuantities(conn,tasks,items,containers),keep=new Map()
  for(const c of containers){const key=`${c.product_id}:${c.warehouse_id}`;if(!dimensions.has(key))invalid('待归还配件不属于当前销售单');keep.set(key,(keep.get(key)||0)+picks.get(Number(c.id)))}
  const [reserved]=await conn.query("SELECT id,product_id,warehouse_id,qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1 ORDER BY product_id,warehouse_id,id FOR UPDATE",[orderId])
  const totals=new Map()
  for(const r of reserved){const key=`${r.product_id}:${r.warehouse_id}`;if(!dimensions.has(key))invalid('预占配件不属于当前销售单');totals.set(key,(totals.get(key)||0)+quantityUnits(r.qty))}
  for(const [key,qty] of keep)if(qty>(totals.get(key)||0))invalid('已拣待归还量超过本单预占')
  for(const [key,total] of totals){const qty=total-(keep.get(key)||0),p=dimensions.get(key);if(qty)await partialReleaseByProduct(conn,{refType:'sale_order',refId:orderId,productId:Number(p.product_id),warehouseId:Number(p.warehouse_id),qty:qty/100})}
  await conn.query('UPDATE sale_dispatch_groups SET active=0 WHERE order_id=? AND confirmed_at IS NULL',[orderId])
  await refreshReserved(conn,orderId)
}
async function lockReturnOrder(conn,taskId) {
  const [[identity]]=await conn.query('SELECT t.sale_order_id,s.commercial_model FROM warehouse_tasks t JOIN sale_orders s ON s.id=t.sale_order_id WHERE t.id=?',[taskId])
  if(identity?.commercial_model!=='kit-v1')return null
  // SO mutex coordinates shared reservations; warehouse execution permission
  // belongs to the current WT/device, not the SO header warehouse.
  const [[order]]=await conn.query('SELECT id FROM sale_orders WHERE id=? FOR UPDATE',[identity.sale_order_id])
  return Number(order.id)
}
async function releaseReturned(conn,orderId,task,container,itemId) {
  if(Number(task.sale_order_id)!==Number(orderId)||Number(container.locked_by_task_id)!==Number(task.id))invalid('归还条码不属于当前销售任务')
  const [items]=await conn.query('SELECT id,task_id,product_id,picked_qty FROM warehouse_task_items WHERE id=? AND task_id=? FOR UPDATE',[itemId,task.id])
  const picks=await pickedQuantities(conn,[task],items,[container]),qty=picks.get(Number(container.id))/100
  await partialReleaseByProduct(conn,{refType:'sale_order',refId:orderId,productId:Number(container.product_id),warehouseId:Number(container.warehouse_id),qty})
  await refreshReserved(conn,orderId)
  return qty
}
module.exports={releaseUnpicked,lockReturnOrder,releaseReturned}
