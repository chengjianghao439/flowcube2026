'use strict'
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
  // Never delete a historical physical row. All references (returns/reservations/tasks) retain their IDs.
  await conn.query('UPDATE sale_order_items SET quantity=0,amount=0 WHERE order_id=?', [orderId])
  const rows = resolved.items.map(i => [byPair.get(`${i.productId}:${i.warehouseId}`)?.id || null,orderId,i.warehouseId,i.warehouseName,i.productId,i.productCode,i.productName,i.unit,i.entryUnit,i.articleNumber||null,i.spec||null,i.color||null,i.quantity,i.entryQty,i.conversionRate,i.unitPrice,i.amount])
  if (rows.length) await conn.query(`INSERT INTO sale_order_items (id,order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount) VALUES ?
    ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),entry_qty=VALUES(entry_qty),conversion_rate=VALUES(conversion_rate),unit_price=VALUES(unit_price),amount=VALUES(amount)`, [rows])
  const [physical] = await conn.query('SELECT id,product_id,warehouse_id FROM sale_order_items WHERE order_id=? ORDER BY id', [orderId])
  const ids = new Map(physical.map(p => [`${Number(p.product_id)}:${Number(p.warehouse_id)}`, Number(p.id)]))
  const retained = resolved.groups.filter(g => g.retained).map(g => g.id)
  if (retained.length) await conn.query('UPDATE sale_commercial_groups SET superseded=1 WHERE order_id=? AND superseded=0 AND id NOT IN (?)', [orderId,retained])
  else await conn.query('UPDATE sale_commercial_groups SET superseded=1 WHERE order_id=? AND superseded=0', [orderId])
  // At most 200 group inserts; one insert batch and one component batch, retained targets one CASE update.
  const keep = resolved.groups.filter(g => g.retained)
  if (keep.length) {
    const cases = keep.map(() => 'WHEN ? THEN ?').join(' ')
    await conn.query(`UPDATE sale_commercial_groups SET target_qty=CASE id ${cases} ELSE target_qty END WHERE id IN (?)`, [...keep.flatMap(g => [g.id,g.targetQty]), keep.map(g => g.id)])
  }
  const fresh = resolved.groups.filter(g => !g.retained)
  if (fresh.length) await conn.query('INSERT INTO sale_commercial_groups (order_id,line_key,snapshot_revision,kind,warehouse_id,kit_version_id,kit_code,kit_name,original_qty,target_qty,unit_price,price_source,gross_amount,metadata_json) VALUES ?', [fresh.map(g => [orderId,g.lineKey,revision,g.kind,g.warehouseId,g.kitVersionId,g.kitCode,g.kitName,g.originalQty,g.targetQty,g.unitPrice,g.priceSource,g.grossAmount,JSON.stringify(g.metadata)])])
  const [created] = fresh.length ? await conn.query('SELECT id,line_key FROM sale_commercial_groups WHERE order_id=? AND snapshot_revision=?', [orderId,revision]) : [[]]
  const groupIds = new Map(created.map(g => [g.line_key, Number(g.id)]))
  const componentRows = fresh.flatMap(g => g.components.map(c => [groupIds.get(g.lineKey),ids.get(`${c.productId}:${g.warehouseId}`),c.productId,c.sortNo,c.baseQty,c.requiredQty,c.referencePrice,c.amountWeight,c.allocatedAmount,c.productCode,c.productName,c.unit,c.articleNumber||null,c.spec||null,c.color||null]))
  if (componentRows.length) await conn.query('INSERT INTO sale_commercial_components (group_id,sale_item_id,product_id,sort_no,base_qty,required_qty,reference_price,amount_weight,allocated_amount,product_code,product_name,unit,article_number,spec,color) VALUES ?', [componentRows])
  await conn.query("UPDATE sale_orders SET commercial_model='kit-v1',commercial_revision=?,total_amount=? WHERE id=?", [revision,resolved.total,orderId])
}
function assertModel(row,input) {
  if (row.commercial_model === 'kit-v1') {
    if (input?.commercialModel !== 'kit-v1' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<=0) throw new AppError('当前客户端暂不能处理套单，请先保留输入并更新客户端',400,'SALE_COMMERCIAL_VERSION_REQUIRED')
  } else if (input?.commercialModel != null) throw new AppError('普通销售单不能改成套单，请单独新建套单',400,'SALE_COMMERCIAL_MODEL_MISMATCH')
}
function assertRequestKey(model,requestKey) {
  if(model!=='kit-v1')return
  if(typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>128||[...requestKey].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))throw new AppError('本次操作缺少有效的重试凭据，请保留输入并更新客户端',400,'SALE_COMMERCIAL_REQUEST_KEY_REQUIRED')
}
function assertRevision(row,input) {
  if (row.commercial_model === 'kit-v1' && Number(row.commercial_revision)!==Number(input.expectedRevision)) throw new AppError('销售单已更新，本次未保存，请保留草稿并重新核对',409,'SALE_COMMERCIAL_REVISION_CONFLICT')
}
module.exports = { loadGroups, view, save, assertModel, assertRevision, assertRequestKey }
