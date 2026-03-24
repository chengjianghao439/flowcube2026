const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock, adjustContainersForStockcheck } = require('../../engine/containerEngine')

// ─── 库存查询 ─────────────────────────────────────────────────────────────────

async function getStock({ page=1, pageSize=20, keyword='', warehouseId=null }) {
  const offset = (page-1)*pageSize
  const like = `%${keyword}%`
  const whFilter = warehouseId ? 'AND s.warehouse_id=?' : ''
  const params = warehouseId
    ? [like, like, warehouseId, pageSize, offset]
    : [like, like, pageSize, offset]

  const [rows] = await pool.query(
    `SELECT s.id, s.quantity, COALESCE(s.reserved, 0) AS reserved,
            p.id AS product_id, p.code AS product_code, p.name AS product_name, p.unit,
            w.id AS warehouse_id, w.name AS warehouse_name
     FROM inventory_stock s
     JOIN product_items p ON s.product_id=p.id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON s.warehouse_id=w.id AND w.deleted_at IS NULL
     WHERE (p.code LIKE ? OR p.name LIKE ?) ${whFilter}
     ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    params,
  )

  const cntParams = warehouseId ? [like, like, warehouseId] : [like, like]
  const [[{total}]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory_stock s
     JOIN product_items p ON s.product_id=p.id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON s.warehouse_id=w.id AND w.deleted_at IS NULL
     WHERE (p.code LIKE ? OR p.name LIKE ?) ${whFilter}`,
    cntParams,
  )

  return {
    list: rows.map(r => {
      const onHand   = Number(r.quantity)
      const reserved = Number(r.reserved)
      return {
        id: r.id,
        quantity:  onHand,
        reserved,
        available: Math.max(0, onHand - reserved),
        productId: r.product_id, productCode: r.product_code, productName: r.product_name, unit: r.unit,
        warehouseId: r.warehouse_id, warehouseName: r.warehouse_name,
      }
    }),
    pagination: { page, pageSize, total },
  }
}

// ─── 流水记录 ─────────────────────────────────────────────────────────────────

async function getLogs({ page=1, pageSize=20, type=null, productId=null, warehouseId=null }) {
  const offset = (page-1)*pageSize
  const conditions = ['1=1']
  const params = []
  if (type) { conditions.push('l.type=?'); params.push(type) }
  if (productId) { conditions.push('l.product_id=?'); params.push(productId) }
  if (warehouseId) { conditions.push('l.warehouse_id=?'); params.push(warehouseId) }
  const where = conditions.join(' AND ')

  const [rows] = await pool.query(
    `SELECT l.*, p.code AS product_code, p.name AS product_name, p.unit,
            w.name AS warehouse_name, s.name AS supplier_name
     FROM inventory_logs l
     JOIN product_items p ON l.product_id=p.id
     JOIN inventory_warehouses w ON l.warehouse_id=w.id
     LEFT JOIN supply_suppliers s ON l.supplier_id=s.id
     WHERE ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const [[{total}]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory_logs l WHERE ${where}`, params,
  )

  const TYPE_NAMES = { 1:'入库', 2:'出库', 3:'调整' }
  return {
    list: rows.map(r => ({
      id: r.id, type: r.type, typeName: TYPE_NAMES[r.type],
      productId: r.product_id, productCode: r.product_code, productName: r.product_name, unit: r.unit,
      warehouseId: r.warehouse_id, warehouseName: r.warehouse_name,
      supplierId: r.supplier_id, supplierName: r.supplier_name,
      quantity: Number(r.quantity), beforeQty: Number(r.before_qty), afterQty: Number(r.after_qty),
      unitPrice: r.unit_price ? Number(r.unit_price) : null,
      remark: r.remark, operatorId: r.operator_id, operatorName: r.operator_name,
      createdAt: r.created_at,
    })),
    pagination: { page, pageSize, total },
  }
}

// ─── 入库 / 出库 / 调整 ───────────────────────────────────────────────────────
//
// type=1 手动入库  → adjustContainerStock(+qty)  创建新容器
// type=2 手动出库  → adjustContainerStock(-qty)  FIFO 扣减容器
// type=3 直接设定  → adjustContainersForStockcheck(delta) 盘盈创建/盘亏扣减
//
// 所有路径均通过 containerEngine 完成，inventory_stock 仅作缓存写入

