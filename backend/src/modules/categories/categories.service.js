/**
 * 商品分类 Service
 * 支持最多 4 级树形结构
 *
 * 业务规则：
 *  - 禁止创建超过第 4 级的分类
 *  - 禁止删除存在子分类的分类
 *  - 禁止删除已绑定商品的分类（只能停用）
 *  - path 字段记录祖先 id 链，格式 "1/5/12"
 */

const { pool } = require('../../config/db')
const AppError  = require('../../utils/AppError')
const logger    = require('../../utils/logger')
const { generateMasterCode } = require('../../utils/codeGenerator')

// ─── 格式化 ────────────────────────────────────────────────────────────────

function fmt(row) {
  return {
    id:        row.id,
    code:      row.code      ?? null,
    name:      row.name,
    parentId:  row.parent_id ?? null,
    level:     row.level     ?? 1,
    sortOrder: row.sort_order ?? 0,
    status:    row.status    !== undefined ? row.status : 1,
    path:      row.path      ?? '',
    remark:    row.remark    ?? null,
    createdAt: row.created_at,
  }
}

function buildTree(flat) {
  const map = {}
  flat.forEach(r => { map[r.id] = { ...r, children: [] } })
  const roots = []
  flat.forEach(r => {
    if (r.parentId && map[r.parentId]) {
      map[r.parentId].children.push(map[r.id])
    } else {
      roots.push(map[r.id])
    }
  })
  return roots
}

const BASE_SELECT = `
  SELECT id, code, name, parent_id, level, sort_order, status, path, remark, created_at
  FROM product_categories
  WHERE deleted_at IS NULL`

// ─── 查询 ──────────────────────────────────────────────────────────────────

/** 返回树形结构（含 children 递归） */
async function getTree() {
  const [rows] = await pool.query(`${BASE_SELECT} ORDER BY level ASC, sort_order ASC, id ASC`)
  return buildTree(rows.map(fmt))
}

/** 返回扁平列表 */
async function getFlat() {
  const [rows] = await pool.query(`${BASE_SELECT} ORDER BY level ASC, sort_order ASC, id ASC`)
  return rows.map(fmt)
}

/**
 * 返回叶子节点（没有子节点的分类）
 * 即"可绑定商品"的末级分类
 */
async function getLeaves() {
  const [rows] = await pool.query(`
    SELECT a.id, a.code, a.name, a.parent_id, a.level, a.sort_order, a.status, a.path, a.remark, a.created_at
    FROM product_categories a
    WHERE a.deleted_at IS NULL
      AND a.status = 1
      AND NOT EXISTS (
        SELECT 1 FROM product_categories b
        WHERE b.parent_id = a.id AND b.deleted_at IS NULL
      )
    ORDER BY a.level ASC, a.sort_order ASC, a.id ASC
  `)
  return rows.map(fmt)
}

async function getById(id) {
  const [[row]] = await pool.query(
    `${BASE_SELECT} AND id = ?`, [id]
  )
  if (!row) throw new AppError('分类不存在', 404)
  return fmt(row)
}

// ─── 写入 ──────────────────────────────────────────────────────────────────

async function create({ name, parentId, sortOrder, remark }, operatorId) {
  let level = 1
  let path  = ''

  if (parentId) {
    const parent = await getById(parentId)
    if (parent.level >= 4) throw new AppError('已达最大层级（4级），无法在此节点下新建子分类', 400)
    level = parent.level + 1
    path  = parent.path ? `${parent.path}/${parentId}` : String(parentId)
  }

  const code = await generateMasterCode(pool, 'CAT', 'product_categories')

  const [r] = await pool.query(
    `INSERT INTO product_categories (code, name, parent_id, level, sort_order, status, path, remark)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [code, name, parentId || null, level, sortOrder ?? 0, path, remark || null],
  )
  logger.info('categories', `创建分类 [${name}] level=${level} code=${code}`, { id: r.insertId, operatorId })
  return { id: r.insertId, code }
}

async function update(id, { name, sortOrder, status, remark }, operatorId) {
  await getById(id)  // 存在检查

  await pool.query(
    `UPDATE product_categories
     SET name = ?, sort_order = ?, status = ?, remark = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [name, sortOrder ?? 0, status !== undefined ? (status ? 1 : 0) : 1, remark || null, id],
  )
  logger.info('categories', `更新分类 [id=${id}]`, { operatorId })
}

async function remove(id, operatorId) {
  const cat = await getById(id)

  // 禁止删除存在子分类
  const [[{ childCount }]] = await pool.query(
    'SELECT COUNT(*) AS childCount FROM product_categories WHERE parent_id = ? AND deleted_at IS NULL', [id]
  )
  if (childCount > 0) throw new AppError('该分类下存在子分类，请先删除子分类', 400)

  // 禁止删除已绑定商品（提示停用）
  const [[{ productCount }]] = await pool.query(
    'SELECT COUNT(*) AS productCount FROM product_items WHERE category_id = ? AND deleted_at IS NULL', [id]
  )
  if (productCount > 0) throw new AppError(`该分类已绑定 ${productCount} 个商品，无法删除，请改为停用`, 400)

  await pool.query(
    'UPDATE product_categories SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]
  )
  logger.info('categories', `删除分类 [${cat.name}]`, { operatorId })
}

async function toggleStatus(id, status, operatorId) {
  const cat = await getById(id)
  await pool.query(
    'UPDATE product_categories SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, id]
  )
  logger.info('categories', `${status ? '启用' : '停用'}分类 [${cat.name}]`, { operatorId })
}

module.exports = { getTree, getFlat, getLeaves, getById, create, update, remove, toggleStatus }
