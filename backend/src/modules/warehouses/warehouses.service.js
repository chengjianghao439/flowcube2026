const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

const TYPE_NAMES = { 1: '成品仓', 2: '原料仓', 3: '退货仓', 4: '其他' }

function formatRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    typeName: TYPE_NAMES[row.type] ?? '其他',
    manager: row.manager,
    phone: row.phone,
    address: row.address,
    remark: row.remark,
    isActive: !!row.is_active,
    createdAt: row.created_at,
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '' }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`

  const [rows] = await pool.query(
    `SELECT * FROM inventory_warehouses
     WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [like, like, pageSize, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory_warehouses
     WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)`,
    [like, like],
  )

  return { list: rows.map(formatRow), pagination: { page, pageSize, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    'SELECT id, code, name, type FROM inventory_warehouses WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name ASC',
  )
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type }))
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM inventory_warehouses WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (!rows[0]) throw new AppError('仓库不存在', 404)
  return formatRow(rows[0])
}

async function create({ name, type, manager, phone, address, remark }) {
  const code = await generateMasterCode(pool, 'WH', 'inventory_warehouses')
  const [result] = await pool.query(
    `INSERT INTO inventory_warehouses (code, name, type, manager, phone, address, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [code, name, type, manager || null, phone || null, address || null, remark || null],
  )
  return { id: result.insertId, code }
}

async function update(id, { name, type, manager, phone, address, remark, isActive }) {
  await findById(id)
  await pool.query(
    `UPDATE inventory_warehouses
     SET name=?, type=?, manager=?, phone=?, address=?, remark=?, is_active=?
     WHERE id=? AND deleted_at IS NULL`,
    [name, type, manager || null, phone || null, address || null, remark || null, isActive ? 1 : 0, id],
  )
}

async function softDelete(id) {
  await findById(id)
  await pool.query(
    'UPDATE inventory_warehouses SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

module.exports = { findAll, findAllActive, findById, create, update, softDelete }
