const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer } = require('../../engine/containerEngine')
const { normalizePagination } = require('../../utils/pagination')

async function findAll({ page = 1, pageSize = 20, keyword, warehouseId, productId } = {}) {
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM inventory_containers c LEFT JOIN product_items p ON p.id = c.product_id ${where}`, params)
  const [rows] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.location_id, c.remaining_qty, c.status, c.unit, c.created_at, c.updated_at,
            p.name AS product_name, p.code AS product_code, p.article_number, p.spec, p.color, w.name AS warehouse_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )

  return {
    list: rows.map(fmt),
    pagination: { page, pageSize: ps, total: Number(total) },
  }
}

async function findById(id) {
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
  return fmt(row)
}

// 流水查询复用库存模块的通用实现（inventory_logs 的数量列是 quantity——本接口此前
// 误用不存在的 il.qty，一直 500，从未成功过）
async function findMovements(id) {
  return require('../inventory/inventory.service').getContainerLogs(id)
}

// warehouseName 由前端一并传来但这里不落库（容器只存 warehouse_id，名字查表取），
// 保留在签名里是为了让接口形状与其它建单接口一致。
async function create({ productId, productName, productCode, warehouseId, warehouseName: _warehouseName, locationId, unit, remark }) {
  if (!productId) throw new AppError('请选择产品', 400)
  if (!warehouseId) throw new AppError('请选择仓库', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const { containerId, barcode } = await createContainer(conn, {
      productId: Number(productId),
      warehouseId: Number(warehouseId),
      initialQty: 0,
      unit: unit || '',
      sourceType: 'manual',
      sourceRefType: 'plastic_box_create',
      remark: remark || `为 ${productName || productCode} 创建塑料盒`,
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

async function remove(id) {
  const box = await findById(id)
  if (Number(box.remainingQty) > 0) {
    throw new AppError('塑料盒尚有库存，无法删除', 400)
  }
  await pool.query('UPDATE inventory_containers SET deleted_at = NOW() WHERE id = ?', [id])
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
