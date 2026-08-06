const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock, SOURCE_TYPE, splitContainer } = require('../../engine/containerEngine')
const { getInventoryDisplayProjectionSql } = require('./inventoryProjection')

// ─── 库存查询 ─────────────────────────────────────────────────────────────────

/**
 * 展示型库存列表：
 * - quantity 基于容器事实层汇总
 * - reserved 读取 inventory_stock 的 projection 字段
 * - 不应用于关键业务判定
 */
async function getStockSnapshotForDisplay({ page=1, pageSize=20, keyword='', warehouseId=null, scopeWarehouseIds=null }) {
  const offset = (page-1)*pageSize
  const like = `%${keyword}%`
  const scope = scopeFilter(scopeWarehouseIds, 'dims.warehouse_id')
  const whFilter = (warehouseId ? 'AND dims.warehouse_id=?' : '') + scope.sql
  const params = warehouseId
    ? [like, like, warehouseId, ...scope.params, pageSize, offset]
    : [like, like, ...scope.params, pageSize, offset]

  const [rows] = await pool.query(
    `SELECT COALESCE(s.id, -((dims.product_id * 1000000) + dims.warehouse_id)) AS id,
            COALESCE(c.quantity, 0) AS quantity, COALESCE(s.reserved, 0) AS reserved,
            p.id AS product_id, p.code AS product_code, p.name AS product_name, p.unit,
            w.id AS warehouse_id, w.name AS warehouse_name
     FROM (
       SELECT product_id, warehouse_id FROM inventory_stock
       UNION
       SELECT product_id, warehouse_id
       FROM inventory_containers
       WHERE status = 1 AND deleted_at IS NULL
     ) dims
     LEFT JOIN (
       SELECT product_id, warehouse_id, SUM(remaining_qty) AS quantity
       FROM inventory_containers
       WHERE status = 1 AND deleted_at IS NULL
       GROUP BY product_id, warehouse_id
     ) c ON c.product_id = dims.product_id AND c.warehouse_id = dims.warehouse_id
     LEFT JOIN inventory_stock s ON s.product_id = dims.product_id AND s.warehouse_id = dims.warehouse_id
     JOIN product_items p ON dims.product_id=p.id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON dims.warehouse_id=w.id AND w.deleted_at IS NULL
     WHERE (p.code LIKE ? OR p.name LIKE ?) ${whFilter}
       AND (COALESCE(c.quantity, 0) > 0 OR COALESCE(s.reserved, 0) > 0)
     ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    params,
  )

  const cntParams = warehouseId ? [like, like, warehouseId, ...scope.params] : [like, like, ...scope.params]
  const [[{total}]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM (
       SELECT product_id, warehouse_id FROM inventory_stock
       UNION
       SELECT product_id, warehouse_id
       FROM inventory_containers
       WHERE status = 1 AND deleted_at IS NULL
     ) dims
     JOIN product_items p ON dims.product_id=p.id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON dims.warehouse_id=w.id AND w.deleted_at IS NULL
     LEFT JOIN (
       SELECT product_id, warehouse_id, SUM(remaining_qty) AS quantity
       FROM inventory_containers
       WHERE status = 1 AND deleted_at IS NULL
       GROUP BY product_id, warehouse_id
     ) c ON c.product_id = dims.product_id AND c.warehouse_id = dims.warehouse_id
     LEFT JOIN inventory_stock s ON s.product_id = dims.product_id AND s.warehouse_id = dims.warehouse_id
     WHERE (p.code LIKE ? OR p.name LIKE ?) ${whFilter}
       AND (COALESCE(c.quantity, 0) > 0 OR COALESCE(s.reserved, 0) > 0)`,
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

async function getStock(params) {
  return getStockSnapshotForDisplay(params)
}

/**
 * 指定产品在所有启用仓库的可用库存（含库存量为 0 的仓库，CROSS JOIN 保证组合齐全）。
 * 用于「占用库存」分仓选择弹窗——按产品展示各仓可用量供用户挑选，非关键业务判定。
 */
async function getAvailabilityByProducts({ productIds, scopeWarehouseIds = null }) {
  if (!productIds?.length) return []
  const scope = scopeFilter(scopeWarehouseIds, 'w.id')
  const [rows] = await pool.query(
    `SELECT p.id AS product_id, w.id AS warehouse_id, w.name AS warehouse_name,
            COALESCE(c.quantity, 0) AS quantity, COALESCE(s.reserved, 0) AS reserved
     FROM product_items p
     CROSS JOIN inventory_warehouses w
     LEFT JOIN (
       SELECT product_id, warehouse_id, SUM(remaining_qty) AS quantity
       FROM inventory_containers
       WHERE status = 1 AND deleted_at IS NULL
       GROUP BY product_id, warehouse_id
     ) c ON c.product_id = p.id AND c.warehouse_id = w.id
     LEFT JOIN inventory_stock s ON s.product_id = p.id AND s.warehouse_id = w.id
     WHERE p.id IN (?) AND w.deleted_at IS NULL ${scope.sql}`,
    [productIds, ...scope.params],
  )
  return rows.map(r => ({
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    available: Math.max(0, Number(r.quantity) - Number(r.reserved)),
  }))
}

// ─── 流水记录 ─────────────────────────────────────────────────────────────────

async function getLogs({ page=1, pageSize=20, type=null, productId=null, warehouseId=null, scopeWarehouseIds=null }) {
  const offset = (page-1)*pageSize
  const conditions = ['1=1']
  const params = []
  if (type) { conditions.push('l.type=?'); params.push(type) }
  if (productId) { conditions.push('l.product_id=?'); params.push(productId) }
  if (warehouseId) { conditions.push('l.warehouse_id=?'); params.push(warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'l.warehouse_id')
  const where = conditions.join(' AND ') + scope.sql

  const [rows] = await pool.query(
    `SELECT l.*, p.code AS product_code, p.name AS product_name, p.unit,
            w.name AS warehouse_name, s.name AS supplier_name
     FROM inventory_logs l
     JOIN product_items p ON l.product_id=p.id
     JOIN inventory_warehouses w ON l.warehouse_id=w.id
     LEFT JOIN supply_suppliers s ON l.supplier_id=s.id
     WHERE ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    [...params, ...scope.params, pageSize, offset],
  )

  const [[{total}]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory_logs l WHERE ${where}`, [...params, ...scope.params],
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
      containerId: r.container_id ?? null,
      logSourceType: r.log_source_type ?? null,
      logSourceRefId: r.log_source_ref_id != null ? Number(r.log_source_ref_id) : null,
      createdAt: r.created_at,
    })),
    pagination: { page, pageSize, total },
  }
}

