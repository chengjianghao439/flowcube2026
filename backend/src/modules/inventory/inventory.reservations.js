const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { getStockProjection } = require('../../engine/containerEngine')
const { getExpectedStock } = require('../../utils/expectedStock')
const { PERMISSIONS: P } = require('../../constants/permissions')
const { createReservationSnapshots, LIMITS, restart, tooLarge } = require('./reservation.snapshots')
const snapshots = createReservationSnapshots()

const qty = value => Math.round(Number(value || 0) * 100) / 100
function integer(value, name, max = Number.MAX_SAFE_INTEGER, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  if (!(typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
    throw new AppError(`${name} 必须为单个合法正整数`, 400, 'INVENTORY_RESERVATION_PARAMS_INVALID')
  }
  return Number(value)
}
function saleVisibility(scope, permitted) {
  if (!permitted) return { sql: '1=0', params: [] }
  if (!Array.isArray(scope)) return { sql: 'so.deleted_at IS NULL', params: [] }
  return { sql: `so.deleted_at IS NULL AND so.warehouse_id IN (?)
    AND NOT EXISTS (SELECT 1 FROM sale_order_items si_scope WHERE si_scope.order_id=so.id
      AND (COALESCE(si_scope.warehouse_id,so.warehouse_id) IS NULL OR COALESCE(si_scope.warehouse_id,so.warehouse_id) NOT IN (?)))`, params: [scope, scope] }
}
function purchaseVisibility(scope, permitted) {
  if (!permitted) return { sql: '1=0', params: [] }
  return Array.isArray(scope) ? { sql: 'po.deleted_at IS NULL AND po.warehouse_id IN (?)', params: [scope] } : { sql: 'po.deleted_at IS NULL', params: [] }
}

/** 只读解释一个商品×仓库；所有数量和来源读取属于同一RR快照。 */
async function listReservations(input, user) {
  const productId = integer(input.productId, 'productId')
  const warehouseId = integer(input.warehouseId, 'warehouseId')
  const continuous = input.readMode === 'snapshot'
  if (input.readMode !== undefined && !continuous) throw new AppError('读取模式无效', 400, 'INVENTORY_RESERVATION_PARAMS_INVALID')
  if (continuous && (input.page !== undefined || input.pageSize !== undefined)) throw new AppError('快照读取不接受页码', 400, 'INVENTORY_RESERVATION_PARAMS_INVALID')
  const keyword = continuous ? input.keyword ?? '' : ''
  if (typeof keyword !== 'string' || keyword.length > 100) throw new AppError('原单筛选无效', 400, 'INVENTORY_RESERVATION_PARAMS_INVALID')
  const offset = input.offset === undefined ? 0 : Number(input.offset)
  if (continuous && (!(typeof input.offset === 'number' || input.offset === undefined || typeof input.offset === 'string' && /^(0|[1-9]\d*)$/.test(input.offset))
    || !Number.isSafeInteger(offset) || offset < 0 || offset > LIMITS.maxSources + LIMITS.maxBindings
    || (!input.snapshotId && offset !== 0))) throw new AppError('读取游标无效', 400, 'INVENTORY_RESERVATION_PARAMS_INVALID')
  if (continuous && input.snapshotId !== undefined && (typeof input.snapshotId !== 'string'
    || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.snapshotId))) throw new AppError('快照标识无效', 400, 'INVENTORY_RESERVATION_PARAMS_INVALID')
  const page = integer(input.page, 'page', 100000, 1)
  const pageSize = integer(input.pageSize, 'pageSize', 100, 20)
  if (!user || !Number.isSafeInteger(user.userId) || user.userId <= 0 || !Number.isSafeInteger(user.roleId) || user.roleId <= 0) throw new AppError('请重新登录', 401)
  const scope = user.warehouseIds ?? null
  assertInScope(scope, warehouseId, '库存预占')
  const finish = continuous && !input.snapshotId ? snapshots.begin(user.userId) : null
  let conn
  try {
    const rawConn = await pool.getConnection()
    conn = continuous ? {
      query: async (sql, params = []) => {
        const select = /^\s*SELECT\b/i.test(sql), limited = select && !/\bLIMIT\b/i.test(sql)
        const text = sql.replace(/^(\s*)SELECT\b/i, '$1SELECT /*+ MAX_EXECUTION_TIME(8000) */') + (limited ? ' LIMIT ?' : '')
        const result = await rawConn.query(text, limited ? [...params, LIMITS.maxQueryRows + 1] : params)
        if (select && result[0].length > LIMITS.maxQueryRows) throw new AppError('库存来源超过安全读取范围，请核对数据规模', 413, 'INVENTORY_RESERVATION_READ_TOO_LARGE')
        return result
      },
      commit: () => rawConn.commit(), rollback: () => rawConn.rollback(), release: () => rawConn.release(),
    } : rawConn
    const readAt = Date.now()
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const [permissions] = await conn.query('SELECT permission FROM sys_role_permissions WHERE role_id=? AND permission IN (?)', [user.roleId, [P.INVENTORY_VIEW, P.SALE_ORDER_VIEW, P.PURCHASE_ORDER_VIEW]])
    const held = new Set(permissions.map(row => row.permission))
    const can = permission => user.roleId === 1 || held.has(permission)
    if (!can(P.INVENTORY_VIEW)) throw new AppError('没有查看库存的权限', 403)
    const visible = saleVisibility(scope, can(P.SALE_ORDER_VIEW))
    const purchaseVisible = purchaseVisibility(scope, can(P.PURCHASE_ORDER_VIEW))
    const binding = JSON.stringify([user.userId, user.familyId ?? null, user.tokenVersion ?? null, user.roleId,
      Array.isArray(scope) ? [...new Set(scope)].sort((a, b) => a - b) : null,
      [P.INVENTORY_VIEW, P.SALE_ORDER_VIEW, P.PURCHASE_ORDER_VIEW].map(can),
      productId, warehouseId, keyword.trim()])
    if (continuous && input.snapshotId) {
      const result = snapshots.read(input.snapshotId, binding, offset)
      try { await assertSnapshotVisibility(conn, result.rows, visible, purchaseVisible) }
      catch (error) { snapshots.remove(input.snapshotId); throw error }
      await conn.commit()
      return result
    }
    const projection = await getStockProjection(conn, { productId, warehouseId, lock: false })
    const expectedStock = await getExpectedStock(conn, [{ productId, warehouseId }], { lock: false })
    const [[stock]] = await conn.query(`SELECT COALESCE((SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?),0) AS cache_on_hand,
      (SELECT COALESCE(SUM(remaining_qty),0) FROM inventory_containers WHERE product_id=? AND warehouse_id=?
       AND status=1 AND deleted_at IS NULL AND remaining_qty>0 AND locked_by_task_id IS NULL) AS pickable`, [productId, warehouseId, productId, warehouseId])
    const [[reservations]] = await conn.query(`SELECT /* reservation_summary */ COALESCE(SUM(sr.qty),0) total_qty,
      COALESCE(SUM(CASE WHEN sr.ref_type='sale_order' AND so.id IS NOT NULL AND ${visible.sql} THEN sr.qty ELSE 0 END),0) visible_qty,
      COALESCE(SUM(CASE WHEN sr.ref_type='sale_order' AND (so.id IS NULL OR so.deleted_at IS NOT NULL) THEN sr.qty ELSE 0 END),0) orphan_qty,
      COALESCE(SUM(CASE WHEN sr.ref_type<>'sale_order' THEN sr.qty ELSE 0 END),0) unknown_qty
      FROM stock_reservations sr LEFT JOIN sale_orders so ON sr.ref_type='sale_order' AND so.id=sr.ref_id
      WHERE sr.product_id=? AND sr.warehouse_id=? AND sr.status=1`, [...visible.params, productId, warehouseId])
    const [[bindingSummary]] = await conn.query(`SELECT /* binding_summary */ COALESCE(SUM(b.qty),0) total_qty,
      COALESCE(SUM(CASE WHEN so.id IS NOT NULL AND ${visible.sql} THEN b.qty ELSE 0 END),0) visible_qty,
      COALESCE(SUM(CASE WHEN so.id IS NULL OR so.deleted_at IS NOT NULL THEN b.qty ELSE 0 END),0) orphan_qty
      FROM sale_order_expected_bindings b LEFT JOIN sale_orders so ON so.id=b.sale_order_id
      WHERE b.product_id=? AND b.warehouse_id=? AND b.released_at IS NULL`, [...visible.params, productId, warehouseId])
    const sourceSql = `FROM (
      SELECT ref_id sale_order_id,SUM(qty) reservation_qty,0 binding_qty FROM stock_reservations
        WHERE product_id=? AND warehouse_id=? AND status=1 AND ref_type='sale_order' GROUP BY ref_id
      UNION ALL
      SELECT sale_order_id,0,SUM(qty) FROM sale_order_expected_bindings
        WHERE product_id=? AND warehouse_id=? AND released_at IS NULL GROUP BY sale_order_id
      ) sources JOIN sale_orders so ON so.id=sources.sale_order_id WHERE ${visible.sql}${keyword.trim() ? ' AND (so.order_no LIKE ? OR so.customer_name LIKE ?)' : ''}`
    const sourceParams = [productId, warehouseId, productId, warehouseId, ...visible.params,
      ...(keyword.trim() ? ['%' + keyword.trim() + '%', '%' + keyword.trim() + '%'] : [])]
    const [[count]] = await conn.query(`SELECT /* visible_source_count */ COUNT(DISTINCT so.id) total ${sourceSql}`, sourceParams)
    if (continuous && Number(count.total) > LIMITS.maxSources) throw tooLarge()
    const [rows] = await conn.query(`SELECT /* visible_source_page */ so.id,so.order_no,so.customer_name,so.status,so.created_at,
      SUM(sources.reservation_qty) reservation_qty,SUM(sources.binding_qty) binding_qty ${sourceSql}
      GROUP BY so.id ORDER BY so.id ASC LIMIT ? OFFSET ?`, [...sourceParams, continuous ? LIMITS.maxSources + 1 : pageSize, continuous ? 0 : (page - 1) * pageSize])
    const list = rows.map(row => ({ saleOrderId: Number(row.id), orderNo: row.order_no, customerName: row.customer_name, status: Number(row.status), createdAt: row.created_at,
      reservationQuantity: qty(row.reservation_qty), expectedBindingQuantity: qty(row.binding_qty), hiddenBindingQuantity: 0, orphanBindingQuantity: 0, bindings: [] }))
    if (list.length) await loadBindings(conn, list, { productId, warehouseId, purchaseVisible, maxBindings: continuous ? LIMITS.maxBindings : null })
    const activeQuantity = qty(projection.quantity), cacheOnHand = qty(stock.cache_on_hand), reserved = qty(projection.reserved)
    const expected = qty(expectedStock.byPair.get(`${productId}:${warehouseId}`))
    const reservationQuantity = qty(reservations.total_qty), expectedBindingQuantity = qty(bindingSummary.total_qty)
    const expectedPoolBindingQuantity = qty(expectedStock.boundByPair.get(`${productId}:${warehouseId}`))
    const summary = { activeQuantity, cacheOnHand, reserved, available: Math.max(0, qty(cacheOnHand - reserved)), expected,
      atp: Math.max(0, qty(activeQuantity + expected - reserved)), pickableQuantity: qty(stock.pickable), reservationQuantity, expectedBindingQuantity, expectedPoolBindingQuantity,
      cacheDifference: qty(cacheOnHand - activeQuantity), reservationDifference: qty(reserved - reservationQuantity), bindingPoolDifference: qty(expectedBindingQuantity - expectedPoolBindingQuantity),
      visibleReservationQuantity: qty(reservations.visible_qty), hiddenReservationQuantity: qty(reservationQuantity - qty(reservations.visible_qty) - qty(reservations.orphan_qty) - qty(reservations.unknown_qty)),
      orphanReservationQuantity: qty(reservations.orphan_qty), unknownReservationQuantity: qty(reservations.unknown_qty),
      visibleBindingQuantity: qty(bindingSummary.visible_qty), hiddenBindingQuantity: qty(expectedBindingQuantity - qty(bindingSummary.visible_qty) - qty(bindingSummary.orphan_qty)), orphanBindingQuantity: qty(bindingSummary.orphan_qty) }
    await conn.commit()
    const result = { productId, warehouseId, summary, list, pagination: { page, pageSize, total: Number(count.total) } }
    return continuous ? snapshots.save(binding, result, user.userId, readAt) : result
  } catch (error) {
    if (conn) await conn.rollback()
    throw error
  } finally { if (conn) conn.release(); if (finish) finish() }
}