async function changeStock({ type, productId, warehouseId, supplierId, quantity, unitPrice, remark, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[product]] = await conn.query(
      'SELECT id, name, unit FROM product_items WHERE id=? AND deleted_at IS NULL', [productId],
    )
    if (!product) throw new AppError('商品不存在', 404)

    const [[warehouse]] = await conn.query(
      'SELECT id FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL AND is_active=1', [warehouseId],
    )
    if (!warehouse) throw new AppError('仓库不存在或已停用', 404)

    let moveType, before, after

    if (type === 1) {
      // 手动入库：创建新容器
      moveType = MOVE_TYPE.MANUAL_IN;
      ({ before, after } = await adjustContainerStock(conn, {
        productId, productName: product.name, warehouseId,
        qty: +quantity, unit: product.unit,
        sourceRefType: 'manual', sourceRefNo: 'MANUAL',
        remark: remark || '手动入库',
      }))
    } else if (type === 2) {
      // 手动出库：FIFO 扣减容器（不足则抛出）
      moveType = MOVE_TYPE.MANUAL_OUT;
      ({ before, after } = await adjustContainerStock(conn, {
        productId, productName: product.name, warehouseId,
        qty: -quantity, unit: product.unit,
        sourceRefType: 'manual', sourceRefNo: 'MANUAL',
        remark: remark || '手动出库',
      }))
    } else {
      // 直接设定（type=3）：计算 delta，走盘点容器路径
      moveType = MOVE_TYPE.STOCKCHECK;
      const [[stockRow]] = await conn.query(
        'SELECT COALESCE(quantity,0) AS qty FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
        [productId, warehouseId],
      )
      const currentQty = stockRow ? Number(stockRow.qty) : 0
      const diffQty    = quantity - currentQty;
      ({ before, after } = await adjustContainersForStockcheck(conn, {
        productId, productName: product.name, warehouseId,
        diffQty, unit: product.unit,
        sourceRefType: 'manual', sourceRefNo: 'MANUAL',
        remark: remark || `手动设定库存 ${quantity}`,
      }))
    }

    // 写库存变动日志
    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, supplier_id,
          quantity, before_qty, after_qty, unit_price,
          ref_type, ref_id, ref_no, remark, operator_id, operator_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        moveType,
        moveType === MOVE_TYPE.MANUAL_OUT ? 2 : 1,
        productId, warehouseId, supplierId || null,
        Math.abs(after - before), before, after, unitPrice || null,
        'manual', null, 'MANUAL',
        remark || null, operator.userId, operator.realName,
      ]
    )

    await conn.commit()
    return { beforeQty: before, afterQty: after }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

// ─── 库存总览（含分类路径、汇总统计、分页） ───────────────────────────────────

async function getOverview({ page=1, pageSize=20, keyword='', warehouseId=null, categoryId=null }) {
  // 1. 加载所有分类，用于路径重建和后代展开
  const [catRows] = await pool.query(
    'SELECT id, name, parent_id, path FROM product_categories',
  )
  const catMap = Object.fromEntries(catRows.map(c => [c.id, c]))

  function buildCatPath(catId) {
    if (!catId || !catMap[catId]) return ''
    const parts = []
    let cur = catMap[catId]
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parent_id ? catMap[cur.parent_id] : null
    }
    return parts.join(' > ')
  }

  // 2. 展开 categoryId → 包含所有后代
  let catIds = null
  if (categoryId) {
    const ids = [categoryId]
    catRows.forEach(c => {
      if (c.path) {
        const ancestors = c.path.split('/').filter(Boolean).map(Number)
        if (ancestors.includes(Number(categoryId))) ids.push(c.id)
      }
    })
    catIds = [...new Set(ids)]
  }

  // 3. 构建 WHERE 条件
  const conditions = ['p.deleted_at IS NULL']
  const baseParams = []
  if (keyword) {
    conditions.push('(p.code LIKE ? OR p.name LIKE ?)')
    baseParams.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (warehouseId) {
    conditions.push('s.warehouse_id = ?')
    baseParams.push(warehouseId)
  }
  if (catIds) {
    conditions.push(`p.category_id IN (${catIds.map(() => '?').join(',')})`)
    baseParams.push(...catIds)
  }
  const where = conditions.join(' AND ')

  // 4. 汇总统计（基于当前筛选条件，含仓库过滤）
  const [[statsRow]] = await pool.query(
    `SELECT
       COUNT(*)                          AS total_skus,
       COALESCE(SUM(s.quantity), 0)      AS total_on_hand,
       COALESCE(SUM(s.reserved), 0)      AS total_reserved
     FROM inventory_stock s
     JOIN product_items p ON s.product_id = p.id
     JOIN inventory_warehouses w ON s.warehouse_id = w.id AND w.deleted_at IS NULL
     WHERE ${where}`,
    baseParams,
  )

  // 5. 分页列表
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT
       s.id, s.quantity, COALESCE(s.reserved, 0) AS reserved,
       NULL AS updated_at,
       p.id AS product_id, p.code AS product_code, p.name AS product_name,
       p.unit, p.category_id,
       w.id AS warehouse_id, w.name AS warehouse_name
     FROM inventory_stock s
     JOIN product_items p ON s.product_id = p.id
     JOIN inventory_warehouses w ON s.warehouse_id = w.id AND w.deleted_at IS NULL
     WHERE ${where}
     ORDER BY p.name ASC, w.name ASC
     LIMIT ? OFFSET ?`,
    [...baseParams, pageSize, offset],
  )

  // 6. 总条数
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory_stock s
     JOIN product_items p ON s.product_id = p.id
     JOIN inventory_warehouses w ON s.warehouse_id = w.id AND w.deleted_at IS NULL
     WHERE ${where}`,
    baseParams,
  )

  const totalOnHand   = Number(statsRow.total_on_hand)
  const totalReserved = Number(statsRow.total_reserved)

  return {
    stats: {
      totalSkus:      Number(statsRow.total_skus),
      totalOnHand,
      totalReserved,
      totalAvailable: Math.max(0, totalOnHand - totalReserved),
    },
    list: rows.map(r => {
      const onHand   = Number(r.quantity)
      const reserved = Number(r.reserved)
      return {
        id:           r.id,
        productId:    r.product_id,
        productCode:  r.product_code,
        productName:  r.product_name,
        unit:         r.unit,
        categoryId:   r.category_id || null,
        categoryPath: buildCatPath(r.category_id),
        warehouseId:  r.warehouse_id,
        warehouseName: r.warehouse_name,
        onHand,
        reserved,
        available:    Math.max(0, onHand - reserved),
        updatedAt:    r.updated_at,
      }
    }),
    pagination: { page, pageSize, total },
  }
}