// ─── 入库 / 出库 / 调整 ───────────────────────────────────────────────────────
//
// type=1 手动入库  → 已关闭（须走入库任务 → 收货容器 → 上架）
// type=2 手动出库  → adjustContainerStock(-qty)，来源 manual + 操作人 ID
// type=3 库存调整  → 已关闭（须走盘点单，容器来源 stockcheck）
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

    if (type === 1) {
      throw new AppError('手动入库已关闭：请通过「入库任务」收货生成容器并上架后计入库存', 403)
    }

    if (type === 3) {
      throw new AppError('库存调整已关闭：请创建并提交「盘点单」，差异将通过容器来源 stockcheck 落账', 403)
    }

    if (type !== 2) {
      throw new AppError('不支持的库存操作类型', 400)
    }

    // 手动出库：FIFO 扣减容器（不足则抛出）
    const moveType = MOVE_TYPE.MANUAL_OUT
    const { before, after, primaryDeductContainerId } = await adjustContainerStock(conn, {
      productId, productName: product.name, warehouseId,
      qty: -quantity, unit: product.unit,
      sourceType: SOURCE_TYPE.MANUAL,
      sourceRefId: operator.userId,
      sourceRefType: 'manual',
      sourceRefNo: `OP${operator.userId}`,
      remark: remark || '手动出库',
    })

    // 写库存变动日志
    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, supplier_id,
          quantity, before_qty, after_qty, unit_price,
          ref_type, ref_id, ref_no,
          container_id, log_source_type, log_source_ref_id,
          remark, operator_id, operator_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        moveType, 2,
        productId, warehouseId, supplierId || null,
        quantity, before, after, unitPrice || null,
        'manual', operator.userId, `OP${operator.userId}`,
        primaryDeductContainerId, SOURCE_TYPE.MANUAL, operator.userId,
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

