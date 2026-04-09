const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

async function ensureSupplierNameUnique(name, currentId = null) {
  const normalized = String(name || '').trim()
  if (!normalized) throw new AppError('供应商名称不能为空', 400)
  const [rows] = currentId
    ? await pool.query('SELECT id FROM supply_suppliers WHERE name=? AND deleted_at IS NULL AND id<>? LIMIT 1', [normalized, currentId])
    : await pool.query('SELECT id FROM supply_suppliers WHERE name=? AND deleted_at IS NULL LIMIT 1', [normalized])
  if (rows[0]) throw new AppError('供应商名称已存在，请勿重复', 400)
  return normalized
}

function fmt(row) {
  return {
    id: row.id, code: row.code, name: row.name,
    contact: row.contact, phone: row.phone, email: row.email,
    address: row.address, remark: row.remark,
    isActive: !!row.is_active, createdAt: row.created_at,
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '' }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const [rows] = await pool.query(
    `SELECT * FROM supply_suppliers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [like, like, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM supply_suppliers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)`,
    [like, like],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    'SELECT id, code, name FROM supply_suppliers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC',
  )
  return rows
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM supply_suppliers WHERE id=? AND deleted_at IS NULL', [id],
  )
  if (!rows[0]) throw new AppError('供应商不存在', 404)
  return fmt(rows[0])
}

async function create({ name, contact, phone, email, address, remark }) {
  const normalizedName = await ensureSupplierNameUnique(name)
  const code = await generateMasterCode(pool, 'SUP', 'supply_suppliers')
  const [r] = await pool.query(
    `INSERT INTO supply_suppliers (code,name,contact,phone,email,address,remark) VALUES (?,?,?,?,?,?,?)`,
    [code, normalizedName, contact||null, phone||null, email||null, address||null, remark||null],
  )
  return { id: r.insertId, code }
}

async function update(id, { name, contact, phone, email, address, remark, isActive }) {
  await findById(id)
  const normalizedName = await ensureSupplierNameUnique(name, id)
  await pool.query(
    `UPDATE supply_suppliers SET name=?,contact=?,phone=?,email=?,address=?,remark=?,is_active=? WHERE id=? AND deleted_at IS NULL`,
    [normalizedName, contact||null, phone||null, email||null, address||null, remark||null, isActive?1:0, id],
  )
}

async function softDelete(id) {
  await findById(id)
  await pool.query('UPDATE supply_suppliers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id])
}

module.exports = { findAll, findAllActive, findById, create, update, softDelete }
