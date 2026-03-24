const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const TYPE_NAME = { 1: '标签打印机', 2: '面单打印机', 3: 'A4打印机' }

function fmt(row) {
  return {
    id:          row.id,
    name:        row.name,
    code:        row.code,
    type:        row.type,
    typeName:    TYPE_NAME[row.type] || '其他',
    description: row.description,
    status:      row.status,
    source:      row.source,
    clientId:    row.client_id,
    clientAliasName: row.client_alias_name,
    clientHostname: row.client_hostname,
    clientDisplayName: row.client_alias_name || row.client_hostname || row.client_id || null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

async function findAll({ type } = {}) {
  const cond   = type ? 'WHERE type=?' : ''
  const params = type ? [type] : []
  const [rows] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     ${cond} ORDER BY p.type, p.id`,
    params
  )
  return rows.map(fmt)
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id=?`,
    [id]
  )
  if (!row) throw new AppError('打印机不存在', 404)
  return fmt(row)
}

async function create({ name, code, type, description }) {
  if (!name) throw new AppError('名称不能为空', 400)
  if (!code) throw new AppError('编码不能为空', 400)
  if (!type) throw new AppError('类型不能为空', 400)
  const [r] = await pool.query(
    'INSERT INTO printers (name, code, type, description) VALUES (?,?,?,?)',
    [name, code, type, description || null]
  )
  return findById(r.insertId)
}

async function update(id, { name, code, type, description, status }) {
  await findById(id)
  await pool.query(
    'UPDATE printers SET name=?, code=?, type=?, description=?, status=? WHERE id=?',
    [name, code, type, description || null, status ?? 1, id]
  )
  return findById(id)
}

async function remove(id) {
  await findById(id)
  await pool.query('DELETE FROM printers WHERE id=?', [id])
}

async function setStatus(id, status) {
  await pool.query('UPDATE printers SET status=? WHERE id=?', [status, id])
}

module.exports = { findAll, findById, create, update, remove, setStatus }
