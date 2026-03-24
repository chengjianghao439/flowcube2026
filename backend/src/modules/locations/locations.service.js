const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

function pad(val) {
  if (!val) return ''
  return String(val).padStart(2, '0')
}

function generateCode({ zone, aisle, rack, level, position }) {
  if (!zone || !aisle || !rack || !level || !position) return ''
  return `${zone}${pad(aisle)}-${pad(rack)}-${pad(level)}${pad(position)}`
}

function formatRow(row) {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name ?? null,
    code: row.code,
    zone: row.zone,
    aisle: row.aisle,
    rack: row.rack,
    level: row.level,
    position: row.position,
    name: row.name,
    remark: row.remark,
    status: row.status,
    createdAt: row.created_at,
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '', warehouseId = null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`

  const conditions = ['wl.deleted_at IS NULL', '(wl.code LIKE ? OR wl.name LIKE ?)']
  const params = [like, like]

  if (warehouseId) {
    conditions.push('wl.warehouse_id = ?')
    params.push(warehouseId)
  }

  const where = conditions.join(' AND ')

  const [rows] = await pool.query(
    `SELECT wl.*, iw.name AS warehouse_name
     FROM warehouse_locations wl
     LEFT JOIN inventory_warehouses iw ON iw.id = wl.warehouse_id
     WHERE ${where}
     ORDER BY wl.warehouse_id ASC, wl.code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM warehouse_locations wl WHERE ${where}`,
    params,
  )

  return { list: rows.map(formatRow), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT wl.*, iw.name AS warehouse_name
     FROM warehouse_locations wl
     LEFT JOIN inventory_warehouses iw ON iw.id = wl.warehouse_id
     WHERE wl.id = ? AND wl.deleted_at IS NULL`,
    [id],
  )
  if (!rows[0]) throw new AppError('库位不存在', 404)
  return formatRow(rows[0])
}

async function create(data) {
  const { warehouseId, zone, aisle, rack, level, position, name, remark } = data
  if (!warehouseId) throw new AppError('仓库不能为空', 400)

  const code = generateCode({ zone, aisle, rack, level, position })
  if (!code) throw new AppError('库位编码字段不完整', 400)

  // 同仓库内编码唯一
  const [[exists]] = await pool.query(
    'SELECT id FROM warehouse_locations WHERE warehouse_id = ? AND code = ? AND deleted_at IS NULL',
    [warehouseId, code],
  )
  if (exists) throw new AppError(`库位编码 ${code} 已存在`, 400)

  const [result] = await pool.query(
    `INSERT INTO warehouse_locations
       (warehouse_id, code, zone, aisle, rack, level, position, name, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [warehouseId, code, zone, pad(aisle), pad(rack), pad(level), pad(position), name || '', remark || ''],
  )
  return findById(result.insertId)
}

async function update(id, data) {
  await findById(id)
  const { warehouseId, zone, aisle, rack, level, position, name, remark, status } = data

  const code = generateCode({ zone, aisle, rack, level, position })
  if (!code) throw new AppError('库位编码字段不完整', 400)

  // 检查同仓库编码唯一（排除自身）
  const [[exists]] = await pool.query(
    'SELECT id FROM warehouse_locations WHERE warehouse_id = ? AND code = ? AND id <> ? AND deleted_at IS NULL',
    [warehouseId, code, id],
  )
  if (exists) throw new AppError(`库位编码 ${code} 已存在`, 400)

  await pool.query(
    `UPDATE warehouse_locations
     SET warehouse_id=?, code=?, zone=?, aisle=?, rack=?, level=?, position=?, name=?, remark=?, status=?
     WHERE id=? AND deleted_at IS NULL`,
    [warehouseId, code, zone, pad(aisle), pad(rack), pad(level), pad(position), name || '', remark || '', status ?? 1, id],
  )
  return findById(id)
}

async function softDelete(id) {
  await findById(id)
  await pool.query(
    'UPDATE warehouse_locations SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

/**
 * PDA 上架时自动查找或创建库位
 * 规则：code = rackCode + "-" + level.padStart(2,'0') + "-" + position.padStart(2,'0')
 * 例：A01 + 02 + 03 → A01-02-03
 *
 * @param {object} conn       - 事务连接（调用方已开启事务）
 * @param {object} params
 * @param {number} params.warehouseId
 * @param {string} params.rackCode   - 货架编码，如 A01
 * @param {string} params.level      - 层，如 "02" 或 "2"
 * @param {string} params.position   - 位，如 "03" 或 "3"
 * @returns {number} location_id
 */
async function findOrCreateByRackLevel(conn, { warehouseId, rackCode, level, position }) {
  if (!warehouseId || !rackCode || !level || !position) {
    throw new AppError('库位参数不完整（需要 warehouseId/rackCode/level/position）', 400)
  }
  const pad = v => String(v).padStart(2, '0')
  const code = `${rackCode}-${pad(level)}-${pad(position)}`

  // 先查找已存在的库位
  const [[existing]] = await conn.query(
    'SELECT id FROM warehouse_locations WHERE warehouse_id = ? AND code = ? AND deleted_at IS NULL',
    [warehouseId, code],
  )
  if (existing) return existing.id

  // 不存在则自动创建
  const [result] = await conn.query(
    `INSERT INTO warehouse_locations (warehouse_id, code, zone, rack, level, position, capacity, status)
     VALUES (?, ?, '', ?, ?, ?, 0, 1)`,
    [warehouseId, code, rackCode, pad(level), pad(position)],
  )
  return result.insertId
}

async function findByCode(code) {
  const [rows] = await pool.query(
    'SELECT id, code, name, zone, aisle, rack, level, position, warehouse_id, status FROM warehouse_locations WHERE code = ? AND deleted_at IS NULL LIMIT 1',
    [code]
  )
  if (!rows.length) throw new AppError(`库位编码 ${code} 不存在`, 404)
  const r = rows[0]
  return { id: r.id, code: r.code, name: r.name, zone: r.zone, aisle: r.aisle, rack: r.rack, level: r.level, position: r.position, warehouseId: r.warehouse_id, status: r.status }
}

module.exports = { findByCode, findAll, findById, create, update, softDelete, generateCode, findOrCreateByRackLevel }
