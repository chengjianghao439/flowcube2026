const { pool }    = require('../../config/db')
const AppError    = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

const fmt = r => ({
  id:        r.id,
  code:      r.code,
  name:      r.name,
  type:      r.type || 'express',
  contact:   r.contact  || null,
  phone:     r.phone    || null,
  remark:    r.remark   || null,
  isActive:  !!r.is_active,
  createdAt: r.created_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '' } = {}) {
  const like   = `%${keyword}%`
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT * FROM carriers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR contact LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [like, like, like, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM carriers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR contact LIKE ?)`,
    [like, like, like],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    `SELECT id, code, name FROM carriers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC`,
  )
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name }))
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL`, [id],
  )
  if (!row) throw new AppError('承运商不存在', 404)
  return fmt(row)
}

async function create({ name, type, contact, phone, remark }) {
  if (!name) throw new AppError('名称不能为空', 400)
  const code = await generateMasterCode(pool, 'CAR', 'carriers')
  const [r] = await pool.query(
    `INSERT INTO carriers (code, name, type, contact, phone, remark) VALUES (?,?,?,?,?,?)`,
    [code, name, type || 'express', contact || null, phone || null, remark || null],
  )
  return { id: r.insertId, code }
}

async function update(id, { name, type, contact, phone, remark, isActive }) {
  await findById(id)
  await pool.query(
    `UPDATE carriers SET name=?, type=?, contact=?, phone=?, remark=?, is_active=? WHERE id=? AND deleted_at IS NULL`,
    [name, type || 'express', contact || null, phone || null, remark || null, isActive ? 1 : 0, id],
  )
}

async function remove(id) {
  await findById(id)
  await pool.query(`UPDATE carriers SET deleted_at=NOW() WHERE id=?`, [id])
}

module.exports = { findAll, findAllActive, findById, create, update, remove }
