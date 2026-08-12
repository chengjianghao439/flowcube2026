/**
 * 呆滞库存处置单（P2-9）：建议 → 审批 → 处置。
 *
 * 状态机（documentStatusRules.inventoryDisposal）：1草稿 → 2待审批 → 3已批准 → 4已处置 / 5已驳回 / 6已取消。
 * 处置方式：1降价促销 2退货供应商 3报废。
 *
 * 建议来源：呆滞判定沿用 inventory.aging 的口径（某商品×某仓仍有在库，且最后一次出库距今 > staleDays，
 * 默认 90 天）。只读建议不做决策，由运营圈选生成处置单。
 *
 * 执行处置的库存语义（唯一库存事实源 = inventory_containers）：
 *   - 降价促销 / 退货供应商 / 报废 三者的共同点是商品从账面移除 → 走 adjustContainerStock(qty<0)
 *     FIFO 扣减容器 + syncStockFromContainers 刷新缓存，来源 disposal；
 *   - 报废是资产灭失，除扣库存外另落 disposal_scrapped 台账留痕（跨模块仍以容器与流水为账，台账只作审计）；
 *   - 处置一律走 ERP 端（决策权在运营，不在仓库现场），不建仓库任务、不走 PDA。
 */

const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock, SOURCE_TYPE, lockStockDimension } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { normalizePagination } = require('../../utils/pagination')

const STATUS = { 1: '草稿', 2: '待审批', 3: '已批准', 4: '已处置', 5: '已驳回', 6: '已取消' }
const DISPOSE_TYPE_LABEL = { 1: '降价促销', 2: '退货供应商', 3: '报废' }

// remaining_qty × 持有成本（avg_cost 优先，回落 cost_price / sale_price）——与 inventory.aging 一致
const VALUE_EXPR = 'c.remaining_qty * COALESCE(NULLIF(p.avg_cost,0), NULLIF(p.cost_price,0), p.sale_price, 0)'

const genNo = conn => generateDailyCode(conn, 'DP', 'inventory_disposal_orders', 'disposal_no')

const fmtItem = r => ({
  id: r.id,
  productId: r.product_id,
  productCode: r.product_code,
  productName: r.product_name,
  unit: r.unit,
  quantity: Number(r.quantity),
  unitValue: Number(r.unit_value),
  value: Number(r.quantity) * Number(r.unit_value),
  disposeType: r.dispose_type,
  disposeTypeName: DISPOSE_TYPE_LABEL[r.dispose_type] || '未知',
  remark: r.remark,
})

const fmt = r => ({
  id: r.id,
  disposalNo: r.disposal_no,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  status: r.status,
  statusName: STATUS[r.status] || '未知',
  totalValue: Number(r.total_value),
  remark: r.remark,
  operatorId: r.operator_id,
  operatorName: r.operator_name,
  approvedBy: r.approved_by,
  approvedByName: r.approved_by_name,
  approvedAt: r.approved_at,
  rejectReason: r.reject_reason,
  disposedAt: r.disposed_at,
  createdAt: r.created_at,
})

/**
 * 呆滞建议（处置单数据源）：某商品×某仓仍有在库 且 最后一次出库距今 > staleDays。
 * 纯只读，不写、不 FOR UPDATE，接仓库数据权限。金额口径与库龄报表一致。
 */
