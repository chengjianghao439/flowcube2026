const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { loadPriceRates, computeTierPrices } = require('../../utils/priceLevels')

async function ensureCategoryExists(categoryId) {
  if (!categoryId) throw new AppError('请选择商品分类', 400)
  const [[row]] = await pool.query('SELECT id FROM product_categories WHERE id=? AND deleted_at IS NULL AND status=1', [categoryId])
  if (!row) throw new AppError('商品分类不存在或已停用', 400)
}

async function ensureBarcodeUnique(barcode, currentId = null) {
  if (!barcode || !String(barcode).trim()) throw new AppError('产品条码不能为空', 400)
  const normalized = String(barcode).trim()
  const [rows] = currentId
    ? await pool.query('SELECT id FROM product_items WHERE barcode=? AND deleted_at IS NULL AND id<>? LIMIT 1', [normalized, currentId])
    : await pool.query('SELECT id FROM product_items WHERE barcode=? AND deleted_at IS NULL LIMIT 1', [normalized])
  if (rows[0]) throw new AppError('产品条码已存在，请勿重复', 400)
  return normalized
}

async function validateProductPayload({ name, categoryId, barcode, costPrice, currentId = null }) {
  if (!String(name || '').trim()) throw new AppError('商品名称不能为空', 400)
  await ensureCategoryExists(categoryId)
  const normalizedBarcode = await ensureBarcodeUnique(barcode, currentId)
  const normalizedCost = Number(costPrice)
  if (!Number.isFinite(normalizedCost) || normalizedCost <= 0) throw new AppError('进价必须大于 0', 400)
  return { normalizedBarcode, normalizedCost }
}

// ─── 商品选择中心（Finder）────────────────────────────────────────────────────

/**
 * 商品选择中心专用分页查询
 * - 支持关键字（编码 / 名称 / 条码）
 * - 支持分类过滤（自动包含所有子孙分类）
 * - 可选传入 warehouseId 以联查该仓库当前可用库存
 * - 自动构建完整分类路径（一级 > 二级 > 三级 > 四级）
 */
async function findForFinder({ page = 1, pageSize = 20, keyword = '', categoryId = null, warehouseId = null }) {
  // 1. 先取所有分类，用于路径拼接 + 子孙 ID 展开
  const [catRows] = await pool.query(
    'SELECT id, name, parent_id, path FROM product_categories WHERE deleted_at IS NULL'
  )
  const catMap = Object.fromEntries(catRows.map(c => [c.id, c]))

  function buildPath(catId) {
    if (!catId || !catMap[catId]) return null
    const cat = catMap[catId]
    const ancestorIds = cat.path ? cat.path.split('/').filter(Boolean).map(Number) : []
    return [...ancestorIds.map(id => catMap[id]?.name).filter(Boolean), cat.name].join(' > ')
  }

  // 2. 展开分类 ID（含子孙）
  let catIds = null
  if (categoryId) {
    const ids = [categoryId]
    catRows.forEach(c => {
      if (!c.path) return
      if (c.path.split('/').filter(Boolean).map(Number).includes(categoryId)) ids.push(c.id)
    })
    catIds = [...new Set(ids)]
  }

  // 3. 动态构建 WHERE 条件
  const conditions = ['p.deleted_at IS NULL', 'p.is_active = 1']
  const queryParams = []

  if (keyword) {
    const like = `%${keyword}%`
    conditions.push('(p.code LIKE ? OR p.name LIKE ? OR p.barcode LIKE ?)')
    queryParams.push(like, like, like)
  }
  if (catIds) {
    conditions.push(`p.category_id IN (${catIds.map(() => '?').join(',')})`)
    queryParams.push(...catIds)
  }
  const where = `WHERE ${conditions.join(' AND ')}`

  // 4. 库存联查（可选）
  const stockJoin = warehouseId
    ? 'LEFT JOIN inventory_stock s ON p.id = s.product_id AND s.warehouse_id = ?'
    : ''
  const stockCol = warehouseId
    ? 'GREATEST(0, COALESCE(s.quantity, 0) - COALESCE(s.reserved, 0))'
    : '0'
  const stockParams = warehouseId ? [warehouseId] : []

  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.name, p.category_id, p.unit, p.sale_price, p.sale_price_a, p.sale_price_b, p.sale_price_c, p.sale_price_d, p.cost_price, p.spec, p.barcode,
            c.name AS category_name, ${stockCol} AS stock
     FROM product_items p
     LEFT JOIN product_categories c ON p.category_id = c.id AND c.deleted_at IS NULL
     ${stockJoin}
     ${where}
     ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    [...stockParams, ...queryParams, pageSize, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM product_items p
     LEFT JOIN product_categories c ON p.category_id = c.id AND c.deleted_at IS NULL
     ${stockJoin}
     ${where}`,
    [...stockParams, ...queryParams],
  )

  return {
    list: rows.map(r => ({
      id: r.id, code: r.code, name: r.name,
      categoryId:   r.category_id   || null,
      categoryName: r.category_name || null,
      categoryPath: buildPath(r.category_id),
      unit: r.unit, spec: r.spec || null,
      salePrice: r.sale_price_a != null ? Number(r.sale_price_a) : (r.sale_price != null ? Number(r.sale_price) : null),
      salePriceA: r.sale_price_a != null ? Number(r.sale_price_a) : (r.sale_price != null ? Number(r.sale_price) : null),
      salePriceB: r.sale_price_b != null ? Number(r.sale_price_b) : null,
      salePriceC: r.sale_price_c != null ? Number(r.sale_price_c) : null,
      salePriceD: r.sale_price_d != null ? Number(r.sale_price_d) : null,
      costPrice: r.cost_price != null ? Number(r.cost_price) : null,
      stock: Number(r.stock),
    })),
    pagination: { page, pageSize, total },
  }
}

// ─── 商品 ────────────────────────────────────────────────────────────────────

function fmtProduct(row) {
  return {
    id: row.id, code: row.code, name: row.name,
    categoryId: row.category_id, categoryName: row.category_name||null,
    unit: row.unit, spec: row.spec, barcode: row.barcode,
    costPrice: row.cost_price != null ? Number(row.cost_price) : null,
    salePrice: row.sale_price_a != null ? Number(row.sale_price_a) : (row.sale_price != null ? Number(row.sale_price) : null),
    salePriceA: row.sale_price_a != null ? Number(row.sale_price_a) : (row.sale_price != null ? Number(row.sale_price) : null),
    salePriceB: row.sale_price_b != null ? Number(row.sale_price_b) : null,
    salePriceC: row.sale_price_c != null ? Number(row.sale_price_c) : null,
    salePriceD: row.sale_price_d != null ? Number(row.sale_price_d) : null,
    remark: row.remark, isActive: !!row.is_active, createdAt: row.created_at,
  }
}

async function findAll({ page=1, pageSize=20, keyword='', categoryId=null }) {
  const offset = (page-1)*pageSize
  const like = `%${keyword}%`
  const catFilter = categoryId ? 'AND p.category_id = ?' : ''
  const params = categoryId
    ? [like, like, like, categoryId, pageSize, offset]
    : [like, like, like, pageSize, offset]

  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name
     FROM product_items p LEFT JOIN product_categories c ON p.category_id=c.id
     WHERE p.deleted_at IS NULL AND (p.code LIKE ? OR p.name LIKE ? OR p.barcode LIKE ?)
     ${catFilter} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    params,
  )

  const cntParams = categoryId ? [like, like, like, categoryId] : [like, like, like]
  const [[{total}]] = await pool.query(
    `SELECT COUNT(*) AS total FROM product_items p
     WHERE p.deleted_at IS NULL AND (p.code LIKE ? OR p.name LIKE ? OR p.barcode LIKE ?) ${catFilter}`,
    cntParams,
  )
  return { list: rows.map(fmtProduct), pagination: { page, pageSize, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    'SELECT id,code,name,unit,spec FROM product_items WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC',
  )
  return rows
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name FROM product_items p
     LEFT JOIN product_categories c ON p.category_id=c.id
     WHERE p.id=? AND p.deleted_at IS NULL`, [id],
  )
  if (!rows[0]) throw new AppError('商品不存在',404)
  return fmtProduct(rows[0])
}

