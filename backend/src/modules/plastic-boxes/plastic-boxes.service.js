const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer } = require('../../engine/containerEngine')
const { normalizePagination } = require('../../utils/pagination')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')

async function findAll({ page = 1, pageSize = 20, keyword, warehouseId, productId, scopeWarehouseIds = null } = {}) {
  const conditions = ["c.deleted_at IS NULL", "c.barcode LIKE 'B%'"]
  const params = []

  if (keyword) {
    conditions.push('(c.barcode LIKE ? OR p.name LIKE ? OR p.code LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (warehouseId) {
    conditions.push('c.warehouse_id = ?')
    params.push(Number(warehouseId))
  }
  if (productId) {
    conditions.push('c.product_id = ?')
    params.push(Number(productId))
  }

  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const where = `WHERE ${conditions.join(' AND ')}${scope.sql}`
  params.push(...scope.params)
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM inventory_containers c LEFT JOIN product_items p ON p.id = c.product_id ${where}`, params)
  const [rows] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.location_id, c.remaining_qty, c.status, c.unit, c.created_at, c.updated_at,
            p.name AS product_name, p.code AS product_code, p.article_number, p.spec, p.color, w.name AS warehouse_name, l.name AS location_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations l ON l.id = c.location_id
     ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )

  return {
    list: rows.map(fmt),
    pagination: { page, pageSize: ps, total: Number(total) },
  }
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query(
    `SELECT c.*, p.name AS product_name, p.code AS product_code, p.article_number, p.spec, p.color, w.name AS warehouse_name, l.name AS location_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations l ON l.id = c.location_id
     WHERE c.id = ? AND c.barcode LIKE 'B%' AND c.deleted_at IS NULL`,
    [id],
  )
  if (!row) throw new AppError('塑料盒不存在', 404)
  assertInScope(scopeWarehouseIds, row.warehouse_id, '塑料盒')
  return fmt(row)
}

// 流水查询复用库存模块的通用实现（inventory_logs 的数量列是 quantity——本接口此前
// 误用不存在的 il.qty，一直 500，从未成功过）
async function findMovements(id, scopeWarehouseIds = null) {
  await findById(id, scopeWarehouseIds)
  return require('../inventory/inventory.service').getContainerLogs(id)
}

// warehouseName 由前端一并传来但这里不落库（容器只存 warehouse_id，名字查表取），
// 保留在签名里是为了让接口形状与其它建单接口一致。
async function create({ productId, warehouseId, locationId, remark }, scopeWarehouseIds = null) {
  if (!productId) throw new AppError('请选择产品', 400)
  if (!warehouseId) throw new AppError('请选择仓库', 400)
  assertInScope(scopeWarehouseIds, warehouseId, '塑料盒')

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[product]] = await conn.query('SELECT id, name, unit FROM product_items WHERE id=? AND deleted_at IS NULL AND is_active=1 FOR SHARE', [Number(productId)])
    if (!product) throw new AppError('商品不存在或已停用', 400)
    const [[warehouse]] = await conn.query('SELECT id FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL AND is_active=1 FOR SHARE', [Number(warehouseId)])
    if (!warehouse) throw new AppError('仓库不存在或已停用', 400)
    if (locationId != null && locationId !== '') {
      const [[location]] = await conn.query('SELECT id FROM warehouse_locations WHERE id=? AND warehouse_id=? AND deleted_at IS NULL AND status=1 FOR SHARE', [Number(locationId), Number(warehouseId)])
      if (!location) throw new AppError('库位不存在、已停用或不属于目标仓库', 400)
    }
    const { containerId, barcode } = await createContainer(conn, {
      productId: Number(productId),
      warehouseId: Number(warehouseId),
      initialQty: 0,
      unit: product.unit || '',
      sourceType: 'manual',
      sourceRefType: 'plastic_box_create',
      remark: remark || `为 ${product.name} 创建塑料盒`,
      barcodePrefix: 'B',
      containerType: 2,
      locationId: locationId ? Number(locationId) : null,
      containerStatus: 1,
    })
    await conn.commit()
    return { id: containerId, barcode }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function remove(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[box]] = await conn.query("SELECT warehouse_id,remaining_qty,locked_by_task_id FROM inventory_containers WHERE id=? AND barcode LIKE 'B%' AND deleted_at IS NULL FOR UPDATE", [id])
    if (!box) throw new AppError('塑料盒不存在', 404)
    assertInScope(scopeWarehouseIds, box.warehouse_id, '塑料盒')
    if (Number(box.remaining_qty) > 0 || box.locked_by_task_id != null) throw new AppError('塑料盒尚有库存或被任务锁定，无法删除', 400)
    await conn.query('UPDATE inventory_containers SET deleted_at=NOW() WHERE id=?', [id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }
}

function fmt(row) {
  return {
    id: Number(row.id),
    barcode: row.barcode,
    productId: row.product_id != null ? Number(row.product_id) : null,
    productName: row.product_name || null,
    productCode: row.product_code || null,
    articleNumber: row.article_number || null,
    spec: row.spec || null,
    color: row.color || null,
    warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
    warehouseName: row.warehouse_name || null,
    locationId: row.location_id != null ? Number(row.location_id) : null,
    locationName: row.location_name || null,
    remainingQty: Number(row.remaining_qty),
    status: Number(row.status),
    unit: row.unit || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

module.exports = { findAll, findById, findMovements, create, remove }