async function getSuggestions({ page = 1, pageSize = 50, keyword = '', warehouseId = null, staleDays = 90, scopeWarehouseIds = null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['c.status = 1', 'c.remaining_qty > 0', 'c.deleted_at IS NULL', 'p.deleted_at IS NULL']
  const params = []
  if (keyword) { conds.push('(p.code LIKE ? OR p.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  if (warehouseId) { conds.push('c.warehouse_id = ?'); params.push(warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const where = conds.join(' AND ') + scope.sql
  const whereParams = [...params, ...scope.params]

  const [rows] = await pool.query(
    `SELECT c.product_id, p.code AS product_code, p.name AS product_name, p.unit, p.avg_cost,
            c.warehouse_id, w.name AS warehouse_name,
            SUM(c.remaining_qty) AS total_qty,
            MAX(${VALUE_EXPR}) AS unit_value,       -- 单容器持有成本相同（同一商品），取 MAX 即单件成本
            SUM(${VALUE_EXPR}) AS total_value,
            MAX(lo.last_outbound_at) AS last_outbound_at
     FROM inventory_containers c
     JOIN product_items p        ON p.id = c.product_id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON w.id = c.warehouse_id AND w.deleted_at IS NULL
     LEFT JOIN (SELECT product_id, warehouse_id, MAX(created_at) AS last_outbound_at
                FROM inventory_logs WHERE type = 2 GROUP BY product_id, warehouse_id) lo
            ON lo.product_id = c.product_id AND lo.warehouse_id = c.warehouse_id
     WHERE ${where}
     GROUP BY c.product_id, p.code, p.name, p.unit, p.avg_cost, c.warehouse_id, w.name
     HAVING MAX(lo.last_outbound_at) IS NULL OR DATEDIFF(NOW(), MAX(lo.last_outbound_at)) > ?
     ORDER BY total_value DESC
     LIMIT ? OFFSET ?`,
    [...whereParams, staleDays, ps, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM (
       SELECT 1
       FROM inventory_containers c
       JOIN product_items p        ON p.id = c.product_id AND p.deleted_at IS NULL
       JOIN inventory_warehouses w ON w.id = c.warehouse_id AND w.deleted_at IS NULL
       LEFT JOIN (SELECT product_id, warehouse_id, MAX(created_at) AS last_outbound_at
                  FROM inventory_logs WHERE type = 2 GROUP BY product_id, warehouse_id) lo
              ON lo.product_id = c.product_id AND lo.warehouse_id = c.warehouse_id
       WHERE ${where}
       GROUP BY c.product_id, c.warehouse_id
       HAVING MAX(lo.last_outbound_at) IS NULL OR DATEDIFF(NOW(), MAX(lo.last_outbound_at)) > ?
     ) t`,
    [...whereParams, staleDays],
  )

  const list = rows.map(r => ({
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    unit: r.unit,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    totalQty: Number(r.total_qty),
    unitValue: Number(r.unit_value),
    totalValue: Number(r.total_value),
    lastOutboundAt: r.last_outbound_at,
    avgCost: Number(r.avg_cost || 0),
  }))
  return { list, pagination: { page, pageSize: ps, total }, staleDays: Number(staleDays) }
}

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, warehouseId = null, startDate = '', endDate = '', scopeWarehouseIds = null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like = `%${keyword}%`
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const conds = ['deleted_at IS NULL']
  const params = []
  if (status) { conds.push('status = ?'); params.push(status) }
  if (warehouseId) { conds.push('warehouse_id = ?'); params.push(warehouseId) }
  if (startDate) { conds.push('created_at >= ?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('created_at <= ?'); params.push(`${endDate} 23:59:59`) }
  conds.push('(disposal_no LIKE ? OR warehouse_name LIKE ?)')
  params.push(like, like)
  if (scope.sql) { conds.push(scope.sql.replace(/^ AND\s*/, '')); params.push(...scope.params) }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT * FROM inventory_disposal_orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory_disposal_orders WHERE ${where}`,
    params,
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query('SELECT * FROM inventory_disposal_orders WHERE id=? AND deleted_at IS NULL', [id])
  if (!rows[0]) throw new AppError('处置单不存在', 404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '处置单')
  const disposal = fmt(rows[0])
  const [items] = await pool.query(
    'SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id ASC', [id],
  )
  disposal.items = items.map(fmtItem)
  return disposal
}

/** 校验明细：商品存在、数量>0、处置方式合法、数量不超过当前可用库存 */
function assertValidItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError('至少添加一条处置明细', 400)
  const seen = new Set()
  for (const it of items) {
    const productId = Number(it?.productId)
    const quantity = Number(it?.quantity)
    const disposeType = Number(it?.disposeType)
    if (!Number.isInteger(productId) || productId <= 0) throw new AppError('明细商品无效', 400)
    const key = `${productId}`
    if (seen.has(key)) throw new AppError('同一商品只能添加一条处置明细', 400)
    seen.add(key)
    if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError('处置数量必须大于 0', 400)
    if (![1, 2, 3].includes(disposeType)) throw new AppError('处置方式无效：1降价促销 2退货供应商 3报废', 400)
  }
}

/** 新建处置单（草稿）。快照持有成本（avg_cost 兜底），total_value 按建议单价×数量落表 */
async function create({ warehouseId, remark, items, operator, scopeWarehouseIds = null }) {
  assertInScope(scopeWarehouseIds, warehouseId, '处置单')
  assertValidItems(items)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[warehouse]] = await conn.query(
      'SELECT id, name FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL AND is_active=1', [warehouseId],
    )
    if (!warehouse) throw new AppError('仓库不存在或已停用', 404)

    // 汇总行成本：建议单价（avg_cost 优先，回落 cost_price / sale_price）
    const productIds = [...new Set(items.map(i => Number(i.productId)))]
    const [products] = await conn.query(
      `SELECT id, code, name, unit,
              COALESCE(NULLIF(avg_cost,0), NULLIF(cost_price,0), sale_price, 0) AS unit_value
         FROM product_items
        WHERE id IN (${productIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      productIds,
    )
    const productMap = new Map(products.map(p => [Number(p.id), p]))
    for (const it of items) {
      if (!productMap.has(Number(it.productId))) throw new AppError('明细中存在无效或已删除的商品', 400)
    }

    const disposalNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inventory_disposal_orders
         (disposal_no, warehouse_id, warehouse_name, status, total_value, remark, operator_id, operator_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      [disposalNo, warehouseId, warehouse.name, 1, 0, remark || null, operator.userId, operator.realName],
    )
    const disposalId = r.insertId
    let totalValue = 0
    for (const it of items) {
      const p = productMap.get(Number(it.productId))
      const unitValue = Number(p.unit_value)
      const quantity = Number(it.quantity)
      totalValue += unitValue * quantity
      await conn.query(
        `INSERT INTO inventory_disposal_items
           (disposal_id, product_id, product_code, product_name, unit, quantity, unit_value, dispose_type, remark)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [disposalId, p.id, p.code, p.name, p.unit, quantity, unitValue, Number(it.disposeType), it.remark || null],
      )
    }
    await conn.query(
      'UPDATE inventory_disposal_orders SET total_value=? WHERE id=?', [totalValue, disposalId],
    )
    await conn.commit()
    return { id: disposalId, disposalNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 编辑草稿：整单替换明细（同盘点单 updateItems 语义）。提交后不可编辑 */
async function update(id, { warehouseId, remark, items }) {
  assertValidItems(items)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'inventory_disposal_orders', id, columns: 'id, warehouse_id, status', entityName: '处置单' })
    assertStatusAction('inventoryDisposal', 'edit', row.status)
    if (Number(row.warehouse_id) !== Number(warehouseId)) throw new AppError('处置单仓库不可修改', 400)

    const productIds = [...new Set(items.map(i => Number(i.productId)))]
    const [products] = await conn.query(
      `SELECT id, code, name, unit,
              COALESCE(NULLIF(avg_cost,0), NULLIF(cost_price,0), sale_price, 0) AS unit_value
         FROM product_items
        WHERE id IN (${productIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      productIds,
    )
    const productMap = new Map(products.map(p => [Number(p.id), p]))
    for (const it of items) {
      if (!productMap.has(Number(it.productId))) throw new AppError('明细中存在无效或已删除的商品', 400)
    }

    await conn.query('DELETE FROM inventory_disposal_items WHERE disposal_id=?', [id])
    let totalValue = 0
    for (const it of items) {
      const p = productMap.get(Number(it.productId))
      const unitValue = Number(p.unit_value)
      const quantity = Number(it.quantity)
      totalValue += unitValue * quantity
      await conn.query(
        `INSERT INTO inventory_disposal_items
           (disposal_id, product_id, product_code, product_name, unit, quantity, unit_value, dispose_type, remark)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, p.id, p.code, p.name, p.unit, quantity, unitValue, Number(it.disposeType), it.remark || null],
      )
    }
    await conn.query(
      'UPDATE inventory_disposal_orders SET remark=?, total_value=? WHERE id=?',
      [remark || null, totalValue, id],
    )
    await conn.commit()
    return { id }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 提交审批：草稿 → 待审批 */
async function submit(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'inventory_disposal_orders', id, columns: 'id, status', entityName: '处置单' })
    const rule = assertStatusAction('inventoryDisposal', 'submit', row.status)
    await compareAndSetStatus(conn, {
      table: 'inventory_disposal_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '处置单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 审批通过：待审批 → 已批准 */
async function approve(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'inventory_disposal_orders', id, columns: 'id, status', entityName: '处置单' })
    const rule = assertStatusAction('inventoryDisposal', 'approve', row.status)
    await compareAndSetStatus(conn, {
      table: 'inventory_disposal_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '处置单',
    })
    await conn.query(
      'UPDATE inventory_disposal_orders SET approved_by=?, approved_by_name=?, approved_at=NOW() WHERE id=?',
      [operator.userId, operator.realName, id],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 驳回：待审批 → 已驳回 */
async function reject(id, { reason, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'inventory_disposal_orders', id, columns: 'id, status', entityName: '处置单' })
    const rule = assertStatusAction('inventoryDisposal', 'reject', row.status)
    await compareAndSetStatus(conn, {
      table: 'inventory_disposal_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '处置单',
    })
    await conn.query(
      'UPDATE inventory_disposal_orders SET reject_reason=?, approved_by=?, approved_by_name=?, approved_at=NOW() WHERE id=?',
      [reason || null, operator.userId, operator.realName, id],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 执行处置：已批准 → 已处置。逐行 FIFO 扣减容器 + 刷新缓存 + 写流水；
 * 报废行额外落 disposal_scrapped 台账。整单一个事务，任一行失败整单回滚。
 */
async function dispose(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'inventory_disposal_orders', id, columns: 'id, warehouse_id, warehouse_name, disposal_no, status', entityName: '处置单' })
    const rule = assertStatusAction('inventoryDisposal', 'dispose', row.status)

    const [items] = await conn.query(
      'SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id ASC', [id],
    )
    if (!items.length) throw new AppError('处置单没有明细，无法执行', 400)

    // 统一加锁顺序：先按 product_id 升序取 inventory_stock 维度锁，再做容器扣减（与盘点提交同序，
    // 防止与出库/上架的「先 stock 后容器」顺序相反造成 ABBA 死锁，见 containerEngine.lockStockDimension 注释）。
    const lockProductIds = [...new Set(items.map(i => Number(i.product_id)))].sort((a, b) => a - b)
    for (const productId of lockProductIds) {
      await lockStockDimension(conn, productId, Number(row.warehouse_id))
    }

    let disposedValue = 0
    for (const item of items) {
      const { product_id, product_name, quantity, unit, unit_value, dispose_type } = item
      const beforeAfter = await adjustContainerStock(conn, {
        productId: product_id,
        productName: product_name,
        warehouseId: Number(row.warehouse_id),
        qty: -Number(quantity),
        unit,
        sourceType: SOURCE_TYPE.DISPOSAL,
        sourceRefId: id,
        sourceRefType: 'disposal',
        sourceRefNo: row.disposal_no,
        remark: `${DISPOSE_TYPE_LABEL[dispose_type]} ${row.disposal_no}`,
      })

      // 报废：除扣库存外另落台账留痕（资产灭失的审计证据）
      if (Number(dispose_type) === 3) {
        await conn.query(
          `INSERT INTO disposal_scrapped
             (disposal_id, disposal_no, product_id, product_code, product_name, unit,
              quantity, unit_value, warehouse_id, warehouse_name, remark, scrapped_by, scrapped_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, row.disposal_no, product_id, item.product_code, product_name, unit,
            quantity, unit_value, Number(row.warehouse_id), row.warehouse_name,
            `${row.disposal_no} 报废`, operator.userId, operator.realName],
        )
      }

      disposedValue += Number(quantity) * Number(unit_value)

      // 写库存变动日志（与盘点盘亏同口径，type=2 出库方向）
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no,
            container_id, log_source_type, log_source_ref_id,
            remark, operator_id, operator_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.DISPOSAL, 2,
          product_id, Number(row.warehouse_id),
          Number(quantity), beforeAfter.before, beforeAfter.after, unit_value,
          'disposal', id, row.disposal_no,
          beforeAfter.primaryDeductContainerId, SOURCE_TYPE.DISPOSAL, id,
          `${DISPOSE_TYPE_LABEL[dispose_type]} ${row.disposal_no}`,
          operator.userId, operator.realName,
        ],
      )
    }

    await compareAndSetStatus(conn, {
      table: 'inventory_disposal_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '处置单',
    })
    await conn.query(
      'UPDATE inventory_disposal_orders SET disposed_at=NOW() WHERE id=?', [id],
    )
    await conn.commit()
    return { id, disposalNo: row.disposal_no, disposedValue }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 取消：草稿/待审批 → 已取消 */
async function cancel(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'inventory_disposal_orders', id, columns: 'id, status', entityName: '处置单' })
    const rule = assertStatusAction('inventoryDisposal', 'cancel', row.status)
    await compareAndSetStatus(conn, {
      table: 'inventory_disposal_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '处置单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { getSuggestions, findAll, findById, create, update, submit, approve, reject, dispose, cancel }