async function getOverview({ page=1, pageSize=20, keyword='', warehouseId=null, categoryId=null, scopeWarehouseIds=null }) {
  const inventoryDisplayProjectionSql = getInventoryDisplayProjectionSql()
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
    conditions.push('ip.warehouse_id = ?')
    baseParams.push(warehouseId)
  }
  if (catIds) {
    conditions.push(`p.category_id IN (${catIds.map(() => '?').join(',')})`)
    baseParams.push(...catIds)
  }
  const scope = scopeFilter(scopeWarehouseIds, 'ip.warehouse_id')
  const where = conditions.join(' AND ') + scope.sql
  baseParams.push(...scope.params)

  // 4. 汇总统计（基于当前筛选条件，含仓库过滤）
  const [[statsRow]] = await pool.query(
    `SELECT
       COUNT(DISTINCT ip.product_id)     AS total_skus,
       COALESCE(SUM(ip.quantity), 0)     AS total_on_hand,
       COALESCE(SUM(ip.reserved), 0)     AS total_reserved
     FROM ${inventoryDisplayProjectionSql} ip
     JOIN product_items p ON ip.product_id = p.id
     JOIN inventory_warehouses w ON ip.warehouse_id = w.id AND w.deleted_at IS NULL
     WHERE ${where}`,
    baseParams,
  )

  // 5. 分页列表
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT
       -((ip.product_id * 1000000) + ip.warehouse_id) AS id,
       ip.quantity, ip.reserved,
       NULL AS updated_at,
       p.id AS product_id, p.code AS product_code, p.name AS product_name,
       p.unit, p.category_id,
       w.id AS warehouse_id, w.name AS warehouse_name
     FROM ${inventoryDisplayProjectionSql} ip
     JOIN product_items p ON ip.product_id = p.id
     JOIN inventory_warehouses w ON ip.warehouse_id = w.id AND w.deleted_at IS NULL
     WHERE ${where}
     ORDER BY p.name ASC, w.name ASC
     LIMIT ? OFFSET ?`,
    [...baseParams, pageSize, offset],
  )

  // 6. 总条数
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${inventoryDisplayProjectionSql} ip
     JOIN product_items p ON ip.product_id = p.id
     JOIN inventory_warehouses w ON ip.warehouse_id = w.id AND w.deleted_at IS NULL
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

async function getContainers({ productId, warehouseId, includeLegacy = false }) {
  const conditions = [
    'c.product_id = ?',
    'c.status = 1',            // ACTIVE only
    'c.deleted_at IS NULL',
  ]
  const params = [productId]

  if (!includeLegacy) {
    conditions.push('(c.is_legacy = 0 OR c.is_legacy IS NULL)')
  }

  if (warehouseId) {
    conditions.push('c.warehouse_id = ?')
    params.push(warehouseId)
  }

  const [rows] = await pool.query(
    `SELECT
       c.id, c.barcode, c.batch_no,
       c.initial_qty, c.remaining_qty,
       c.source_type, c.source_ref_id,
       c.source_ref_type, c.source_ref_no,
       c.is_legacy,
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
    sourceType:   r.source_type || null,
    sourceRefId:  r.source_ref_id != null ? Number(r.source_ref_id) : null,
    sourceRefType: r.source_ref_type || null,
    sourceRefNo:  r.source_ref_no  || null,
    isLegacy:     !!Number(r.is_legacy),
    mfgDate:      r.mfg_date       || null,
    expDate:      r.exp_date       || null,
    unit:         r.unit           || null,
    remark:       r.remark         || null,
    warehouseName: r.warehouse_name,
    locationCode: r.location_code  || null,
    createdAt:    r.created_at,
  }))
}

/**
 * 根据容器来源解析关联单据（只读）
 */
async function resolveSourceDocument(sourceType, sourceRefId) {
  const rid = Number(sourceRefId)
  if (!Number.isFinite(rid) || rid <= 0) return null

  try {
    if (sourceType === 'inbound_task') {
      const [[row]] = await pool.query(
        'SELECT id, task_no, status, purchase_order_no, warehouse_name FROM inbound_tasks WHERE id=? AND deleted_at IS NULL',
        [rid],
      )
      return row ? { kind: 'inbound_task', id: row.id, no: row.task_no, status: row.status, purchaseOrderNo: row.purchase_order_no, warehouseName: row.warehouse_name } : null
    }
    if (sourceType === 'stockcheck') {
      const [[row]] = await pool.query(
        'SELECT id, check_no, status, warehouse_name FROM inventory_checks WHERE id=? AND deleted_at IS NULL',
        [rid],
      )
      return row ? { kind: 'stockcheck', id: row.id, no: row.check_no, status: row.status, warehouseName: row.warehouse_name } : null
    }
    if (sourceType === 'transfer') {
      const [[row]] = await pool.query(
        'SELECT id, order_no, status, from_warehouse_name, to_warehouse_name FROM transfer_orders WHERE id=? AND deleted_at IS NULL',
        [rid],
      )
      return row ? { kind: 'transfer', id: row.id, no: row.order_no, status: row.status, fromWarehouseName: row.from_warehouse_name, toWarehouseName: row.to_warehouse_name } : null
    }
    if (sourceType === 'import') {
      const [[row]] = await pool.query(
        'SELECT id, file_name, row_count, created_at FROM inventory_import_batches WHERE id=?',
        [rid],
      )
      return row ? { kind: 'import', id: row.id, fileName: row.file_name, rowCount: row.row_count, createdAt: row.created_at } : null
    }
    if (sourceType === 'return') {
      const [[sr]] = await pool.query('SELECT id, return_no, status FROM sale_returns WHERE id=? AND deleted_at IS NULL', [rid])
      if (sr) return { kind: 'sale_return', id: sr.id, no: sr.return_no, status: sr.status }
      const [[pr]] = await pool.query('SELECT id, return_no, status FROM purchase_returns WHERE id=? AND deleted_at IS NULL', [rid])
      if (pr) return { kind: 'purchase_return', id: pr.id, no: pr.return_no, status: pr.status }
      return null
    }
    if (sourceType === 'manual') {
      const [[u]] = await pool.query('SELECT id, username, real_name FROM sys_users WHERE id=?', [rid])
      return u ? { kind: 'manual', operatorUserId: u.id, username: u.username, realName: u.real_name } : null
    }
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null
    throw e
  }
  return null
}

