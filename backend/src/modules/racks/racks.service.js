const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

function fmt(r) {
  return {
    id:           r.id,
    warehouseId:  r.warehouse_id,
    warehouseName: r.warehouse_name || null,
    barcode:      r.barcode ?? null,
    zone:         r.zone,
    code:         r.code,
    name:         r.name,
    maxLevels:    r.max_levels,
    maxPositions: r.max_positions,
    status:       r.status,
    remark:       r.remark || null,
    createdAt:    r.created_at,
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '', warehouseId = null, zone = null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['r.deleted_at IS NULL', '(r.code LIKE ? OR r.name LIKE ? OR r.zone LIKE ?)']
  const params = [like, like, like]

  if (warehouseId) { conds.push('r.warehouse_id = ?'); params.push(warehouseId) }
  if (zone)        { conds.push('r.zone = ?');         params.push(zone) }

  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT r.*, w.name AS warehouse_name
     FROM warehouse_racks r
     LEFT JOIN inventory_warehouses w ON w.id = r.warehouse_id
     WHERE ${where}
     ORDER BY r.warehouse_id ASC, r.zone ASC, r.code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM warehouse_racks r WHERE ${where}`,
    params,
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findActive(warehouseId) {
  const conds = ['r.deleted_at IS NULL', 'r.status = 1']
  const params = []
  if (warehouseId) { conds.push('r.warehouse_id = ?'); params.push(warehouseId) }
  const [rows] = await pool.query(
    `SELECT r.* FROM warehouse_racks r WHERE ${conds.join(' AND ')} ORDER BY r.zone ASC, r.code ASC`,
    params,
  )
  return rows.map(fmt)
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT r.*, w.name AS warehouse_name
     FROM warehouse_racks r
     LEFT JOIN inventory_warehouses w ON w.id = r.warehouse_id
     WHERE r.id = ? AND r.deleted_at IS NULL`,
    [id],
  )
  if (!row) throw new AppError('货架不存在', 404)
  return fmt(row)
}

async function create(data) {
  const { warehouseId, zone = '', code, name = '', maxLevels = 5, maxPositions = 10, remark } = data
  if (!warehouseId) throw new AppError('仓库不能为空', 400)
  if (!code)        throw new AppError('货架编码不能为空', 400)

  const [[exists]] = await pool.query(
    'SELECT id FROM warehouse_racks WHERE warehouse_id = ? AND code = ? AND deleted_at IS NULL',
    [warehouseId, code],
  )
  if (exists) throw new AppError(`货架编码 ${code} 已存在`, 400)

  const [result] = await pool.query(
    `INSERT INTO warehouse_racks (warehouse_id, zone, code, name, max_levels, max_positions, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [warehouseId, zone, code, name, maxLevels, maxPositions, remark || null],
  )
  const newId = result.insertId
  const barcode = `RCK${String(newId).padStart(6, '0')}`
  await pool.query('UPDATE warehouse_racks SET barcode = ? WHERE id = ?', [barcode, newId])
  return findById(newId)
}

async function update(id, data) {
  await findById(id)
  const { zone, code, name, maxLevels, maxPositions, status, remark } = data

  if (code) {
    const [[dup]] = await pool.query(
      'SELECT id FROM warehouse_racks WHERE code = ? AND id <> ? AND deleted_at IS NULL',
      [code, id],
    )
    if (dup) throw new AppError(`货架编码 ${code} 已存在`, 400)
  }

  await pool.query(
    `UPDATE warehouse_racks
     SET zone=COALESCE(?,zone), code=COALESCE(?,code), name=COALESCE(?,name),
         max_levels=COALESCE(?,max_levels), max_positions=COALESCE(?,max_positions),
         status=COALESCE(?,status), remark=COALESCE(?,remark)
     WHERE id = ? AND deleted_at IS NULL`,
    [zone ?? null, code ?? null, name ?? null, maxLevels ?? null, maxPositions ?? null,
     status ?? null, remark ?? null, id],
  )
  return findById(id)
}

async function softDelete(id) {
  await findById(id)
  await pool.query(
    'UPDATE warehouse_racks SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

async function enqueuePrintLabel(id, { tenantId = 0, userId = null } = {}) {
  await findById(id)
  const { enqueueRackLabelJob } = require('../print-jobs/print-jobs.service')
  return enqueueRackLabelJob({
    rackId: id,
    tenantId,
    createdBy: userId,
  })
}

module.exports = { findAll, findActive, findById, create, update, softDelete, enqueuePrintLabel }
