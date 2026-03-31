const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { safeJsonParse } = require('../../utils/safeJsonParse')

const TYPE_NAME = {
  1: '销售订单',
  2: '采购订单',
  3: '出库单',
  4: '仓库任务单',
  5: '货架条码标签(ZPL)',
  6: '库存条码标签(ZPL)',
  7: '物流条码标签(ZPL)',
  8: '产品条码标签(ZPL)',
  9: '库存标签(ZPL)',
}

function validateLayout(type, layout) {
  const t = Number(type)
  if (t >= 5 && t <= 9) {
    if (!layout) throw new AppError('布局不能为空', 400)
    if (layout.format === 'zpl' && typeof layout.body === 'string' && layout.body.trim()) {
      if (!String(layout.body).includes('^XA')) {
        throw new AppError('ZPL 正文须包含 ^XA 起始指令', 400)
      }
      return
    }
    if (Array.isArray(layout.elements)) {
      if (layout.elements.length === 0) {
        throw new AppError('标签模板至少包含一个画布元素', 400)
      }
      if (layout.canvasWidthMm != null) {
        const w = Number(layout.canvasWidthMm)
        if (!Number.isFinite(w) || w < 30 || w > 120) {
          throw new AppError('标签模板纸宽须在 30–120 mm', 400)
        }
      }
      if (layout.canvasHeightMm != null) {
        const h = Number(layout.canvasHeightMm)
        if (!Number.isFinite(h) || h < 40 || h > 500) {
          throw new AppError('标签模板纸高须在 40–500 mm', 400)
        }
      }
      return
    }
    throw new AppError('标签模板须使用画布布局（elements）或兼容的 ZPL 正文（format=zpl）', 400)
  }
  if (!layout || !Array.isArray(layout.elements)) {
    throw new AppError('布局须包含 elements 数组', 400)
  }
}

function parseLayoutJson(row) {
  if (typeof row.layout_json !== 'string') return row.layout_json
  try {
    return safeJsonParse(row.layout_json, `print_templates#${row.id} layout_json`, {
      logBeforeParse: process.env.FLOWCUBE_DEBUG_JSON === '1',
    })
  } catch {
    throw new AppError(`打印模板 #${row.id} 的 layout_json 不是合法 JSON，请检查数据库或重新保存模板`, 500)
  }
}

function fmt(row) {
  return {
    id:         row.id,
    name:       row.name,
    type:       row.type,
    typeName:   TYPE_NAME[row.type] || '未知',
    paperSize:  row.paper_size,
    layout:     parseLayoutJson(row),
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
  if (!name) throw new AppError('模板名称不能为空', 400)
  if (!type) throw new AppError('请选择模板类型', 400)
  validateLayout(type, layout)
  const t = Number(type)
  const paper =
    t >= 5 && t <= 9 ? paperSize || 'thermal80' : paperSize || 'A4'
  const [r] = await pool.query(
    `INSERT INTO print_templates (name, type, paper_size, layout_json, created_by) VALUES (?,?,?,?,?)`,
    [name, type, paper, JSON.stringify(layout), createdBy || null]
  )
  return { id: r.insertId }
}

async function update(id, { name, type, paperSize, layout }) {
  await findById(id)
  validateLayout(type, layout)
  const t = Number(type)
  const paper =
    t >= 5 && t <= 9 ? paperSize || 'thermal80' : paperSize || 'A4'
  await pool.query(
    `UPDATE print_templates SET name=?, type=?, paper_size=?, layout_json=? WHERE id=?`,
    [name, type, paper, JSON.stringify(layout), id]
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
