'use strict'
const { assertModel, assertRevision } = require('./sale.edit-baseline')
const AppError = require('../../utils/AppError')
const { snapshot } = require('./sale.commercial-resolver')
const { projectCommercialCumulative } = require('./sale.commercial-money.math')
async function loadGroups(conn, orderId, { current = true, lock = false } = {}) {
  const [groups] = await conn.query(`SELECT * FROM sale_commercial_groups WHERE order_id=? ${current ? 'AND superseded=0' : ''} ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [orderId])
  if (!groups.length) return []
  const [components] = await conn.query('SELECT * FROM sale_commercial_components WHERE group_id IN (?) ORDER BY group_id,sort_no,id', [groups.map(g => g.id)])
  return groups.map(g => ({ id:Number(g.id), lineKey:g.line_key, snapshotRevision:Number(g.snapshot_revision), kind:g.kind, warehouseId:Number(g.warehouse_id), kitVersionId:g.kit_version_id == null ? null : Number(g.kit_version_id), kitCode:g.kit_code,kitName:g.kit_name,originalQty:Number(g.original_qty),targetQty:Number(g.target_qty),unitPrice:Number(g.unit_price),priceSource:g.price_source,grossAmount:Number(g.gross_amount),metadata: typeof g.metadata_json === 'string' ? JSON.parse(g.metadata_json) : g.metadata_json, superseded: !!g.superseded, components: components.filter(c => Number(c.group_id)===Number(g.id)).map(c => ({ id:Number(c.id),saleItemId:Number(c.sale_item_id),productId:Number(c.product_id),sortNo:Number(c.sort_no),baseQty:Number(c.base_qty),requiredQty:Number(c.required_qty),referencePrice:Number(c.reference_price),amountWeight:c.amount_weight,allocatedAmount:Number(c.allocated_amount),productCode:c.product_code,productName:c.product_name,unit:c.unit,articleNumber:c.article_number,spec:c.spec,color:c.color })) }))
}
function view(g) {
  const projected = projectCommercialCumulative(snapshot(g), g.targetQty)
  return { ...g, active:g.targetQty>0, quantity:g.targetQty, amount:projected.grossAmount, originalAmount:g.grossAmount, entry:g.metadata.entry, components:g.components.map((c,n) => ({ ...c, quantity:g.kind==='kit'?c.baseQty*g.targetQty:g.targetQty,amount:projected.components[n].amount })) }
}
async function save(conn, orderId, revision, resolved) {
  const [old] = await conn.query('SELECT * FROM sale_order_items WHERE order_id=? ORDER BY id FOR UPDATE', [orderId])
  const byPair = new Map()
  for (const r of old) {
    const key = `${Number(r.product_id)}:${Number(r.warehouse_id)}`
    if (byPair.has(key)) throw new AppError('商品明细重复，无法保存套单，请保留输入并联系管理员',409,'SALE_COMMERCIAL_PHYSICAL_DUPLICATE')
    byPair.set(key, r)
  }
  const retainedOnly = new Map()
  for (const g of resolved.groups) for (const c of g.components) {
    const key = `${c.productId}:${g.warehouseId}`
    retainedOnly.set(key, (retainedOnly.get(key) ?? true) && !!g.retained)
  }
  const items = resolved.items.map(i => {
    const key = `${i.productId}:${i.warehouseId}`, original = byPair.get(key)
    // An unchanged retained group keeps its exact saved entry/price facts.
    // A newly recorded group uses the resolver's current fixed product unit.
    if (original && retainedOnly.get(key) && original.unit === i.unit
      && Number(original.quantity) === Number(i.quantity) && Number(original.amount) === Number(i.amount)) {
      return { ...i, unit: original.unit, entryUnit: original.entry_unit, entryQty: original.entry_qty,
        conversionRate: original.conversion_rate, unitPrice: original.unit_price, amount: original.amount,
        allowDecimalQtySnapshot: original.allow_decimal_qty_snapshot }
    }
    return i
  })
  const changedUnitIds = items.filter(i => {
    const original = byPair.get(`${i.productId}:${i.warehouseId}`)
    return original && (original.unit !== i.unit || (original.entry_unit ?? original.unit) !== (i.entryUnit ?? i.unit))
  }).map(i => Number(byPair.get(`${i.productId}:${i.warehouseId}`).id))
  if (changedUnitIds.length) {
    // Reusing an unfulfilled draft row is safe. Once it has fulfillment or
    // return references, changing its unit would rewrite historical facts.
    const [history] = await conn.query(`SELECT i.id FROM sale_order_items i JOIN sale_orders o ON o.id=i.order_id
      WHERE i.id IN (?) AND (o.status<>1 OR i.reserved_qty<>0 OR i.dispatched_qty<>0 OR i.shipped_qty<>0
        OR EXISTS (SELECT 1 FROM warehouse_task_items ti JOIN warehouse_tasks t ON t.id=ti.task_id WHERE t.sale_order_id=i.order_id AND ti.product_id=i.product_id AND t.warehouse_id=i.warehouse_id)
        OR EXISTS (SELECT 1 FROM sale_return_items r WHERE r.sale_item_id=i.id)
        OR EXISTS (SELECT 1 FROM stock_reservations s WHERE s.ref_type='sale_order' AND s.ref_id=i.order_id AND s.product_id=i.product_id AND s.warehouse_id=i.warehouse_id)
        OR EXISTS (SELECT 1 FROM sale_order_expected_bindings b WHERE b.sale_order_id=i.order_id AND b.product_id=i.product_id AND b.warehouse_id=i.warehouse_id)) LIMIT 1`, [changedUnitIds])
    if (history.length) throw new AppError('该商品行已有履约或退货历史，不能改写原单位；请保留原行并按当前单位另建销售单',409,'SALE_FIXED_UNIT_CHANGED')
  }
  // Never delete a historical physical row. All references (returns/reservations/tasks) retain their IDs.
  await conn.query('UPDATE sale_order_items SET quantity=0,amount=0 WHERE order_id=?', [orderId])
  const rows = items.map(i => [byPair.get(`${i.productId}:${i.warehouseId}`)?.id || null,orderId,i.warehouseId,i.warehouseName,i.productId,i.productCode,i.productName,i.unit,i.entryUnit,i.articleNumber||null,i.spec||null,i.color||null,i.quantity,i.entryQty,i.conversionRate,i.unitPrice,i.amount,i.allowDecimalQtySnapshot ?? null])
  if (rows.length) await conn.query(`INSERT INTO sale_order_items (id,order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount,allow_decimal_qty_snapshot) VALUES ?
    ON DUPLICATE KEY UPDATE unit=VALUES(unit),entry_unit=VALUES(entry_unit),quantity=VALUES(quantity),entry_qty=VALUES(entry_qty),conversion_rate=VALUES(conversion_rate),unit_price=VALUES(unit_price),amount=VALUES(amount),allow_decimal_qty_snapshot=VALUES(allow_decimal_qty_snapshot)`, [rows])
  const [physical] = await conn.query('SELECT id,product_id,warehouse_id FROM sale_order_items WHERE order_id=? ORDER BY id', [orderId])
  const ids = new Map(physical.map(p => [`${Number(p.product_id)}:${Number(p.warehouse_id)}`, Number(p.id)]))
  const retained = resolved.groups.filter(g => g.retained).map(g => g.id)
  if (retained.length) await conn.query('UPDATE sale_commercial_groups SET superseded=1 WHERE order_id=? AND superseded=0 AND id NOT IN (?)', [orderId,retained])
  else await conn.query('UPDATE sale_commercial_groups SET superseded=1 WHERE order_id=? AND superseded=0', [orderId])
  // At most 200 group inserts; one insert batch and one component batch, retained targets one CASE update.
  const keep = resolved.groups.filter(g => g.retained)
  if (keep.length) {
    const cases = keep.map(() => 'WHEN ? THEN ?').join(' ')
    await conn.query(`UPDATE sale_commercial_groups SET target_qty=CASE id ${cases} ELSE target_qty END,metadata_json=CASE id ${cases} ELSE metadata_json END WHERE id IN (?)`, [...keep.flatMap(g => [g.id,g.targetQty]), ...keep.flatMap(g => [g.id,JSON.stringify(g.metadata)]), keep.map(g => g.id)])
  }
  const fresh = resolved.groups.filter(g => !g.retained)
  if (fresh.length) await conn.query('INSERT INTO sale_commercial_groups (order_id,line_key,snapshot_revision,kind,warehouse_id,kit_version_id,kit_code,kit_name,original_qty,target_qty,unit_price,price_source,gross_amount,metadata_json) VALUES ?', [fresh.map(g => [orderId,g.lineKey,revision,g.kind,g.warehouseId,g.kitVersionId,g.kitCode,g.kitName,g.originalQty,g.targetQty,g.unitPrice,g.priceSource,g.grossAmount,JSON.stringify(g.metadata)])])
  const [created] = fresh.length ? await conn.query('SELECT id,line_key FROM sale_commercial_groups WHERE order_id=? AND snapshot_revision=?', [orderId,revision]) : [[]]
  const groupIds = new Map(created.map(g => [g.line_key, Number(g.id)]))
  const componentRows = fresh.flatMap(g => g.components.map(c => [groupIds.get(g.lineKey),ids.get(`${c.productId}:${g.warehouseId}`),c.productId,c.sortNo,c.baseQty,c.requiredQty,c.referencePrice,c.amountWeight,c.allocatedAmount,c.productCode,c.productName,c.unit,c.articleNumber||null,c.spec||null,c.color||null]))
  if (componentRows.length) await conn.query('INSERT INTO sale_commercial_components (group_id,sale_item_id,product_id,sort_no,base_qty,required_qty,reference_price,amount_weight,allocated_amount,product_code,product_name,unit,article_number,spec,color) VALUES ?', [componentRows])
  await conn.query("UPDATE sale_orders SET commercial_model='kit-v1',commercial_revision=?,total_amount=? WHERE id=?", [revision,resolved.total,orderId])
}
function assertRequestKey(model,requestKey) {
  if(model!=='kit-v1')return
  if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>128||[...requestKey].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))throw new AppError('本次操作缺少有效的重试凭据，请保留输入并更新客户端',400,'SALE_COMMERCIAL_REQUEST_KEY_REQUIRED')
}
module.exports = { loadGroups, view, save, assertModel, assertRevision, assertRequestKey }