async function create({ name, categoryId, unit, spec, barcode, costPrice, remark }) {
  const { normalizedBarcode, normalizedCost } = await validateProductPayload({ name, categoryId, barcode, costPrice })
  const code = await generateMasterCode(pool, 'P', 'product_items')
  const rates = await loadPriceRates(pool)
  const prices = computeTierPrices(normalizedCost, rates)
  const [r] = await pool.query(
    `INSERT INTO product_items (code,name,category_id,unit,spec,barcode,cost_price,sale_price,sale_price_a,sale_price_b,sale_price_c,sale_price_d,remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, String(name).trim(), categoryId||null, unit||'个', spec||null, normalizedBarcode, prices.costPrice, prices.salePrice, prices.salePriceA, prices.salePriceB, prices.salePriceC, prices.salePriceD, remark||null],
  )
  return { id: r.insertId, code }
}

async function update(id, { name, categoryId, unit, spec, barcode, costPrice, remark, isActive }) {
  await findById(id)
  const { normalizedBarcode, normalizedCost } = await validateProductPayload({ name, categoryId, barcode, costPrice, currentId: id })
  const rates = await loadPriceRates(pool)
  const prices = computeTierPrices(normalizedCost, rates)
  await pool.query(
    `UPDATE product_items SET name=?,category_id=?,unit=?,spec=?,barcode=?,cost_price=?,sale_price=?,sale_price_a=?,sale_price_b=?,sale_price_c=?,sale_price_d=?,remark=?,is_active=?
     WHERE id=? AND deleted_at IS NULL`,
    [String(name).trim(), categoryId||null, unit||'个', spec||null, normalizedBarcode, prices.costPrice, prices.salePrice, prices.salePriceA, prices.salePriceB, prices.salePriceC, prices.salePriceD, remark||null, isActive?1:0, id],
  )
}

async function softDelete(id) {
  await findById(id)
  await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[id])
}

async function enqueueLabel(id, { createdBy = null } = {}) {
  await findById(id)
  const printJobs = require('../print-jobs/print-jobs.service')
  return printJobs.enqueueProductLabelJob({
    productId: id,
    createdBy,
    jobUniqueKey: `product_label:${id}:${Date.now()}`,
  })
}

module.exports = {
  findAll, findAllActive, findById, create, update, softDelete,
  enqueueLabel,
  findForFinder,
}
