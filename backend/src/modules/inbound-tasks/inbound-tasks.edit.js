const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertQtyPrecision } = require('../../utils/qtyPrecision')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { appendInboundEvent } = require('./inbound-tasks.helpers')
const query = require('./inbound-tasks.query')
const { replayInboundEdit } = require('./inbound-tasks.edit-receipt')
const { editFingerprint, requestFingerprint, isDraftEditable, normalizeEditItems, normalizeFreight } = require('./inbound-tasks.edit-rules')

const invalidSource = () => new AppError('原收货明细的采购来源缺失、失效或归属不一致，请保留原单并核对', 409, 'INBOUND_PURCHASE_SOURCE_INVALID')
const validId = id => Number.isSafeInteger(Number(id)) && Number(id) > 0
function originalSupplier(head, lines, sources) {
  if (!validId(head.warehouse_id) || !lines.length) throw invalidSource()
  const itemMap = new Map(sources.items.map(i => [Number(i.id), i]))
  const orderMap = new Map(sources.orders.map(o => [Number(o.id), o]))
  const suppliers = new Set(), ids = new Set()
  for (const line of lines) {
    const item = itemMap.get(Number(line.purchase_item_id)), order = orderMap.get(Number(line.purchase_order_id))
    if (!validId(line.purchase_item_id) || !validId(line.purchase_order_id) || !item || !order
      || Number(item.order_id) !== Number(line.purchase_order_id) || Number(item.product_id) !== Number(line.product_id)
      || Number(order.warehouse_id) !== Number(head.warehouse_id) || !validId(order.supplier_id)
      || ids.has(Number(line.purchase_item_id))) throw invalidSource()
    ids.add(Number(line.purchase_item_id)); suppliers.add(Number(order.supplier_id))
  }
  if (suppliers.size !== 1) throw invalidSource()
  return [...suppliers][0]
}

function sourceFactsForLines(lines, sources) {
  const itemIds = new Set(lines.map(i => Number(i.purchase_item_id)))
  const orderIds = new Set(lines.map(i => Number(i.purchase_order_id)))
  return { items: sources.items.filter(i => itemIds.has(Number(i.id))), orders: sources.orders.filter(o => orderIds.has(Number(o.id))) }
}

