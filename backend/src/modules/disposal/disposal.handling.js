'use strict'
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')
const { assertQtyPrecisionWith } = require('../../utils/qtyPrecision')
const { assertSqlColumnList } = require('../../utils/sqlIdentifier')
const rules = require('./disposal.handling.rules')
const operations = require('./disposal.handling.operations')
const facts = require('./disposal.handling.facts')
const proof = require('./disposal.handling.proof')
const release = require('./disposal.handling.release')
const invalidReceipt = () => new AppError('原处理结果身份不完整，请保留请求并人工核对', 409, 'DISPOSAL_HANDLING_RECEIPT_INVALID')
function sourceResponse(row) {
  rules.assertSource(row)
  if (![1, 2, 3].includes(Number(row.handling_type)) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) <= 0) throw invalidReceipt()
  try { if (rules.uuid(row.intent_uuid) !== row.intent_uuid) throw invalidReceipt() } catch { throw invalidReceipt() }
  return { id: Number(row.id), intentUuid: row.intent_uuid, productId: Number(row.product_id), warehouseId: Number(row.warehouse_id), unit: row.unit, handlingType: Number(row.handling_type), quantity: Number(row.quantity), revision: Number(row.revision) }
}
function sourceView(row, links, progress, scope, views) {
  const ordinary = row.legacy_disposal_id == null && row.legacy_disposal_item_id == null
  if (!ordinary && (!proof.id(row.legacy_disposal_id) || !proof.id(row.legacy_disposal_item_id))) throw invalidReceipt()
  const budget = rules.calculateBudget(row, links)
  const explanations = links.map(link => {
    const fact = progress.get(Number(link.id)), item = { linkId: Number(link.id), state: link.state, allocatedQuantity: Number(link.allocated_quantity), releasedQuantity: Number(link.released_quantity), executedQuantity: fact.executedQuantity, terminal: fact.terminal, returnClosed: fact.returnClosed, pendingReason: fact.pendingReason }
    if (views?.[link.target_type] === true) {
      try {
        proof.createIdentity(row, link, fact.context.head, fact.context.operation)
        proof.assertScope(fact.context, scope)
        const meta = proof.metadata(link.target_type), head = fact.context.head
        item.target = { type: link.target_type, id: Number(head.id), orderNo: head[meta.number], path: meta.path + head.id, status: Number(head.status) }
        if (link.target_type === 'sale_order') Object.assign(item.target, { customerId: head.customer_id, customerName: head.customer_name })
        if (link.target_type === 'purchase_return') Object.assign(item.target, { supplierId: head.supplier_id, supplierName: head.supplier_name })
      } catch (error) { if (!['WAREHOUSE_SCOPE_DENIED','DISPOSAL_HANDLING_FACTS_INVALID','DISPOSAL_HANDLING_DATA_INVALID'].includes(error.code)) throw error }
    }
    return item
  })
  budget.actualExecutedQuantity = explanations.some(item => item.executedQuantity == null) ? null : explanations.reduce((sum, item) => sum + Math.round(item.executedQuantity * 100), 0) / 100
  budget.progress = !links.length ? '待关联' : explanations.some(item => item.executedQuantity == null || item.pendingReason?.code === 'RETURN_PENDING') ? '待核对'
    : Math.round(budget.actualExecutedQuantity * 100) === Math.round(budget.intentionQuantity * 100) ? '完成'
      : explanations.some((item, index) => links[index].state === 'ACTIVE' && item.returnClosed) ? '目标终止待解除'
        : budget.actualExecutedQuantity > 0 ? '部分执行' : links.some(link => link.state === 'ACTIVE') ? '已关联待执行' : '待关联'
  return { ...sourceResponse(row), originKind: ordinary ? 'ordinary' : 'legacy', productCode: row.product_code, productName: row.product_name, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name, createdAt: row.created_at, budget, links: explanations }
}
async function createdReceipt(conn, operation, scope, currentRead = true) {
  if (operation.resource_type !== 'disposal_handling_source' || !Number.isSafeInteger(Number(operation.source_id)) || Number(operation.source_id) <= 0 || Number(operation.resource_id) !== Number(operation.source_id)) throw invalidReceipt()
  const [[source]] = await conn.query('SELECT * FROM disposal_handling_sources WHERE id=?' + (currentRead ? ' FOR SHARE' : ''), [operation.source_id])
  if (!source) throw invalidReceipt()
  assertInScope(scope, source.warehouse_id, '处理来源')
  if (source.intent_uuid !== operation.intent_uuid || source.created_operation_uuid !== operation.operation_uuid || Number(source.created_by) !== Number(operation.actor_id)
    || source.request_key !== operation.request_key || source.payload_hash !== operation.payload_hash || source.payload_json !== operation.payload_json) throw invalidReceipt()
  let response, payload
  try {
    payload = rules.validateCreateBody(JSON.parse(operation.payload_json))
    if (rules.stableJson(payload) !== operation.payload_json || rules.fingerprint(operation.payload_json) !== operation.payload_hash
      || rules.uuid(payload.intentUuid) !== operation.intent_uuid || rules.uuid(payload.operationUuid) !== operation.operation_uuid) throw invalidReceipt()
    response = JSON.parse(operation.response_json)
  } catch { throw invalidReceipt() }
  const original = { ...sourceResponse(source), revision: 1 }
  if (Number(source.product_id) !== payload.productId || Number(source.warehouse_id) !== payload.warehouseId || source.unit !== payload.unit
    || Number(source.handling_type) !== payload.handlingType || Number(source.quantity) !== payload.quantity
    || rules.stableJson(response) !== rules.stableJson(original) || source.response_json !== operation.response_json) throw invalidReceipt()
  return response
}
async function createSource(input, { requestKey, operator, scopeWarehouseIds = null } = {}) {
  const body = rules.validateCreateBody(input), userId = rules.safeId(operator?.userId, '操作者ID'), key = rules.requestKey(requestKey)
  assertInScope(scopeWarehouseIds, body.warehouseId, '处理来源')
  const payloadJson = rules.stableJson(body)
  const identity = { operationUuid: rules.uuid(body.operationUuid), intentUuid: rules.uuid(body.intentUuid), action: rules.SOURCE_CREATE, userId, requestKey: key, payloadJson, payloadHash: rules.fingerprint(payloadJson) }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 当前主档/范围/基本单位在任何重放前核实；Q不读库存、不作预占承诺。
    const [[warehouse]] = await conn.query('SELECT id,code,name,is_active,deleted_at FROM inventory_warehouses WHERE id=? FOR SHARE', [body.warehouseId])
    const [[product]] = await conn.query('SELECT id,code,name,unit,allow_decimal_qty,is_active,deleted_at FROM product_items WHERE id=? FOR SHARE', [body.productId])
    if (!warehouse || Number(warehouse.id) !== body.warehouseId || warehouse.deleted_at || Number(warehouse.is_active) !== 1) throw new AppError('仓库不存在或已停用', 400, 'DISPOSAL_HANDLING_MASTER_INVALID')
    if (!product || Number(product.id) !== body.productId || product.deleted_at || Number(product.is_active) !== 1) throw new AppError('商品不存在或已停用', 400, 'DISPOSAL_HANDLING_MASTER_INVALID')
    for (const [value, limit] of [[warehouse.code, 30], [warehouse.name, 100], [product.code, 50], [product.name, 150], [product.unit, 20]]) {
      if (typeof value !== 'string' || !value.trim() || Array.from(value).length > limit) throw new AppError('商品或仓库身份/基本单位不完整，请核对主档', 409, 'DISPOSAL_HANDLING_MASTER_INVALID')
    }
    if (product.unit !== body.unit) throw new AppError('商品基本单位已变化，请核对后重新确认意图', 409, 'DISPOSAL_HANDLING_UNIT_CHANGED')
    assertQtyPrecisionWith({ name: product.name, allowDecimal: product.allow_decimal_qty == null || Number(product.allow_decimal_qty) === 1 }, body.quantity, '意图基本量')
    const replay = await operations.begin(conn, identity)
    if (replay) { const result = await createdReceipt(conn, replay, scopeWarehouseIds); await conn.rollback(); return result }
    let result
    try {
      const [inserted] = await conn.query(`INSERT INTO disposal_handling_sources
        (intent_uuid,created_operation_uuid,product_id,product_code,product_name,warehouse_id,warehouse_code,warehouse_name,unit,handling_type,quantity,created_by,created_by_name,request_key,payload_hash,payload_json,revision)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [identity.intentUuid, identity.operationUuid, body.productId, product.code, product.name, body.warehouseId, warehouse.code, warehouse.name, body.unit, body.handlingType, body.quantity, userId, operator.realName, key, identity.payloadHash, payloadJson, 1])
      result = { id: rules.safeId(inserted.insertId), intentUuid: identity.intentUuid, productId: body.productId, warehouseId: body.warehouseId, unit: body.unit, handlingType: body.handlingType, quantity: body.quantity, revision: 1 }
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new AppError('该意图UUID已保存，不可另开来源预算，请核对原操作', 409, 'DISPOSAL_HANDLING_SOURCE_CONFLICT')
      throw error
    }
    const [saved] = await conn.query('UPDATE disposal_handling_sources SET response_json=? WHERE id=? AND created_operation_uuid=?', [rules.stableJson(result), result.id, identity.operationUuid])
    if (saved.affectedRows !== 1) throw invalidReceipt()
    await operations.complete(conn, identity, result.id, result)
    await conn.commit()
    return result
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
async function readSnapshot(work) {
  const conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION READ ONLY')
    const result = await work(conn)
    await conn.commit(); return result
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
function pagination(input) {
  const page = input.page == null ? 1 : rules.safeId(input.page, '页码')
  const pageSize = input.pageSize == null ? 20 : rules.safeId(input.pageSize, '每页数量')
  if (page > 100000 || pageSize > 100) throw new AppError('分页范围不正确', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  return { page, pageSize, offset: (page - 1) * pageSize }
}
async function linksFor(conn, ids) {
  if (!ids.length) return []
  const [links] = await conn.query('SELECT * FROM disposal_handling_links WHERE source_id IN (?) ORDER BY source_id,id', [ids])
  return links
}
async function listSources(input = {}) {
  const { page, pageSize, offset } = pagination(input), { scopeWarehouseIds = null } = input
  const where = [], params = []
  for (const [name, column] of [['productId', 's.product_id'], ['warehouseId', 's.warehouse_id'], ['handlingType', 's.handling_type']]) {
    if (input[name] != null) {
      const value = rules.safeId(input[name], name)
      if (name === 'warehouseId') assertInScope(scopeWarehouseIds, value, '处理来源')
      if (name === 'handlingType' && ![1, 2, 3].includes(value)) throw new AppError('处理方式不正确', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
      assertSqlColumnList(column, '处理来源筛选列')
      where.push(`${column}=?`); params.push(value)
    }
  }
  if (Array.isArray(scopeWarehouseIds) && !scopeWarehouseIds.length) return { list: [], pagination: { page, pageSize, total: 0 } }
  const scope = scopeFilter(scopeWarehouseIds, 's.warehouse_id')
  const condition = (where.length ? where.join(' AND ') : '1=1') + scope.sql, values = [...params, ...scope.params]
  return readSnapshot(async conn => {
    const [[count]] = await conn.query(`SELECT COUNT(*) AS total FROM disposal_handling_sources s WHERE ${condition}`, values)
    const [rows] = await conn.query(`SELECT s.* FROM disposal_handling_sources s WHERE ${condition} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...values, pageSize, offset])
    const links = await linksFor(conn, rows.map(row => Number(row.id)))
    for (const row of rows) { sourceResponse(row); rules.calculateBudget(row, links.filter(link => Number(link.source_id) === Number(row.id))) }
    const progress = await facts.read(conn, rows, links)
    return { list: rows.map(row => sourceView(row, links.filter(link => Number(link.source_id) === Number(row.id)), progress, scopeWarehouseIds, input.targetViews)), pagination: { page, pageSize, total: Number(count.total) } }
  })
}
async function getSource(rawId, scopeWarehouseIds = null, targetViews = {}) {
  const id = rules.safeId(rawId, '来源ID')
  return readSnapshot(async conn => {
    const [[row]] = await conn.query('SELECT * FROM disposal_handling_sources s WHERE s.id=?', [id])
    if (!row) throw new AppError('处理来源不存在', 404)
    assertInScope(scopeWarehouseIds, row.warehouse_id, '处理来源')
    sourceResponse(row)
    const links = await linksFor(conn, [id])
    rules.calculateBudget(row, links)
    return sourceView(row, links, await facts.read(conn, [row], links), scopeWarehouseIds, targetViews)
  })
}
async function getOwnOperation(input) {
  const conversion = typeof input.action === 'string' && input.action.startsWith('disposal.handling.legacy.convert.') ? require('./disposal.conversion') : null
  const conversionId = conversion?.actionId(input.action)
  if (conversion && (!conversionId || input.intentUuid != null)) throw invalidReceipt()
  const operationUuid = rules.uuid(input.operationUuid), intentUuid = conversionId ? null : rules.uuid(input.intentUuid), userId = rules.safeId(input.userId, '本人ID'), key = rules.requestKey(input.requestKey)
  const releaseId = release.actionLink(input.action)
  if (!conversionId && !releaseId && ![rules.SOURCE_CREATE, 'disposal.handling.sale.create', 'disposal.handling.purchase_return.create', 'disposal.handling.scrap.create'].includes(input.action)) throw invalidReceipt()
  const targets = conversionId || releaseId || input.action === rules.SOURCE_CREATE ? null : require('./disposal.handling.targets')
  return readSnapshot(async conn => {
    const [[row]] = await conn.query('SELECT * FROM disposal_handling_operations WHERE operation_uuid=? AND actor_id=?', [operationUuid, userId])
    if (!row) return { status: 'not_found', data: null }
    if (row.action !== input.action || row.request_key !== key || row.intent_uuid !== intentUuid) throw invalidReceipt()
    if (Number(row.status) === 0) return { status: 'pending', data: null }
    if (Number(row.status) !== 1) throw invalidReceipt()
    const data = conversionId ? await conversion.readReceipt(conn, row, input.scopeWarehouseIds ?? null) : releaseId ? await release.readReceipt(conn, row, input.scopeWarehouseIds ?? null) : targets ? await targets.readReceipt(conn, row, input.scopeWarehouseIds ?? null) : await createdReceipt(conn, row, input.scopeWarehouseIds ?? null, false)
    return { status: 'success', data, resourceType: conversionId ? 'inventory_disposal_conversion' : releaseId ? 'disposal_handling_link' : targets ? row.target_type : 'disposal_handling_source', resourceId: releaseId ? data.linkId : data.id }
  })
}
module.exports = { createSource, listSources, getSource, getOwnOperation, releaseLink: release.releaseLink, getConversionSnapshot: (...args) => require('./disposal.conversion').preview(...args), signConversion: (...args) => require('./disposal.conversion').sign(...args) }
