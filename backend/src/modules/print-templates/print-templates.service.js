const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const TYPE_NAME = { 1: '销售订单', 2: '采购订单', 3: '出库单', 4: '仓库任务单' }

function fmt(row) {
  return {
    id:         row.id,
    name:       row.name,
    type:       row.type,
    typeName:   TYPE_NAME[row.type] || '未知',
    paperSize:  row.paper_size,
    layout:     typeof row.layout_json === 'string' ? JSON.parse(row.layout_json) : row.layout_json,
    isDefault:  !!row.is_default,
    createdBy:  row.created_by || null,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  }
}

async function findAll({ type } = {}) {
  const cond  = type ? 'WHERE type=?' : ''
  const extra = type ? [type] : []
  const [rows] = await pool.query(`SELECT * FROM print_templates ${cond} ORDER BY type, id`, extra)
  return rows.map(fmt)
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM print_templates WHERE id=?', [id])
  if (!row) throw new AppError('模板不存在', 404)
  return fmt(row)
}

async function create({ name, type, paperSize, layout, createdBy }) {
  if (!name)   throw new AppError('模板名称不能为空', 400)
  if (!type)   throw new AppError('请选择模板类型', 400)
  if (!layout) throw new AppError('布局不能为空', 400)
  const [r] = await pool.query(
    `INSERT INTO print_templates (name, type, paper_size, layout_json, created_by) VALUES (?,?,?,?,?)`,
    [name, type, paperSize || 'A4', JSON.stringify(layout), createdBy || null]
  )
  return { id: r.insertId }
}

async function update(id, { name, type, paperSize, layout }) {
  await findById(id)
  await pool.query(
    `UPDATE print_templates SET name=?, type=?, paper_size=?, layout_json=? WHERE id=?`,
    [name, type, paperSize || 'A4', JSON.stringify(layout), id]
  )
}

async function setDefault(id) {
  const tpl = await findById(id)
  await pool.query('UPDATE print_templates SET is_default=0 WHERE type=?', [tpl.type])
  await pool.query('UPDATE print_templates SET is_default=1 WHERE id=?', [id])
}

async function remove(id) {
  await findById(id)
  await pool.query('DELETE FROM print_templates WHERE id=?', [id])
}

module.exports = { findAll, findById, create, update, setDefault, remove }