// ─── 容器列表（只读，仅返回 ACTIVE 容器）────────────────────────────────────

async function getContainers({ productId, warehouseId }) {
  const conditions = [
    'c.product_id = ?',
    'c.status = 1',            // ACTIVE only
    'c.deleted_at IS NULL',
  ]
  const params = [productId]

  if (warehouseId) {
    conditions.push('c.warehouse_id = ?')
    params.push(warehouseId)
  }

  const [rows] = await pool.query(
    `SELECT
       c.id, c.barcode, c.batch_no,
       c.initial_qty, c.remaining_qty,
       c.source_ref_type, c.source_ref_no,
       c.mfg_date, c.exp_date, c.unit, c.remark,
       c.created_at,
       w.name AS warehouse_name,
       loc.code AS location_code
     FROM inventory_containers c
     JOIN inventory_warehouses w ON c.warehouse_id = w.id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.created_at ASC, c.id ASC`,
    params,
  )

  return rows.map(r => ({
    id:           r.id,
    barcode:      r.barcode,
    batchNo:      r.batch_no      || null,
    initialQty:   Number(r.initial_qty),
    remainingQty: Number(r.remaining_qty),
    sourceRefType: r.source_ref_type || null,
    sourceRefNo:  r.source_ref_no  || null,
    mfgDate:      r.mfg_date       || null,
    expDate:      r.exp_date       || null,
    unit:         r.unit           || null,
    remark:       r.remark         || null,
    warehouseName: r.warehouse_name,
    locationCode: r.location_code  || null,
    createdAt:    r.created_at,
  }))
}

async function getContainerByBarcode(barcode) {
  const [[row]] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.location_id,
            c.remaining_qty, c.unit,
            p.code AS product_code, p.name AS product_name,
            w.name AS warehouse_name,
            loc.code AS location_code
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.barcode = ? AND c.status = 1`,
    [barcode],
  )
  if (!row) throw new AppError('容器不存在或已失效', 404)
  return {
    containerId:   row.id,
    barcode:       row.barcode,
    productId:     row.product_id,
    productCode:   row.product_code,
    productName:   row.product_name,
    warehouseId:   row.warehouse_id,
    warehouseName: row.warehouse_name,
    locationId:    row.location_id  || null,
    locationCode:  row.location_code || null,
    remainingQty:  Number(row.remaining_qty),
    unit:          row.unit,
  }
}

/**
 * 上架操作：将容器绑定到指定库位
 * 仅更新 location_id，不触发库存数量变动
 *
 * @param {number} containerId
 * @param {number} locationId
 * @returns {{ containerId, barcode, locationCode }}
 */
async function assignContainerLocation(containerId, locationId) {
  // 校验容器存在且状态有效（status=1 ACTIVE）
  const [[container]] = await pool.query(
    'SELECT id, barcode, status FROM inventory_containers WHERE id=? AND deleted_at IS NULL',
    [containerId],
  )
  if (!container) throw new AppError('容器不存在', 404)
  if (container.status !== 1) throw new AppError('容器已清空或作废，无法上架', 400)

  // 校验库位存在
  const [[location]] = await pool.query(
    'SELECT id, code FROM warehouse_locations WHERE id=? AND deleted_at IS NULL',
    [locationId],
  )
  if (!location) throw new AppError('库位不存在', 404)

  await pool.query(
    'UPDATE inventory_containers SET location_id=? WHERE id=?',
    [locationId, containerId],
  )

  return {
    containerId: container.id,
    barcode:     container.barcode,
    locationCode: location.code,
  }
}

module.exports = { getStock, getLogs, changeStock, getOverview, getContainers, getContainerByBarcode, assignContainerLocation }
