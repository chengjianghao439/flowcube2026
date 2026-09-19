const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { loadPriceRates, computeTierPrices } = require('../../utils/priceLevels')
const { getInventoryDisplayProjectionSql } = require('../inventory/inventoryProjection')
const { normalizePagination } = require('../../utils/pagination')
const { assertInScope } = require('../../utils/warehouseScope')

async function ensureCategoryExists(categoryId) {
  if (!categoryId) throw new AppError('请选择商品分类', 400)
  const [[row]] = await pool.query('SELECT id FROM product_categories WHERE id=? AND deleted_at IS NULL AND status=1', [categoryId])
  if (!row) throw new AppError('商品分类不存在或已停用', 400)
}

async function ensureBarcodeUnique(barcode, currentId = null) {
  if (!barcode || !String(barcode).trim()) return null
  const normalized = String(barcode).trim()
  const [rows] = currentId
    ? await pool.query('SELECT id FROM product_items WHERE barcode=? AND deleted_at IS NULL AND id<>? LIMIT 1', [normalized, currentId])
    : await pool.query('SELECT id FROM product_items WHERE barcode=? AND deleted_at IS NULL LIMIT 1', [normalized])
  if (rows[0]) throw new AppError('产品条码已存在，请勿重复', 400)
  return normalized
}

/** upsert 商品的「通用默认」补货策略（product_stock_policies.warehouse_id=0）；都为 0/空则删除该默认行。db 可传事务连接。 */
async function upsertDefaultStockPolicy(db, productId, { safetyStock, reorderPoint }) {
  const safety  = safetyStock  == null || safetyStock  === '' ? null : Number(safetyStock)
  const reorder = reorderPoint == null || reorderPoint === '' ? null : Number(reorderPoint)
  if (safety == null && reorder == null) return   // 未提交这两个字段：不动策略
  const s = Number.isFinite(safety)  && safety  > 0 ? safety  : 0
  const r = Number.isFinite(reorder) && reorder > 0 ? reorder : 0
  if (s === 0 && r === 0) {
    await db.query('DELETE FROM product_stock_policies WHERE product_id=? AND warehouse_id=0', [productId])
    return
  }
  await db.query(
    `INSERT INTO product_stock_policies (product_id, warehouse_id, safety_stock, reorder_point)
     VALUES (?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE safety_stock=VALUES(safety_stock), reorder_point=VALUES(reorder_point)`,
    [productId, s, r],
  )
}

/**
 * 校验并归一化商品计量单位（文档 03）。纯函数、不碰 DB。baseUnitName 即 product_items.unit（基本单位，率恒 1）；
 * auxUnits 为辅助单位数组 [{unitName, conversionRate}]。返回完整单位列表（基本单位在前）供落库。
 * 硬约束：辅助单位名非空且≠基本单位、彼此不重；换算率为 >1 的正整数（Phase 1 默认只允许整数率，见文档 §11-3）。
 */
function validateUnits(baseUnitName, auxUnits) {
  const base = String(baseUnitName || '').trim()
  if (!base) throw new AppError('基本单位不能为空', 400)
  const out = [{ unitName: base, conversionRate: 1, isBase: 1, sortOrder: 0 }]
  const seen = new Set([base])
  const list = Array.isArray(auxUnits) ? auxUnits : []
  list.forEach((u, i) => {
    const name = String(u?.unitName || '').trim()
    const rate = Number(u?.conversionRate)
    if (!name) throw new AppError('辅助单位名不能为空', 400)
    if (name === base) throw new AppError(`辅助单位「${name}」不能与基本单位同名`, 400)
    if (seen.has(name)) throw new AppError(`辅助单位「${name}」重复`, 400)
    if (!Number.isInteger(rate) || rate <= 1) throw new AppError(`辅助单位「${name}」的换算率必须是大于 1 的整数`, 400)
    seen.add(name)
    out.push({ unitName: name, conversionRate: rate, isBase: 0, sortOrder: i + 1 })
  })
  return out
}