async function assertSnapshotVisibility(conn, rows, visible, purchaseVisible) {
  const ids = [...new Set(rows.map(row => row.saleOrderId))]
  if (ids.length) {
    const [sales] = await conn.query(`SELECT /* snapshot_sale_scope */ so.id FROM sale_orders so WHERE so.id IN (?) AND ${visible.sql}`, [ids, ...visible.params])
    if (sales.length !== ids.length) throw restart()
  }
  const purchases = [...new Set(rows.filter(row => row.kind === 'binding').map(row => row.binding.purchase.purchaseOrderId))]
  if (purchases.length) {
    const [orders] = await conn.query(`SELECT /* snapshot_purchase_scope */ po.id FROM purchase_orders po WHERE po.id IN (?) AND ${purchaseVisible.sql}`, [purchases, ...purchaseVisible.params])
    if (orders.length !== purchases.length) throw restart()
  }
}

async function loadBindings(conn, list, { productId, warehouseId, purchaseVisible, maxBindings }) {
  const ids = list.map(row => row.saleOrderId)
  const [rows] = await conn.query(`SELECT /* binding_details */ b.id,b.sale_order_id,b.sale_order_item_id,b.qty,b.purchase_order_id,b.purchase_item_id,
    po.order_no,po.status purchase_status,po.expected_date,pi.quantity ordered_qty,
    CASE WHEN si.id IS NOT NULL AND si.order_id=b.sale_order_id AND si.product_id=b.product_id
      AND COALESCE(si.warehouse_id,so.warehouse_id)=b.warehouse_id THEN 1 ELSE 0 END sale_item_valid,
    CASE WHEN pi.id IS NOT NULL AND po.id IS NOT NULL AND po.deleted_at IS NULL AND pi.order_id=po.id
      AND pi.product_id=b.product_id AND po.warehouse_id=b.warehouse_id THEN 1 ELSE 0 END purchase_valid,
    CASE WHEN po.id IS NOT NULL AND ${purchaseVisible.sql} THEN 1 ELSE 0 END purchase_visible
    FROM sale_order_expected_bindings b JOIN sale_orders so ON so.id=b.sale_order_id
    LEFT JOIN sale_order_items si ON si.id=b.sale_order_item_id
    LEFT JOIN purchase_order_items pi ON pi.id=b.purchase_item_id
    LEFT JOIN purchase_orders po ON po.id=b.purchase_order_id
    WHERE b.sale_order_id IN (?) AND b.product_id=? AND b.warehouse_id=? AND b.released_at IS NULL ORDER BY b.id${maxBindings ? ' LIMIT ?' : ''}`, [...purchaseVisible.params, ids, productId, warehouseId, ...(maxBindings ? [maxBindings + 1] : [])])
  if (maxBindings && rows.length > maxBindings) throw tooLarge()
  const exposed = rows.filter(row => Number(row.sale_item_valid) === 1 && Number(row.purchase_valid) === 1 && Number(row.purchase_visible) === 1)
  const itemIds = [...new Set(exposed.map(row => Number(row.purchase_item_id)))]
  const putaway = new Map(), bound = new Map()
  if (itemIds.length) {
    const [totals] = await conn.query(`SELECT /* binding_supply_totals */ iti.purchase_item_id,SUM(iti.putaway_qty) qty,'putaway' kind
      FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id
      WHERE iti.purchase_item_id IN (?) AND it.deleted_at IS NULL AND it.status<>5 GROUP BY iti.purchase_item_id
      UNION ALL SELECT purchase_item_id,SUM(qty),'binding' FROM sale_order_expected_bindings
      WHERE purchase_item_id IN (?) AND released_at IS NULL GROUP BY purchase_item_id`, [itemIds, itemIds])
    for (const row of totals) (row.kind === 'putaway' ? putaway : bound).set(Number(row.purchase_item_id), qty(row.qty))
  }
  const sources = new Map(list.map(row => [row.saleOrderId, row]))
  for (const row of rows) {
    const source = sources.get(Number(row.sale_order_id))
    if (!source) continue
    if (Number(row.sale_item_valid) !== 1 || Number(row.purchase_valid) !== 1) { source.orphanBindingQuantity = qty(source.orphanBindingQuantity + qty(row.qty)); continue }
    if (Number(row.purchase_visible) !== 1) { source.hiddenBindingQuantity = qty(source.hiddenBindingQuantity + qty(row.qty)); continue }
    const received = putaway.get(Number(row.purchase_item_id)) || 0
    const open = Math.max(0, qty(Number(row.ordered_qty) - received))
    const eligible = [2, 5].includes(Number(row.purchase_status)) && open > 0
    source.bindings.push({ bindingId: Number(row.id), saleOrderItemId: Number(row.sale_order_item_id), quantity: qty(row.qty),
      sourceState: received > Number(row.ordered_qty) ? 'putaway_exceeds_order' : eligible ? 'expected_supply' : 'outside_expected_supply',
      purchase: { purchaseOrderId: Number(row.purchase_order_id), purchaseItemId: Number(row.purchase_item_id), orderNo: row.order_no, status: Number(row.purchase_status), expectedDate: row.expected_date || null,
        openQuantity: open, boundQuantity: bound.get(Number(row.purchase_item_id)) || 0 } })
  }
}
module.exports = { listReservations }
