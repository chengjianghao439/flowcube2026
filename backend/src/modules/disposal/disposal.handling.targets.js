'use strict'
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertQtyPrecisionWith, assertQtyScale } = require('../../utils/qtyPrecision')
const { assertSqlIdentifier } = require('../../utils/sqlIdentifier')
const rules = require('./disposal.handling.rules')
const operations = require('./disposal.handling.operations')
const { validateReference } = require('./disposal.handling.contracts')

// Closed, static mapping: no identifier/action supplied by a request enters SQL.
const TARGETS = Object.freeze({
  sale_order: { handlingType: 1, action: 'disposal.handling.sale.create', head: 'sale_orders', line: 'sale_order_items', parent: 'order_id', number: 'order_no', responseNumber: 'orderNo' },
  purchase_return: { handlingType: 2, action: 'disposal.handling.purchase_return.create', head: 'purchase_returns', line: 'purchase_return_items', parent: 'return_id', number: 'return_no', responseNumber: 'returnNo' },
  inventory_disposal: { handlingType: 3, action: 'disposal.handling.scrap.create', head: 'inventory_disposal_orders', line: 'inventory_disposal_items', parent: 'disposal_id', number: 'disposal_no', responseNumber: 'disposalNo' },
})
const invalid = () => new AppError('原处理关联或结果身份不一致，请保留原请求人工核对', 409, 'DISPOSAL_HANDLING_RECEIPT_INVALID')
function metadata(type) {
  const meta = TARGETS[type]
  if (!meta) throw invalid()
  for (const field of ['head', 'line', 'parent', 'number']) assertSqlIdentifier(meta[field], '处理目标静态标识符')
  return meta
}
function isTargetAction(action) { return Object.values(TARGETS).some(meta => meta.action === action) }
async function prepare(conn, { reference, type, authorized, payload, requestKey, operator, scopeWarehouseIds = null }) {
  const ref = validateReference(reference), meta = metadata(type)
  if (authorized !== true) throw new AppError('无权查看处理来源', 403, 'PERMISSION_DENIED')
  const userId = rules.safeId(operator?.userId, '操作者ID'), key = rules.requestKey(requestKey)
  const [[source]] = await conn.query('SELECT * FROM disposal_handling_sources WHERE id=? FOR UPDATE', [ref.sourceId])
  if (!source || Number(source.id) !== ref.sourceId) throw new AppError('处理来源不存在', 404, 'DISPOSAL_HANDLING_SOURCE_MISSING')
  rules.assertSource(source)
  assertInScope(scopeWarehouseIds, source.warehouse_id, '处理来源')
  if (Number(source.handling_type) !== meta.handlingType) throw new AppError('处理方式与目标业务不一致', 409, 'DISPOSAL_HANDLING_TYPE_INVALID')
  const payloadJson = rules.stableJson(payload)
  const identity = { operationUuid: ref.operationUuid, intentUuid: rules.uuid(source.intent_uuid), action: meta.action, userId, requestKey: key, payloadJson, payloadHash: rules.fingerprint(payloadJson) }
  const replay = await operations.begin(conn, identity)
  if (replay) return { response: await readReceipt(conn, replay, scopeWarehouseIds, { source, currentRead: true }) }
  // A revision change must not prevent recovery of the original permanent ACK above.
  if (Number(source.revision) !== ref.expectedRevision) throw new AppError('处理来源已变化，请重新核对可分配量', 409, 'DISPOSAL_HANDLING_REVISION_CHANGED')
  const [links] = await conn.query('SELECT * FROM disposal_handling_links WHERE source_id=? ORDER BY id FOR SHARE', [source.id])
  const budget = rules.calculateBudget(source, links)
  return { source, identity, type, meta, scopeWarehouseIds, budget }
}
async function validateItems(conn, context, items, warehouseId) {
  const { source, scopeWarehouseIds } = context
  if (!Array.isArray(items) || items.length !== 1 || Number(warehouseId) !== Number(source.warehouse_id)) throw new AppError('关联目标必须是同商品、同仓的一条普通明细', 409, 'DISPOSAL_HANDLING_TARGET_INVALID')
  const item = items[0]
  if (Number(item.productId) !== Number(source.product_id) || Number(item.warehouseId ?? warehouseId) !== Number(source.warehouse_id) || item.unit !== source.unit) throw new AppError('目标商品、仓库或基本单位与来源不一致', 409, 'DISPOSAL_HANDLING_TARGET_INVALID')
  const [[warehouse]] = await conn.query('SELECT id,is_active,deleted_at FROM inventory_warehouses WHERE id=? FOR SHARE', [source.warehouse_id])
  const [[product]] = await conn.query('SELECT id,name,unit,is_active,deleted_at,allow_decimal_qty FROM product_items WHERE id=? FOR SHARE', [source.product_id])
  assertInScope(scopeWarehouseIds, source.warehouse_id, '处理来源')
  if (!warehouse || Number(warehouse.id) !== Number(source.warehouse_id) || warehouse.deleted_at || Number(warehouse.is_active) !== 1
    || !product || Number(product.id) !== Number(source.product_id) || product.deleted_at || Number(product.is_active) !== 1) throw new AppError('关联商品或仓库已停用/删除，请核对主档', 409, 'DISPOSAL_HANDLING_MASTER_INVALID')
  if (product.unit !== source.unit) throw new AppError('商品基本单位已变化，请核对原意图', 409, 'DISPOSAL_HANDLING_UNIT_CHANGED')
  assertQtyScale(item.quantity, '关联基本量')
  if (!(Number(item.quantity) > 0) || Number(item.quantity) > 9999999999.99) throw new AppError('关联基本量不正确', 400, 'QTY_INVALID')
  assertQtyPrecisionWith({ name: product.name, allowDecimal: product.allow_decimal_qty == null || Number(product.allow_decimal_qty) === 1 }, item.quantity, '关联基本量')
  // Source X is still held; compare folded A against that same current budget, without a second query.
  const budget = context.budget
  if (Math.round(Number(item.quantity) * 100) > Math.round(budget.availableQuantity * 100)) throw new AppError('关联基本量超过处理来源剩余可分配量', 409, 'DISPOSAL_HANDLING_BUDGET_EXCEEDED')
  context.quantity = Number(item.quantity)
  context.purchaseItemId = context.type === 'purchase_return' ? rules.safeId(item.sourceItemId) : null
}
async function complete(conn, context, result) {
  const { source, identity, type, meta, quantity } = context
  const targetId = rules.safeId(result?.id)
  // Read the real inserted line ID. Historical line IDs intentionally have no FK to mutable rows.
  assertSqlIdentifier(meta.line, '处理目标明细表'); assertSqlIdentifier(meta.parent, '处理目标明细归属列')
  const extraColumns = type === 'sale_order' ? ',warehouse_id' : type === 'purchase_return' ? ',purchase_item_id' : ''
  const [lines] = await conn.query(`SELECT id,product_id,unit,quantity${extraColumns} FROM ${meta.line} WHERE ${meta.parent}=? FOR SHARE`, [targetId])
  if (lines.length !== 1 || Number(lines[0].product_id) !== Number(source.product_id) || lines[0].unit !== source.unit || Number(lines[0].quantity) !== quantity
    || type === 'sale_order' && Number(lines[0].warehouse_id) !== Number(source.warehouse_id)
    || type === 'purchase_return' && Number(lines[0].purchase_item_id) !== context.purchaseItemId) throw invalid()
  const lineId = rules.safeId(lines[0].id), responseJson = rules.stableJson(result)
  if (typeof result[meta.responseNumber] !== 'string' || !result[meta.responseNumber] || Object.keys(result).length !== 2) throw invalid()
  const [inserted] = await conn.query(`INSERT INTO disposal_handling_links
    (source_id,target_type,target_id,target_line_id,product_id,warehouse_id,unit,allocated_quantity,created_operation_uuid,response_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [source.id, type, targetId, lineId, source.product_id, source.warehouse_id, source.unit, quantity, identity.operationUuid, responseJson])
  const linkId = rules.safeId(inserted.insertId)
  assertSqlIdentifier(meta.head, '处理目标头表')
  const [marker] = await conn.query(`UPDATE ${meta.head} SET disposal_handling_link_id=? WHERE id=? AND disposal_handling_link_id IS NULL`, [linkId, targetId])
  if (marker.affectedRows !== 1) throw invalid()
  const [revision] = await conn.query('UPDATE disposal_handling_sources SET revision=revision+1 WHERE id=? AND revision=?', [source.id, source.revision])
  if (revision.affectedRows !== 1) throw invalid()
  await operations.completeTarget(conn, identity, { sourceId: source.id, type, targetId, lineId }, result)
}
async function readReceipt(conn, operation, scopeWarehouseIds = null, { source = null, currentRead = false } = {}) {
  const type = operation.target_type, meta = metadata(type), lock = currentRead ? ' FOR SHARE' : ''
  if (operation.action !== meta.action || operation.resource_type !== type || Number(operation.resource_id) !== Number(operation.target_id)) throw invalid()
  for (const field of ['source_id', 'target_id', 'target_line_id']) if (!Number.isSafeInteger(Number(operation[field])) || Number(operation[field]) <= 0) throw invalid()
  let body, result
  try {
    body = JSON.parse(operation.payload_json); result = JSON.parse(operation.response_json)
    const ref = validateReference(body.disposalSource)
    if (rules.stableJson(body) !== operation.payload_json || rules.fingerprint(operation.payload_json) !== operation.payload_hash || ref.sourceId !== Number(operation.source_id) || ref.operationUuid !== operation.operation_uuid
      || Number(result.id) !== Number(operation.target_id) || Object.keys(result).length !== 2 || typeof result[meta.responseNumber] !== 'string' || !result[meta.responseNumber]) throw invalid()
  } catch { throw invalid() }
  if (!source) { const [[row]] = await conn.query('SELECT * FROM disposal_handling_sources WHERE id=?' + lock, [operation.source_id]); source = row }
  if (!source || Number(source.id) !== Number(operation.source_id) || source.intent_uuid !== operation.intent_uuid || Number(source.handling_type) !== meta.handlingType) throw invalid()
  assertInScope(scopeWarehouseIds, source.warehouse_id, '处理来源')
  const [links] = await conn.query('SELECT * FROM disposal_handling_links WHERE created_operation_uuid=?' + lock, [operation.operation_uuid])
  if (links.length !== 1) throw invalid()
  const link = links[0]
  rules.calculateBudget(source, links)
  if (link.target_type !== type || Number(link.target_id) !== Number(operation.target_id) || Number(link.target_line_id) !== Number(operation.target_line_id) || link.response_json !== operation.response_json || link.created_operation_uuid !== operation.operation_uuid) throw invalid()
  assertSqlIdentifier(meta.head, '处理目标头表'); assertSqlIdentifier(meta.number, '处理目标单号列')
  const [[head]] = await conn.query(`SELECT id,warehouse_id,${meta.number},disposal_handling_link_id${type === 'sale_order' ? ',commercial_model' : ''} FROM ${meta.head} WHERE id=?${lock}`, [operation.target_id])
  if (!head || Number(head.id) !== Number(operation.target_id) || Number(head.disposal_handling_link_id) !== Number(link.id) || head[meta.number] !== result[meta.responseNumber] || Number(head.warehouse_id) !== Number(source.warehouse_id) || type === 'sale_order' && head.commercial_model != null) throw invalid()
  assertInScope(scopeWarehouseIds, head.warehouse_id, '原处理目标')
  if (type === 'sale_order') {
    const [rows] = await conn.query('SELECT warehouse_id FROM sale_order_items WHERE order_id=?' + lock, [operation.target_id])
    for (const row of rows) assertInScope(scopeWarehouseIds, row.warehouse_id ?? head.warehouse_id, '原处理目标')
  }
  return result
}
module.exports = { prepare, validateItems, complete, readReceipt, isTargetAction }