/** 整仓覆盖式写入某商品的单位列表（先删后插；单位配置是可重算数据，文档单据自带 conversion_rate 快照不受影响）。db 传事务连接。 */
async function replaceProductUnits(db, productId, normalizedUnits) {
  await db.query('DELETE FROM product_units WHERE product_id=?', [productId])
  for (const u of normalizedUnits) {
    await db.query(
      'INSERT INTO product_units (product_id, unit_name, conversion_rate, is_base, sort_order) VALUES (?,?,?,?,?)',
      [productId, u.unitName, u.conversionRate, u.isBase, u.sortOrder],
    )
  }
}

/** 读某商品的单位列表（基本单位在前），供 findById 回显与前端换算 */
async function loadProductUnits(productId) {
  const [rows] = await pool.query(
    'SELECT unit_name, conversion_rate, is_base FROM product_units WHERE product_id=? ORDER BY is_base DESC, sort_order ASC, id ASC',
    [productId],
  )
  return rows.map(r => ({ unitName: r.unit_name, conversionRate: Number(r.conversion_rate), isBase: Number(r.is_base) === 1 }))
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
 * - 可选传入 warehouseId 以联查该仓库当前展示用可用库存（容器汇总 + reserved projection）
 * - 自动构建完整分类路径（一级 > 二级 > 三级 > 四级）
 */
async function findForFinder({ page = 1, pageSize = 20, keyword = '', categoryId = null, warehouseId = null, scopeWarehouseIds = null }) {
  // 商品选择器会按 warehouseId 返回该仓的可用库存；warehouseId 由前端传入，
  // 若不校验范围，限仓用户只要换一个 warehouseId 就能枚举任意仓库的可用量
  // （2026-09-18 审计 P2）。传 null 表示不限仓，与既有约定一致。
  assertInScope(scopeWarehouseIds, warehouseId, '仓库')
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const inventoryDisplayProjectionSql = getInventoryDisplayProjectionSql()
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
    conditions.push('(p.code LIKE ? OR p.name LIKE ? OR p.barcode LIKE ? OR p.article_number LIKE ? OR p.spec LIKE ? OR p.color LIKE ?)')
    queryParams.push(like, like, like, like, like, like)
  }
  if (catIds) {
    conditions.push(`p.category_id IN (${catIds.map(() => '?').join(',')})`)
    queryParams.push(...catIds)
  }
  const where = `WHERE ${conditions.join(' AND ')}`

  // 4. 库存联查（可选）
  const stockJoin = warehouseId
    ? `LEFT JOIN ${inventoryDisplayProjectionSql} s ON p.id = s.product_id AND s.warehouse_id = ?`
    : ''
  const stockCol = warehouseId
    ? 'GREATEST(0, COALESCE(s.quantity, 0) - COALESCE(s.reserved, 0))'
    : '0'
  const stockParams = warehouseId ? [warehouseId] : []

  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.sku_code, p.article_number, p.name, p.category_id, p.supplier_id, p.unit, p.sale_price, p.sale_price_a, p.sale_price_b, p.sale_price_c, p.sale_price_d, p.cost_price, p.spec, p.color, p.barcode, p.allow_decimal_qty,
            c.name AS category_name, sup.name AS supplier_name, ${stockCol} AS stock
     FROM product_items p
     LEFT JOIN product_categories c ON p.category_id = c.id AND c.deleted_at IS NULL
     LEFT JOIN supply_suppliers sup ON p.supplier_id = sup.id
     ${stockJoin}
     ${where}
     ORDER BY p.name ASC, p.id ASC LIMIT ? OFFSET ?`,
    [...stockParams, ...queryParams, ps, offset],
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
      id: r.id, code: r.code, name: r.name, barcode: r.barcode || null,
      skuCode: r.sku_code || null, articleNumber: r.article_number || null,
      categoryId:   r.category_id   || null,
      categoryName: r.category_name || null,
      categoryPath: buildPath(r.category_id),
      supplierId: r.supplier_id || null, supplierName: r.supplier_name || null,
      unit: r.unit, spec: r.spec || null, color: r.color || null,
      salePrice: r.sale_price_a != null ? Number(r.sale_price_a) : (r.sale_price != null ? Number(r.sale_price) : null),
      salePriceA: r.sale_price_a != null ? Number(r.sale_price_a) : (r.sale_price != null ? Number(r.sale_price) : null),
      salePriceB: r.sale_price_b != null ? Number(r.sale_price_b) : null,
      salePriceC: r.sale_price_c != null ? Number(r.sale_price_c) : null,
      salePriceD: r.sale_price_d != null ? Number(r.sale_price_d) : null,
      costPrice: r.cost_price != null ? Number(r.cost_price) : null,
      stock: Number(r.stock),
    })),
    pagination: { page, pageSize: ps, total },
  }
}

// ─── 商品 ────────────────────────────────────────────────────────────────────

function fmtProduct(row) {
  return {
    id: row.id, code: row.code, name: row.name,
    skuCode: row.sku_code || null, articleNumber: row.article_number || null,
    categoryId: row.category_id, categoryName: row.category_name||null,
    supplierId: row.supplier_id || null, supplierName: row.supplier_name || null,
    unit: row.unit, spec: row.spec, color: row.color || null, barcode: row.barcode,
    costPrice: row.cost_price != null ? Number(row.cost_price) : null,
    salePrice: row.sale_price_a != null ? Number(row.sale_price_a) : (row.sale_price != null ? Number(row.sale_price) : null),
    salePriceA: row.sale_price_a != null ? Number(row.sale_price_a) : (row.sale_price != null ? Number(row.sale_price) : null),
    salePriceB: row.sale_price_b != null ? Number(row.sale_price_b) : null,
    salePriceC: row.sale_price_c != null ? Number(row.sale_price_c) : null,
    salePriceD: row.sale_price_d != null ? Number(row.sale_price_d) : null,
    batchManaged: Number(row.batch_managed) === 1,
    // 迁移 254：默认允许小数；只有显式关掉开关的商品才要求整数数量
    allowDecimalQty: row.allow_decimal_qty == null ? true : Number(row.allow_decimal_qty) === 1,
    shelfLifeDays: row.shelf_life_days != null ? Number(row.shelf_life_days) : null,
    safetyStock: row.safety_stock != null ? Number(row.safety_stock) : null,
    reorderPoint: row.reorder_point != null ? Number(row.reorder_point) : null,
    remark: row.remark, isActive: !!row.is_active, createdAt: row.created_at,
  }
}

/**
 * 批量取商品的数量小数策略（迁移 254），供前端数量输入框联动 step。
 * 与 allow_decimal_qty 同口径：NULL 视作允许。商品不存在则不出现在结果里，
 * 前端按「允许」兜底——查询失败不该让用户填不了数量。
 */
async function findQtyPolicies(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))]
  if (!list.length) return []
  const [rows] = await pool.query(
    'SELECT id, allow_decimal_qty FROM product_items WHERE id IN (?) AND deleted_at IS NULL',
    [list],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    allowDecimal: row.allow_decimal_qty == null ? true : Number(row.allow_decimal_qty) === 1,
  }))
}

async function assertProductDeletable(id) {
  const checks = [
    ['sale_order_items', 'SELECT 1 FROM sale_order_items WHERE product_id=? LIMIT 1'],
    ['purchase_order_items', 'SELECT 1 FROM purchase_order_items WHERE product_id=? LIMIT 1'],
    ['warehouse_task_items', 'SELECT 1 FROM warehouse_task_items WHERE product_id=? LIMIT 1'],
    ['inbound_task_items', 'SELECT 1 FROM inbound_task_items WHERE product_id=? LIMIT 1'],
    ['inventory_check_items', 'SELECT 1 FROM inventory_check_items WHERE product_id=? LIMIT 1'],
    ['purchase_return_items', 'SELECT 1 FROM purchase_return_items WHERE product_id=? LIMIT 1'],
    ['sale_return_items', 'SELECT 1 FROM sale_return_items WHERE product_id=? LIMIT 1'],
    ['package_items', 'SELECT 1 FROM package_items WHERE product_id=? LIMIT 1'],
    ['inventory_containers', 'SELECT 1 FROM inventory_containers WHERE product_id=? LIMIT 1'],
    ['inventory_stock', 'SELECT 1 FROM inventory_stock WHERE product_id=? LIMIT 1'],
    ['inventory_logs', 'SELECT 1 FROM inventory_logs WHERE product_id=? LIMIT 1'],
    ['scan_logs', 'SELECT 1 FROM scan_logs WHERE product_id=? LIMIT 1'],
    ['price_change_requests', 'SELECT 1 FROM price_change_requests WHERE product_id=? LIMIT 1'],
    ['demand_forecasts', 'SELECT 1 FROM demand_forecasts WHERE product_id=? LIMIT 1'],
    ['product_price_history', 'SELECT 1 FROM product_price_history WHERE product_id=? LIMIT 1'],
  ]
  for (const [, sql] of checks) {
    const [rows] = await pool.query(sql, [id])
    if (rows[0]) {
      throw new AppError('商品已被业务单据、库存或任务引用，禁止删除；请改为停用', 409)
    }
  }
}

async function findAll({ page=1, pageSize=20, keyword='', categoryId=null, status='', supplierId=null, minPrice=null, maxPrice=null }) {
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['p.deleted_at IS NULL']
  const params = []
  if (keyword) {
    const like = `%${keyword}%`
    conds.push('(p.code LIKE ? OR p.name LIKE ? OR p.barcode LIKE ?)')
    params.push(like, like, like)
  }
  if (categoryId) { conds.push('p.category_id = ?'); params.push(categoryId) }
  // 启用状态（is_active）：'1' 启用 / '0' 停用
  if (status === '1' || status === '0') { conds.push('p.is_active = ?'); params.push(status) }
  if (supplierId) { conds.push('p.supplier_id = ?'); params.push(supplierId) }
  const priceExpr = 'COALESCE(p.sale_price_a, p.sale_price)'
  if (minPrice != null && minPrice !== '') { conds.push(`${priceExpr} >= ?`); params.push(Number(minPrice)) }
  if (maxPrice != null && maxPrice !== '') { conds.push(`${priceExpr} <= ?`); params.push(Number(maxPrice)) }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, s.name AS supplier_name
     FROM product_items p LEFT JOIN product_categories c ON p.category_id=c.id
     LEFT JOIN supply_suppliers s ON p.supplier_id=s.id
     WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )

  const [[{total}]] = await pool.query(
    `SELECT COUNT(*) AS total FROM product_items p WHERE ${where}`,
    params,
  )
  const list = rows.map(fmtProduct)
  // 批量带出计量单位（文档03 Phase1 只读展示），一次查询避免 N+1
  if (list.length) {
    const ids = list.map(p => p.id)
    const [uRows] = await pool.query(
      `SELECT product_id, unit_name, conversion_rate, is_base FROM product_units
       WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_base DESC, sort_order ASC, id ASC`,
      ids,
    )
    const byProduct = {}
    for (const u of uRows) (byProduct[u.product_id] ||= []).push({ unitName: u.unit_name, conversionRate: Number(u.conversion_rate), isBase: Number(u.is_base) === 1 })
    list.forEach(p => { p.units = byProduct[p.id] || [] })
  }
  return { list, pagination: { page, pageSize, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    'SELECT id,code,name,unit,spec FROM product_items WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC',
  )
  return rows
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, s.name AS supplier_name,
            sp.safety_stock, sp.reorder_point
     FROM product_items p
     LEFT JOIN product_categories c ON p.category_id=c.id
     LEFT JOIN supply_suppliers s ON p.supplier_id=s.id
     LEFT JOIN product_stock_policies sp ON sp.product_id=p.id AND sp.warehouse_id=0
     WHERE p.id=? AND p.deleted_at IS NULL`, [id],
  )
  if (!rows[0]) throw new AppError('商品不存在',404)
  const product = fmtProduct(rows[0])
  product.units = await loadProductUnits(id)   // 计量单位列表（基本单位在前），供表单回显与前端换算展示
  return product
}