/**
 * 批量解析容器来源文档（避免 N+1 查询）
 */
async function resolveSourceDocumentsBatch(items) {
  const result = new Map()
  if (!items.length) return result

  // 按 sourceType 分组收集 ID
  const byType = new Map()
  for (const { sourceType, sourceRefId } of items) {
    const rid = Number(sourceRefId)
    if (!Number.isFinite(rid) || rid <= 0 || !sourceType) continue
    if (!byType.has(sourceType)) byType.set(sourceType, new Set())
    byType.get(sourceType).add(rid)
  }

  const queries = {
    inbound_task: 'SELECT id, task_no, status, purchase_order_no, warehouse_name FROM inbound_tasks WHERE id IN (?) AND deleted_at IS NULL',
    stockcheck: 'SELECT id, check_no, status, warehouse_name FROM inventory_checks WHERE id IN (?) AND deleted_at IS NULL',
    transfer: 'SELECT id, order_no, status, from_warehouse_name, to_warehouse_name FROM transfer_orders WHERE id IN (?) AND deleted_at IS NULL',
    import: 'SELECT id, file_name, row_count, created_at FROM inventory_import_batches WHERE id IN (?)',
    manual: 'SELECT id, username, real_name FROM sys_users WHERE id IN (?)',
  }

  const rowMappers = {
    inbound_task: r => ({ kind: 'inbound_task', id: r.id, no: r.task_no, status: r.status, purchaseOrderNo: r.purchase_order_no, warehouseName: r.warehouse_name }),
    stockcheck: r => ({ kind: 'stockcheck', id: r.id, no: r.check_no, status: r.status, warehouseName: r.warehouse_name }),
    transfer: r => ({ kind: 'transfer', id: r.id, no: r.order_no, status: r.status, fromWarehouseName: r.from_warehouse_name, toWarehouseName: r.to_warehouse_name }),
    import: r => ({ kind: 'import', id: r.id, fileName: r.file_name, rowCount: r.row_count, createdAt: r.created_at }),
    manual: r => ({ kind: 'manual', operatorUserId: r.id, username: r.username, realName: r.real_name }),
  }

  for (const [sourceType, ids] of byType) {
    const sql = queries[sourceType]
    if (!sql) continue
    try {
      const idList = [...ids]
      const [rows] = await pool.query(sql, [idList])
      for (const r of rows) {
        const key = `${sourceType}:${r.id}`
        result.set(key, rowMappers[sourceType](r))
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
  }

  // 处理 return 类型（需要同时查两张表）
  if (byType.has('return')) {
    const idList = [...byType.get('return')]
    try {
      const [srRows] = await pool.query('SELECT id, return_no, status FROM sale_returns WHERE id IN (?) AND deleted_at IS NULL', [idList])
      for (const r of srRows) {
        result.set(`return:${r.id}`, { kind: 'sale_return', id: r.id, no: r.return_no, status: r.status })
      }
      const remaining = idList.filter(id => !result.has(`return:${id}`))
      if (remaining.length) {
        const [prRows] = await pool.query('SELECT id, return_no, status FROM purchase_returns WHERE id IN (?) AND deleted_at IS NULL', [remaining])
        for (const r of prRows) {
          result.set(`return:${r.id}`, { kind: 'purchase_return', id: r.id, no: r.return_no, status: r.status })
        }
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e
    }
  }

  return result
}

/**
 * 按商品聚合在库容器及来源（status=1），支持按容器/来源/单据过滤；默认排除 is_legacy
 */
async function traceByProductId(productId, {
  containerId = null,
  sourceType = null,
  sourceRefId = null,
  includeLegacy = false,
} = {}) {
  const [[p]] = await pool.query(
    'SELECT id, code, name, unit FROM product_items WHERE id=? AND deleted_at IS NULL',
    [productId],
  )
  if (!p) throw new AppError('商品不存在', 404)

  const conditions = [
    'c.product_id = ?',
    'c.status = 1',
    'c.deleted_at IS NULL',
  ]
  const params = [productId]

  if (!includeLegacy) {
    conditions.push('(c.is_legacy = 0 OR c.is_legacy IS NULL)')
  }
  if (containerId) {
    conditions.push('c.id = ?')
    params.push(containerId)
  }
  if (sourceType) {
    conditions.push('c.source_type = ?')
    params.push(sourceType)
  }
  if (sourceRefId != null && sourceRefId !== '') {
    conditions.push('c.source_ref_id = ?')
    params.push(Number(sourceRefId))
  }

  const [rows] = await pool.query(
    `SELECT c.id AS containerId, c.barcode, c.source_type AS sourceType, c.source_ref_id AS sourceRefId,
            c.source_ref_no AS sourceRefNo, c.source_ref_type AS sourceRefType,
            c.warehouse_id AS warehouseId, w.name AS warehouseName,
            c.remaining_qty AS remainingQty, c.batch_no AS batchNo, c.created_at AS createdAt,
            c.is_legacy AS isLegacy
     FROM inventory_containers c
     INNER JOIN inventory_warehouses w ON w.id = c.warehouse_id AND w.deleted_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.warehouse_id ASC, c.created_at ASC, c.id ASC`,
    params,
  )

  const summaryMap = new Map()
  for (const r of rows) {
    const k = `${r.sourceType || 'unknown'}:${r.sourceRefId ?? 'null'}`
    const prev = summaryMap.get(k) || {
      sourceType: r.sourceType,
      sourceRefId: r.sourceRefId,
      sourceRefNo: r.sourceRefNo,
      totalQty: 0,
      containerCount: 0,
    }
    prev.totalQty += Number(r.remainingQty)
    prev.containerCount += 1
    summaryMap.set(k, prev)
  }

  const chains = []
  // 按来源类型分组，批量解析文档（避免 N+1）
  const grouped = new Map()
  for (const r of rows) {
    const st = r.sourceType || 'unknown'
    const sri = r.sourceRefId ?? 'null'
    if (!r.sourceRefId || !Number.isFinite(Number(r.sourceRefId))) continue
    const key = `${st}:${sri}`
    if (!grouped.has(key)) grouped.set(key, { sourceType: st, sourceRefId: sri })
  }
  const docMap = await resolveSourceDocumentsBatch([...grouped.values()])

  for (const r of rows) {
    const key = `${r.sourceType || 'unknown'}:${r.sourceRefId ?? 'null'}`
    const doc = docMap.get(key) || null
    chains.push({
      container: {
        containerId: r.containerId,
        barcode: r.barcode,
        remainingQty: Number(r.remainingQty),
        batchNo: r.batchNo,
        createdAt: r.createdAt,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName,
        isLegacy: !!Number(r.isLegacy),
      },
      source: {
        sourceType: r.sourceType,
        sourceRefId: r.sourceRefId != null ? Number(r.sourceRefId) : null,
        sourceRefNo: r.sourceRefNo,
        sourceRefType: r.sourceRefType,
      },
      document: doc,
    })
  }

  return {
    productId: p.id,
    productCode: p.code,
    productName: p.name,
    unit: p.unit,
    filters: { containerId, sourceType, sourceRefId, includeLegacy },
    summary: [...summaryMap.values()],
    chains,
    containers: rows.map(r => ({
      containerId: r.containerId,
      barcode: r.barcode,
      sourceType: r.sourceType,
      sourceRefId: r.sourceRefId != null ? Number(r.sourceRefId) : null,
      sourceRefNo: r.sourceRefNo,
      sourceRefType: r.sourceRefType,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      remainingQty: Number(r.remainingQty),
      batchNo: r.batchNo,
      createdAt: r.createdAt,
      isLegacy: !!Number(r.isLegacy),
    })),
  }
}

/** 校验容器汇总（ACTIVE）与 inventory_stock.quantity 是否一致 */
async function checkStockConsistency({ productId = null, warehouseId = null, limit = 500 } = {}) {
  const condC = ['c.status = 1', 'c.deleted_at IS NULL']
  const paramsC = []
  if (productId) { condC.push('c.product_id = ?'); paramsC.push(productId) }
  if (warehouseId) { condC.push('c.warehouse_id = ?'); paramsC.push(warehouseId) }

  // 单次 LEFT JOIN 查询，避免 N+1
  const [rows] = await pool.query(
    `SELECT c.product_id AS productId, c.warehouse_id AS warehouseId,
            SUM(c.remaining_qty) AS containerQty,
            COALESCE(s.quantity, 0) AS stockQty
     FROM inventory_containers c
     LEFT JOIN inventory_stock s ON s.product_id = c.product_id AND s.warehouse_id = c.warehouse_id
     WHERE ${condC.join(' AND ')}
     GROUP BY c.product_id, c.warehouse_id
     LIMIT ?`,
    [...paramsC, limit],
  )

  const mismatches = []
  for (const row of rows) {
    const cQty = Number(row.containerQty)
    const sQty = Number(row.stockQty)
    const diff = sQty - cQty
    if (Math.abs(diff) > 0.0001) {
      mismatches.push({ productId: row.productId, warehouseId: row.warehouseId, containerQty: cQty, stockQty: sQty, diff })
    }
  }

  const condS = ['s.quantity > 0.0001']
  const paramsS = []
  if (productId) { condS.push('s.product_id = ?'); paramsS.push(productId) }
  if (warehouseId) { condS.push('s.warehouse_id = ?'); paramsS.push(warehouseId) }

  const [stockOnly] = await pool.query(
    `SELECT s.product_id AS productId, s.warehouse_id AS warehouseId, s.quantity AS stockQty
     FROM inventory_stock s
     LEFT JOIN (
       SELECT product_id, warehouse_id, SUM(remaining_qty) AS sq
       FROM inventory_containers
       WHERE status = 1 AND deleted_at IS NULL
       GROUP BY product_id, warehouse_id
     ) x ON x.product_id = s.product_id AND x.warehouse_id = s.warehouse_id
     WHERE ${condS.join(' AND ')}
       AND (x.sq IS NULL OR x.sq = 0)`,
    paramsS,
  )

  for (const row of stockOnly) {
    const cQty = 0
    const sQty = Number(row.stockQty)
    mismatches.push({
      productId: row.productId,
      warehouseId: row.warehouseId,
      containerQty: cQty,
      stockQty: sQty,
      diff: sQty - cQty,
      note: '库存表有量但无在库容器汇总',
    })
  }

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  const total = mismatches.length
  const list = mismatches.slice(0, Math.min(Math.max(1, limit), 2000))

  return {
    ok: total === 0,
    mismatchCount: total,
    checkedHint: '按 SKU+仓库 比对 ACTIVE 容器 remaining_qty 合计与 inventory_stock.quantity',
    mismatches: list,
  }
}

async function getContainerByBarcode(barcode) {
  const [[row]] = await pool.query(
    `SELECT c.id, c.barcode, c.container_type, c.product_id, c.warehouse_id, c.location_id,
            c.remaining_qty, c.unit, c.status, c.inbound_task_id,
            c.source_type, c.source_ref_id, c.is_legacy,
            c.locked_by_task_id,
            p.code AS product_code, p.name AS product_name, p.serial_managed,
            w.name AS warehouse_name,
            loc.code AS location_code,
            lt.task_no AS locked_task_no
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     LEFT JOIN warehouse_tasks lt ON lt.id = c.locked_by_task_id
     WHERE c.barcode = ? AND c.deleted_at IS NULL AND c.status IN (1, 4)`,
    [barcode],
  )
  if (!row) throw new AppError('容器不存在或已失效', 404)
  // 序列号商品（文档04 Phase3b）：带出该容器在库序列号，供 PDA 拆分逐台扫码指定「要拆出的具体台」
  const serialManaged = Number(row.serial_managed) === 1
  let serials = null
  if (serialManaged) {
    const [srows] = await pool.query(
      'SELECT serial_no FROM product_serials WHERE container_id = ? AND status = 1 ORDER BY id',
      [row.id],
    )
    serials = srows.map(r => r.serial_no)
  }
  return {
    serialManaged,
    serials,
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
    containerKind: Number(row.container_type) === 2 || /^B/i.test(String(row.barcode || '')) ? 'plastic_box' : 'inventory',
    containerStatus: Number(row.status) === 4 ? 'waiting_putaway' : 'stored',
    // 拣货锁定信息：供 PDA 拆分页在「扫码那一刻」就拦下已锁定容器（拆分须在拣货前完成，
    // 走到提交才被 splitContainer 409 拒绝已经太晚——拣货扫码没有撤销路径）。
    lockedByTaskId: row.locked_by_task_id != null ? Number(row.locked_by_task_id) : null,
    lockedByTaskNo: row.locked_task_no || null,
    inboundTaskId: row.inbound_task_id || null,
    sourceType:    row.source_type || null,
    sourceRefId:   row.source_ref_id != null ? Number(row.source_ref_id) : null,
    isLegacy:      !!Number(row.is_legacy),
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
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 校验容器存在且状态有效（status=1 ACTIVE）
    const [[container]] = await conn.query(
      'SELECT id, barcode, status FROM inventory_containers WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [containerId],
    )
    if (!container) throw new AppError('容器不存在', 404)
    if (Number(container.status) === 4) {
      throw new AppError('待上架容器请使用「入库任务」上架接口绑定库位', 400)
    }
    if (Number(container.status) !== 1) throw new AppError('容器已清空或作废，无法移动库位', 400)

    // 校验库位存在
    const [[location]] = await conn.query(
      'SELECT id, code FROM warehouse_locations WHERE id=? AND deleted_at IS NULL',
      [locationId],
    )
    if (!location) throw new AppError('库位不存在', 404)

    await conn.query(
      'UPDATE inventory_containers SET location_id=? WHERE id=?',
      [locationId, containerId],
    )

    await conn.commit()

    return {
      containerId: container.id,
      barcode:     container.barcode,
      locationCode: location.code,
    }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 同仓容器拆分（散件）：单容器扣减并生成新塑料盒条码（B），可选打印新标签
 */
async function splitContainerOp(containerId, { qty, remark, printLabel, targetContainerId, serialNos = null, userId, userName = null }) {
  const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')
  const conn = await pool.getConnection()
  let result
  try {
    await conn.beginTransaction()
    result = await splitContainer(conn, {
      containerId, qty, remark, targetContainerId, serialNos,
      operatorId: userId ?? null, operatorName: userName,
    })
    result.printJobId = null
    result.printJobIds = []

    if (printLabel && !targetContainerId) {
      const [[row]] = await conn.query(
        `SELECT c.barcode, c.remaining_qty, p.name AS product_name
         FROM inventory_containers c
         JOIN product_items p ON p.id = c.product_id
         WHERE c.id = ?`,
        [result.newContainerId],
      )
      if (!row) {
        throw new AppError('拆分后新容器不存在，无法创建标签打印任务', 500)
      }
      const job = await enqueueContainerLabelJob({
        conn,
        containerId: result.newContainerId,
        warehouseId: result.warehouseId,
        data: {
          container_code: row.barcode,
          product_name: row.product_name,
          qty: row.remaining_qty,
        },
        createdBy: userId ?? null,
        jobUniqueKey: `split_cnt_${result.newContainerId}`,
      })
      if (!job?.id) {
        throw new AppError(`容器 ${row.barcode} 的打印任务创建失败`, 500)
      }
      result.printJobId = Number(job.id)
      result.printJobIds.push(Number(job.id))
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  return result
}

// ─── 补货策略与补货建议（文档 01）──────────────────────────────────────────────
// 只读展示口径：走 inventory_stock 缓存投影（getInventoryDisplayProjectionSql），
// 不用于关键业务判定；补货基准按仓取 COALESCE(本仓行, warehouse_id=0 默认行, 0)。

/**
 * 补货建议列表：可用 = GREATEST(0, quantity - reserved)（已扣预占，不再 +reserved）；
 * 在途采购 = 已提交(status=2)采购单下单量 − 已上架量；只列「补货点>0 且 可用+在途 < 补货点」。
 * 数据权限走 scopeFilter(ip.warehouse_id)。
 */
async function getReplenishment({ page = 1, pageSize = 20, keyword = '', warehouseId = null, scopeWarehouseIds = null }) {
  const inventoryDisplayProjectionSql = getInventoryDisplayProjectionSql()

  // 在途采购子查询（按 仓库×商品）：每个 PO 行先 GREATEST(0, 下单−已上架) 再求和，
  // 避免超收(负值)跨单抵消；poi 先按 (order_id, product_id) 聚合、避免与 recv JOIN 时 fan-out 放大。
  const inTransitSql = `(
    SELECT warehouse_id, product_id, SUM(leg) AS in_transit FROM (
      SELECT po.warehouse_id, oi.product_id,
             GREATEST(0, oi.ordered - COALESCE(recv.putaway_qty, 0)) AS leg
      FROM purchase_orders po
      JOIN (SELECT order_id, product_id, SUM(quantity) AS ordered
            FROM purchase_order_items GROUP BY order_id, product_id) oi ON oi.order_id = po.id
      LEFT JOIN (SELECT iti.purchase_order_id, iti.product_id, SUM(iti.putaway_qty) AS putaway_qty
                 FROM inbound_task_items iti
                 JOIN inbound_tasks it ON it.id = iti.task_id AND it.deleted_at IS NULL
                 WHERE iti.purchase_order_id IS NOT NULL
                 GROUP BY iti.purchase_order_id, iti.product_id) recv
             ON recv.purchase_order_id = po.id AND recv.product_id = oi.product_id
      WHERE po.deleted_at IS NULL AND po.status = 2
    ) legs GROUP BY warehouse_id, product_id
  )`

  const availableExpr = 'GREATEST(0, ip.quantity - ip.reserved)'
  const inTransitExpr = 'COALESCE(pt.in_transit, 0)'
  const reorderExpr   = 'COALESCE(sp_wh.reorder_point, sp_def.reorder_point, 0)'
  const safetyExpr    = 'COALESCE(sp_wh.safety_stock, sp_def.safety_stock, 0)'
  const targetExpr    = 'COALESCE(sp_wh.target_stock, sp_def.target_stock, sp_wh.reorder_point, sp_def.reorder_point, 0)'

  const conditions = ['p.deleted_at IS NULL', 'p.is_active = 1']
  const baseParams = []
  if (keyword) { conditions.push('(p.code LIKE ? OR p.name LIKE ?)'); baseParams.push(`%${keyword}%`, `%${keyword}%`) }
  if (warehouseId) { conditions.push('ip.warehouse_id = ?'); baseParams.push(warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'ip.warehouse_id')
  // 只列需补货：补货点>0 且 可用+在途 < 补货点（表达式直接入 WHERE，避免依赖 ONLY_FULL_GROUP_BY 下的 HAVING）
  const filterCond = `${reorderExpr} > 0 AND (${availableExpr} + ${inTransitExpr}) < ${reorderExpr}`
  const where = conditions.join(' AND ') + scope.sql + ' AND ' + filterCond
  baseParams.push(...scope.params)

  const joins = `
    FROM ${inventoryDisplayProjectionSql} ip
    JOIN product_items p ON ip.product_id = p.id
    JOIN inventory_warehouses w ON ip.warehouse_id = w.id AND w.deleted_at IS NULL
    LEFT JOIN product_stock_policies sp_wh  ON sp_wh.product_id = ip.product_id AND sp_wh.warehouse_id = ip.warehouse_id
    LEFT JOIN product_stock_policies sp_def ON sp_def.product_id = ip.product_id AND sp_def.warehouse_id = 0
    LEFT JOIN ${inTransitSql} pt ON pt.warehouse_id = ip.warehouse_id AND pt.product_id = ip.product_id
    WHERE ${where}`

  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT p.id AS product_id, p.code AS product_code, p.name AS product_name, p.unit,
            w.id AS warehouse_id, w.name AS warehouse_name,
            ip.quantity, ip.reserved,
            ${availableExpr} AS available,
            ${inTransitExpr} AS in_transit,
            ${reorderExpr}   AS reorder_point,
            ${safetyExpr}    AS safety_stock,
            ${targetExpr}    AS target_stock,
            GREATEST(0, ${targetExpr} - ${availableExpr} - ${inTransitExpr}) AS suggest_qty
     ${joins}
     ORDER BY suggest_qty DESC, p.name ASC
     LIMIT ? OFFSET ?`,
    [...baseParams, pageSize, offset],
  )

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${joins}`, baseParams)

  return {
    list: rows.map(r => ({
      id: `${r.product_id}-${r.warehouse_id}`,
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      unit: r.unit,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      onHand: Number(r.quantity),
      reserved: Number(r.reserved),
      available: Number(r.available),
      inTransit: Number(r.in_transit),
      safetyStock: Number(r.safety_stock),
      reorderPoint: Number(r.reorder_point),
      targetStock: Number(r.target_stock),
      suggestQty: Number(r.suggest_qty),
    })),
    pagination: { page, pageSize, total },
  }
}

/** 读某商品的全部补货策略行（含 warehouse_id=0 通用默认），供策略维护界面用 */
async function getStockPolicies({ productId }) {
  const pid = Number(productId)
  if (!Number.isInteger(pid) || pid <= 0) throw new AppError('productId 无效', 400)
  const [rows] = await pool.query(
    `SELECT sp.product_id, sp.warehouse_id, sp.safety_stock, sp.reorder_point, sp.target_stock,
            w.name AS warehouse_name
     FROM product_stock_policies sp
     LEFT JOIN inventory_warehouses w ON w.id = sp.warehouse_id
     WHERE sp.product_id = ?
     ORDER BY sp.warehouse_id ASC`,
    [pid],
  )
  return rows.map(r => ({
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    warehouseName: Number(r.warehouse_id) === 0 ? '通用默认' : (r.warehouse_name || null),
    safetyStock: Number(r.safety_stock),
    reorderPoint: Number(r.reorder_point),
    targetStock: r.target_stock == null ? null : Number(r.target_stock),
  }))
}

/**
 * 批量 upsert 补货策略。items: [{ productId, warehouseId, safetyStock, reorderPoint, targetStock }]。
 * warehouseId=0 表示通用默认；全零且无目标视为清除该行（回落默认/无策略）。
 */
async function saveStockPolicies(items) {
  if (!Array.isArray(items) || !items.length) return { saved: 0, deleted: 0 }
  let saved = 0, deleted = 0
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const it of items) {
      const productId = Number(it.productId)
      const warehouseId = Number(it.warehouseId ?? 0)
      if (!Number.isInteger(productId) || productId <= 0) throw new AppError('productId 无效', 400)
      if (!Number.isInteger(warehouseId) || warehouseId < 0) throw new AppError('warehouseId 无效', 400)
      const safety = Number(it.safetyStock ?? 0)
      const reorder = Number(it.reorderPoint ?? 0)
      const target = it.targetStock == null || it.targetStock === '' ? null : Number(it.targetStock)
      if ([safety, reorder].some(v => !Number.isFinite(v) || v < 0) || (target != null && (!Number.isFinite(target) || target < 0))) {
        throw new AppError('安全库存/补货点/目标库存必须为非负数', 400)
      }
      if (safety === 0 && reorder === 0 && target == null) {
        const [r] = await conn.query('DELETE FROM product_stock_policies WHERE product_id=? AND warehouse_id=?', [productId, warehouseId])
        deleted += r.affectedRows
        continue
      }
      await conn.query(
        `INSERT INTO product_stock_policies (product_id, warehouse_id, safety_stock, reorder_point, target_stock)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE safety_stock=VALUES(safety_stock), reorder_point=VALUES(reorder_point), target_stock=VALUES(target_stock)`,
        [productId, warehouseId, safety, reorder, target],
      )
      saved += 1
    }
    await conn.commit()
    return { saved, deleted }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  getStock,
  getReplenishment,
  getStockPolicies,
  saveStockPolicies,
  getStockSnapshotForDisplay,
  getAvailabilityByProducts,
  getLogs,
  changeStock,
  getOverview,
  getContainers,
  traceByProductId,
  checkStockConsistency,
  resolveSourceDocument,
  resolveSourceDocumentsBatch,
  getContainerByBarcode,
  assignContainerLocation,
  splitContainerOp,
}