async function updateDraft(taskId, body, { userId = null, requestKey = null, scopeWarehouseIds = null, operator = null } = {}) {
  if (!validId(taskId)) throw new AppError('收货订单无效', 400)
  if (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.trim().length > 100) throw new AppError('保存草稿必须携带有效的原请求键', 400, 'REQUEST_KEY_REQUIRED')
  if (!validId(userId)) throw new AppError('登录身份无效', 401)
  const fingerprint = requestFingerprint(body)
  const conn = await pool.getConnection()
  let request = null, commitStarted = false
  try {
    // 只影响 NEXT TRANSACTION，不能污染连接池下一位借用者的默认隔离级别。
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await conn.beginTransaction()
    const [[head]] = await conn.query('SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [taskId])
    if (!head) throw new AppError('收货订单不存在', 404)
    assertInScope(scopeWarehouseIds, head.warehouse_id, '收货订单')
    request = await beginResourceOperationRequest(conn, { requestKey: requestKey.trim(), action: 'inbound.update', userId, resourceType: 'inbound_task', resourceId: taskId })
    if (request.replay) {
      if (request.responseData?.requestFingerprint !== fingerprint) throw new AppError('原请求键对应的草稿内容不同，请保留原请求并核对', 409, 'INBOUND_EDIT_REQUEST_CONFLICT')
      const data = await replayInboundEdit(conn, request, Number(taskId), scopeWarehouseIds)
      commitStarted = true
      await conn.commit()
      return data
    }
    const [oldItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id FOR UPDATE', [taskId])
    const [containers] = await conn.query('SELECT id FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL ORDER BY id FOR UPDATE', [taskId])
    if (!isDraftEditable(head, oldItems, containers.length)) throw new AppError('只有未提交、未收货、未上架且未生成库存条码的完整草稿可以编辑，请保留输入并核对原单', 409, 'INBOUND_TASK_NOT_EDITABLE')
    if (typeof body?.expectedEditFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedEditFingerprint)) throw new AppError('原草稿已变化，请保留当前输入并重新打开核对', 409, 'INBOUND_EDIT_CONFLICT')
    const normalized = normalizeEditItems(body.items)
    if (body.remark !== undefined && (typeof body.remark !== 'string' || body.remark.length > 200)) throw new AppError('备注最多 200 个字符', 400)
    const freight = normalizeFreight(body, head)
    const allIds = [...new Set([...oldItems.map(i => Number(i.purchase_item_id)), ...normalized.map(i => i.purchaseItemId)])].sort((a, b) => a - b)
    const sources = await query.lockPurchasableSources(conn, allIds)
    // 原来源身份/数量/价/单位与IT持久头行共同构成基线，等源锁后必须重核。
    if (body.expectedEditFingerprint !== editFingerprint(head, oldItems, sourceFactsForLines(oldItems, sources))) throw new AppError('原草稿或采购来源已变化，请保留当前输入并重新打开核对', 409, 'INBOUND_EDIT_CONFLICT')
    const supplierId = originalSupplier(head, oldItems, sources)
    for (const order of sources.orders) {
      assertInScope(scopeWarehouseIds, order.warehouse_id, '原采购单')
      if (order.deleted_at != null || Number(order.status) !== 2 || Number(order.supplier_id) !== supplierId || Number(order.warehouse_id) !== Number(head.warehouse_id)) throw invalidSource()
    }
    const candidates = await query.loadPurchasableCandidates(conn, { supplierId, warehouseId: Number(head.warehouse_id), purchaseItemIds: allIds, excludeTaskId: Number(taskId), scopeWarehouseIds })
    if (candidates.length !== allIds.length) throw invalidSource()
    const candidateMap = new Map(candidates.map(i => [i.purchaseItemId, i]))
    const taskItems = normalized.map(item => {
      const candidate = candidateMap.get(item.purchaseItemId)
      if (!candidate || candidate.supplierId !== supplierId || candidate.warehouseId !== Number(head.warehouse_id)) throw invalidSource()
      if (Math.round(item.qty * 100) > Math.round(candidate.remainingQty * 100)) throw new AppError(`${candidate.productName} 超出可建单数量，最多还能建 ${candidate.remainingQty}`, 400, 'INBOUND_EDIT_QTY_EXCEEDED')
      return { ...candidate, qty: item.qty }
    })
    await assertQtyPrecision(conn, taskItems.map(i => ({ productId: i.productId, qty: i.qty, label: '应收数量' })))
    const oldMap = new Map(oldItems.map(i => [Number(i.purchase_item_id), i]))
    const retained = taskItems.filter(i => oldMap.has(i.purchaseItemId))
    const added = taskItems.filter(i => !oldMap.has(i.purchaseItemId))
    const selected = new Set(taskItems.map(i => i.purchaseItemId))
    const removedIds = oldItems.filter(i => !selected.has(Number(i.purchase_item_id))).map(i => Number(i.id))
    if (removedIds.length) await conn.query('DELETE FROM inbound_task_items WHERE task_id = ? AND id IN (?)', [taskId, removedIds])
    if (retained.length) {
      const clauses = retained.map(() => 'WHEN ? THEN ?').join(' ')
      const params = retained.flatMap(i => [Number(oldMap.get(i.purchaseItemId).id), i.qty])
      await conn.query(`UPDATE inbound_task_items SET ordered_qty = CASE id ${clauses} END WHERE task_id = ? AND id IN (?)`, [...params, taskId, retained.map(i => Number(oldMap.get(i.purchaseItemId).id))])
    }
    if (added.length) await conn.query(
      `INSERT INTO inbound_task_items (task_id,purchase_order_id,purchase_order_no,purchase_item_id,product_id,product_code,product_name,article_number,spec,color,unit,ordered_qty) VALUES ?`,
      [added.map(i => [taskId, i.purchaseOrderId, i.purchaseOrderNo, i.purchaseItemId, i.productId, i.productCode, i.productName, i.articleNumber || null, i.spec || null, i.color || null, i.unit, i.qty])],
    )
    const purchaseOrderIds = [...new Set(taskItems.map(i => i.purchaseOrderId))]
    const [updated] = await conn.query(
      `UPDATE inbound_tasks SET purchase_order_id = ?, purchase_order_no = ?, remark = ?, freight_type = ?, freight_amount = ?, lock_version = lock_version + 1
       WHERE id = ? AND lock_version = ? AND status = 1 AND submitted_at IS NULL`,
      [purchaseOrderIds.length === 1 ? taskItems[0].purchaseOrderId : null, purchaseOrderIds.length === 1 ? taskItems[0].purchaseOrderNo : `${purchaseOrderIds.length} 单混合`, body.remark === undefined ? head.remark : body.remark.trim() || null, freight.freightType, freight.freightAmount, taskId, Number(head.lock_version)],
    )
    if (updated.affectedRows !== 1) throw new AppError('原草稿已变化，请保留输入并核对', 409, 'INBOUND_EDIT_CONFLICT')
    const [[savedHead]] = await conn.query('SELECT * FROM inbound_tasks WHERE id = ?', [taskId])
    const [savedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id', [taskId])
    const data = { taskId: Number(taskId), taskNo: head.task_no, expectedEditFingerprint: editFingerprint(savedHead, savedItems, sourceFactsForLines(savedItems, sources)), requestFingerprint: fingerprint }
    await appendInboundEvent(conn, taskId, 'draft_updated', '编辑收货草稿', '采购明细、应收数量及运输记录已保存', operator || { userId }, { addedLines: added.length, removedLines: removedIds.length, lineCount: taskItems.length })
    await completeOperationRequest(conn, request, { data, message: '收货草稿已保存', resourceType: 'inbound_task', resourceId: taskId })
    commitStarted = true
    await conn.commit()
    return data
  } catch (error) {
    let rolledBack = false
    try { await conn.rollback(); rolledBack = true } catch { /* 回滚不确定时仍保留原错误，不声明未执行。 */ }
    if (request?.enabled && !request.replay && !commitStarted && rolledBack && error.statusCode >= 400 && error.statusCode < 500) {
      error.data = { ...(error.data || {}), inboundEditNotExecuted: true }
    }
    throw error
  } finally { conn.release() }
}

// 只读事务完整读取现有明细，不按可用候选过滤原行。失效来源仍保留原单，保存时明确拒绝。
async function readEditSnapshot(conn, taskId, scopeWarehouseIds) {
  const [[head]] = await conn.query('SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL', [taskId])
  if (!head) throw new AppError('收货订单不存在', 404)
  assertInScope(scopeWarehouseIds, head.warehouse_id, '收货订单')
  const [items] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id', [taskId])
  const [containers] = await conn.query('SELECT id FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL', [taskId])
  if (!isDraftEditable(head, items, containers.length)) throw new AppError('此收货订单已经不能编辑，请保留输入并核对', 409, 'INBOUND_TASK_NOT_EDITABLE')
  const ids = items.map(i => Number(i.purchase_item_id))
  if (ids.some(id => !validId(id))) throw invalidSource()
  const [sourceItems] = await conn.query('SELECT * FROM purchase_order_items WHERE id IN (?)', [ids])
  const orderIds = [...new Set(items.map(i => Number(i.purchase_order_id)))]
  const [orders] = await conn.query('SELECT * FROM purchase_orders WHERE id IN (?)', [orderIds])
  const supplierId = originalSupplier(head, items, { items: sourceItems, orders })
  for (const order of orders) assertInScope(scopeWarehouseIds, order.warehouse_id, '原采购单')
  return { head, items, supplierId, sourceItems, orders }
}
async function withReadSnapshot(callback) {
  const conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const data = await callback(conn)
    await conn.commit()
    return data
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}
async function getEditContext(taskId, scopeWarehouseIds = null) {
  return withReadSnapshot(async conn => {
    const snapshot = await readEditSnapshot(conn, taskId, scopeWarehouseIds)
    const candidates = await query.loadPurchasableCandidates(conn, { supplierId: snapshot.supplierId, warehouseId: Number(snapshot.head.warehouse_id), purchaseItemIds: snapshot.items.map(i => Number(i.purchase_item_id)), excludeTaskId: Number(taskId), scopeWarehouseIds })
    const candidateMap = new Map(candidates.map(i => [i.purchaseItemId, i]))
    const allCandidates = snapshot.items.map(i => candidateMap.get(Number(i.purchase_item_id)) || {
      purchaseItemId: Number(i.purchase_item_id), purchaseOrderId: Number(i.purchase_order_id), purchaseOrderNo: i.purchase_order_no,
      supplierId: snapshot.supplierId, supplierName: snapshot.head.supplier_name, warehouseId: Number(snapshot.head.warehouse_id), warehouseName: snapshot.head.warehouse_name,
      productId: Number(i.product_id), productCode: i.product_code, productName: i.product_name, articleNumber: i.article_number, spec: i.spec, color: i.color, unit: i.unit,
      orderedQty: Number(snapshot.sourceItems.find(p => Number(p.id) === Number(i.purchase_item_id))?.quantity || 0), assignedQty: null, remainingQty: 0, receivedQty: 0,
      unitPrice: Number(snapshot.sourceItems.find(p => Number(p.id) === Number(i.purchase_item_id))?.unit_price || 0), sourceAvailable: false,
    })
    const task = await query.findById(taskId, scopeWarehouseIds, conn)
    return { task, supplierId: snapshot.supplierId, expectedEditFingerprint: editFingerprint(snapshot.head, snapshot.items, { orders: snapshot.orders, items: snapshot.sourceItems }), candidates: allCandidates }
  })
}
function candidateReadArgs({ purchaseItemIds = null, page = 1, pageSize = 200 } = {}) {
  let ids = null
  if (purchaseItemIds != null) {
    if (typeof purchaseItemIds !== 'string') throw new AppError('采购明细参数无效', 400)
    const parts = purchaseItemIds.split(',')
    if (!parts.length || parts.length > 200 || parts.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new AppError('采购明细参数无效', 400)
    ids = [...new Set(parts.map(Number))]
  }
  const p = Number(page), ps = Number(pageSize)
  if (!Number.isSafeInteger(p) || p <= 0 || !Number.isSafeInteger(ps) || ps <= 0) throw new AppError('分页参数无效', 400)
  const offset = (p - 1) * Math.min(200, ps)
  if (!Number.isSafeInteger(offset)) throw new AppError('分页参数超出安全范围', 400)
  return { ids, readPage: { page: p, pageSize: Math.min(200, ps), offset } }
}
async function findEditPurchasableItems(taskId, args = {}, scopeWarehouseIds = null) {
  const parsed = candidateReadArgs(args)
  return withReadSnapshot(async conn => {
    const snapshot = await readEditSnapshot(conn, taskId, scopeWarehouseIds)
    return query.loadPurchasableCandidates(conn, { supplierId: snapshot.supplierId, warehouseId: Number(snapshot.head.warehouse_id), keyword: typeof args.keyword === 'string' ? args.keyword.slice(0, 200) : '', purchaseItemIds: parsed.ids, excludeTaskId: Number(taskId), scopeWarehouseIds, readPage: parsed.ids ? null : parsed.readPage })
  })
}
module.exports = { updateDraft, getEditContext, findEditPurchasableItems }