async function create({ name, categoryId, supplierId, unit, spec, color, barcode, costPrice, remark, skuCode, articleNumber, salePriceA, salePriceB, salePriceC, salePriceD, batchManaged, shelfLifeDays, safetyStock, reorderPoint, units, allowDecimalQty }) {
  const { normalizedBarcode, normalizedCost } = await validateProductPayload({ name, categoryId, barcode, costPrice })
  const normalizedUnits = validateUnits(unit, units)   // 纯校验，任何非法输入在建单前就抛错
  const generatedArticle = articleNumber || null   // 供应商型号（供应商给的型号，人工填；缺失即 NULL，不再随机生成）
  const rates = await loadPriceRates(pool)
  const auto = computeTierPrices(normalizedCost, rates)
  const spA = salePriceA != null ? Number(salePriceA) : auto.salePriceA
  const spB = salePriceB != null ? Number(salePriceB) : auto.salePriceB
  const spC = salePriceC != null ? Number(salePriceC) : auto.salePriceC
  const spD = salePriceD != null ? Number(salePriceD) : auto.salePriceD
  const sp = spA // 售价默认取价格A
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 编码/条码用「全局最大 +1」生成，本身带并发窗口（两个事务能读到同一个 MAX）。
    // 数据库级的兜底是迁移 252 加的活跃编码唯一键 `uk_product_items_code_active`；
    // 真正的撞号在这里换号重试一次，而不是把「数据已存在，请勿重复提交」这种与真实原因
    // 无关的报错甩给用户（2026-09-18 审计 [16]）。取号也从事务外挪进事务内，顺序更合理。
    let code = null
    let generatedSku = null
    let generatedBarcode = null
    let insertId = null
    for (let attempt = 0; attempt < 2 && insertId == null; attempt++) {
      code = await generateMasterCode(conn, 'P', 'product_items')
      generatedSku = skuCode || await generateMasterCode(conn, 'SKU', 'product_items', 'sku_code')
      generatedBarcode = normalizedBarcode || await generateMasterCode(conn, 'BC', 'product_items', 'barcode')
      try {
        const [r] = await conn.query(
          `INSERT INTO product_items (code,sku_code,article_number,name,category_id,supplier_id,unit,spec,color,barcode,cost_price,sale_price,sale_price_a,sale_price_b,sale_price_c,sale_price_d,remark,batch_managed,shelf_life_days,allow_decimal_qty)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [code, generatedSku, generatedArticle, String(name).trim(), categoryId||null, supplierId, unit, spec, color, generatedBarcode, normalizedCost, sp, spA, spB, spC, spD, remark||null, batchManaged?1:0, shelfLifeDays||null, allowDecimalQty === false ? 0 : 1],
        )
        insertId = r.insertId
      } catch (e) {
        // 只有编码/条码撞号才值得换号重试；用户显式传入 sku_code/barcode 造成的重复
        // 在第二次尝试里会同样失败，如实抛出。
        if (e.code !== 'ER_DUP_ENTRY' || attempt > 0) throw e
      }
    }
    await replaceProductUnits(conn, insertId, normalizedUnits)
    await upsertDefaultStockPolicy(conn, insertId, { safetyStock, reorderPoint })
    await conn.commit()
    return { id: insertId, code, skuCode: generatedSku, articleNumber: generatedArticle }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function update(id, { name, categoryId, supplierId, unit, spec, color, barcode, costPrice, remark, isActive, articleNumber, salePriceA, salePriceB, salePriceC, salePriceD, batchManaged, shelfLifeDays, safetyStock, reorderPoint, units, allowDecimalQty }, operator = null) {
  const current = await findById(id)
  const { normalizedBarcode, normalizedCost } = await validateProductPayload({ name, categoryId, barcode, costPrice, currentId: id })
  const normalizedUnits = validateUnits(unit, units)
  const rates = await loadPriceRates(pool)
  const auto = computeTierPrices(normalizedCost, rates)
  const spA = salePriceA != null ? Number(salePriceA) : auto.salePriceA
  const spB = salePriceB != null ? Number(salePriceB) : auto.salePriceB
  const spC = salePriceC != null ? Number(salePriceC) : auto.salePriceC
  const spD = salePriceD != null ? Number(salePriceD) : auto.salePriceD
  const sp = spA
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 老客户端不带这个字段时保持原值，不能把「没传」当成「关闭小数」
    const allowDecimalFlag = allowDecimalQty === undefined
      ? (current.allowDecimalQty ? 1 : 0)
      : (allowDecimalQty ? 1 : 0)
    await conn.query(
      `UPDATE product_items SET name=?,category_id=?,supplier_id=?,unit=?,spec=?,color=?,barcode=?,cost_price=?,sale_price=?,sale_price_a=?,sale_price_b=?,sale_price_c=?,sale_price_d=?,remark=?,is_active=?,article_number=?,batch_managed=?,shelf_life_days=?,allow_decimal_qty=?
       WHERE id=? AND deleted_at IS NULL`,
      [String(name).trim(), categoryId||null, supplierId, unit, spec, color, normalizedBarcode, normalizedCost, sp, spA, spB, spC, spD, remark||null, isActive?1:0, articleNumber||null, batchManaged?1:0, shelfLifeDays||null, allowDecimalFlag, id],
    )
    await replaceProductUnits(conn, id, normalizedUnits)
    await upsertDefaultStockPolicy(conn, id, { safetyStock, reorderPoint })
    // 价格变更历史（2026-08-22 功能：价格体系落地）——凡有价格列变化的写历史，可追溯
    const priceFields = [
      ['sale', current.salePrice, sp],
      ['a', current.salePriceA, spA],
      ['b', current.salePriceB, spB],
      ['c', current.salePriceC, spC],
      ['d', current.salePriceD, spD],
      ['cost', current.costPrice, normalizedCost],
    ]
    for (const [type, oldP, newP] of priceFields) {
      const oldV = oldP != null ? Number(oldP) : null
      const newV = newP != null ? Number(newP) : null
      if (oldV !== newV) {
        await conn.query(
          `INSERT INTO product_price_history
             (product_id, product_code, product_name, price_type, old_price, new_price,
              change_source, operator_id, operator_name)
           VALUES (?,?,?,?,?,?, 'manual', ?, ?)`,
          [id, current.code, current.name, type, oldV, newV,
           operator?.userId || null, operator?.realName || operator?.username || null],
        )
      }
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function softDelete(id) {
  await findById(id)
  await assertProductDeletable(id)
  await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[id])
}

async function enqueueLabel(id, { createdBy = null, preferClientId = null } = {}) {
  await findById(id)
  const printJobs = require('../print-jobs/print-jobs.service')
  // 不传 jobUniqueKey：由打印域按「对象 + 时间窗」默认分桶去重（见 print-jobs.label-command）
  return printJobs.enqueueProductLabelJob({
    productId: id,
    createdBy,
    preferClientId,
  })
}

module.exports = {
  findQtyPolicies,
  findAll, findAllActive, findById, create, update, softDelete,
  enqueueLabel,
  findForFinder,
}
