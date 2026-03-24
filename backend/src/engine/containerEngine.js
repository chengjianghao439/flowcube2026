/**
 * Container Engine — 库存容器引擎
 *
 * 架构规则：
 *  1. inventory_containers.remaining_qty 是唯一真实库存来源
 *  2. inventory_stock.quantity 是缓存字段，必须通过 syncStockFromContainers() 更新
 *  3. 任何入库通过 createContainer() 建立容器记录
 *  4. 任何出库通过 deductFromContainers() 按 FIFO 扣减容器
 *  5. 所有操作必须在调用方已开启的事务连接中运行
 *
 * 迁移阶段说明（Phase 2）：
 *  已迁移：采购入库（PURCHASE_IN）、销售出库（SALE_OUT）、仓库任务出库（TASK_OUT）
 *  待迁移：调拨、盘点、退货（legacy 路径）
 */

const AppError = require('../utils/AppError')
const logger   = require('../utils/logger')
const { generateContainerCode } = require('../utils/codeGenerator')

/**
 * 数据一致性断言：remaining_qty 必须 >= 0
 * 如果违反，立即抛出错误并记录 error 日志（不允许出现负库存容器）
 */
function assertNonNegativeQty(qty, context = '') {
  if (qty < 0) {
    const msg = `[GUARD] remaining_qty 出现负值 (${qty})，操作被拒绝。上下文：${context}`
    logger.error(msg, null, { qty, context }, 'ContainerGuard')
    throw new AppError(msg, 500)
  }
}

/**
 * 生成容器条码
 * 格式：CNT + 6位全局递增序号，如 CNT000001
 */
async function genBarcode(conn) {
  return generateContainerCode(conn)
}

/**
 * 创建标准容器（STANDARD）
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.productId
 * @param {number} params.warehouseId
 * @param {number} params.initialQty         - 入库数量（写入 initial_qty 与 remaining_qty）
 * @param {string} [params.unit]
 * @param {string} [params.batchNo]
 * @param {string} [params.mfgDate]          - YYYY-MM-DD
 * @param {string} [params.expDate]          - YYYY-MM-DD
 * @param {string} [params.sourceRefType]    - e.g. 'purchase_order'
 * @param {number} [params.sourceRefId]
 * @param {string} [params.sourceRefNo]
 * @param {string} [params.remark]
 * @param {string} [params.barcode]          - 自定义条码（不传则自动生成）
 * @param {number} [params.locationId]       - 库位ID
 * @returns {{ containerId: number, barcode: string }}
 */
async function createContainer(conn, {
  productId,
  warehouseId,
  initialQty,
  unit          = null,
  batchNo       = null,
  mfgDate       = null,
  expDate       = null,
  sourceRefType = null,
  sourceRefId   = null,
  sourceRefNo   = null,
  remark        = null,
  barcode       = null,
  locationId    = null,
}) {
  assertNonNegativeQty(initialQty, `createContainer productId=${productId} warehouseId=${warehouseId}`)

  const bc = barcode || await genBarcode(conn)
  const [r] = await conn.query(
    `INSERT INTO inventory_containers
       (barcode, container_type, product_id, warehouse_id, location_id,
        batch_no, mfg_date, exp_date, unit,
        initial_qty, remaining_qty, status,
        source_ref_type, source_ref_id, source_ref_no, remark)
     VALUES (?,1,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
    [bc, productId, warehouseId, locationId,
     batchNo, mfgDate || null, expDate || null, unit,
     initialQty, initialQty,
     sourceRefType, sourceRefId, sourceRefNo, remark]
  )
  return { containerId: r.insertId, barcode: bc }
}

/**
 * FIFO 容器出库扣减
 *
 * 按 created_at ASC 顺序依次扣减 ACTIVE 容器的 remaining_qty，
 * 容器清空后自动标记为 EMPTY（status=2）。
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.productId
 * @param {string} [params.productName]      - 用于错误提示
 * @param {number} params.warehouseId
 * @param {number} params.qty                - 需要扣减的数量（正数）
 * @returns {Array<{ containerId, barcode, taken, remainingAfter }>} 被扣减的容器列表
 * @throws {AppError} 可用库存不足时抛出
 */
async function deductFromContainers(conn, {
  productId,
  productName = '该商品',
  warehouseId,
  qty,
}) {
  const absQty = Math.abs(qty)

  // 加行锁读取所有 ACTIVE 容器，FIFO 顺序，同时读取批次信息供调拨保留使用
  const [containers] = await conn.query(
    `SELECT id, barcode, remaining_qty, unit, batch_no, mfg_date, exp_date
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, warehouseId]
  )

  const totalAvailable = containers.reduce((s, c) => s + Number(c.remaining_qty), 0)
  if (totalAvailable < absQty) {
    throw new AppError(
      `商品「${productName}」容器库存不足，当前可用 ${totalAvailable}，需要 ${absQty}`,
      400
    )
  }

  let remaining = absQty
  const deducted = []

  for (const container of containers) {
    if (remaining <= 0) break
    const containerQty = Number(container.remaining_qty)
    const take         = Math.min(containerQty, remaining)
    const newQty       = containerQty - take
    const newStatus    = newQty === 0 ? 2 : 1  // 2=EMPTY, 1=ACTIVE

    // 守卫：扣减结果不允许为负（正常情况下不会触发，属于逻辑防御）
    assertNonNegativeQty(newQty, `containerId=${container.id} barcode=${container.barcode}`)

    await conn.query(
      'UPDATE inventory_containers SET remaining_qty=?, status=? WHERE id=?',
      [newQty, newStatus, container.id]
    )

    deducted.push({
      containerId:    container.id,
      barcode:        container.barcode,
      taken:          take,
      remainingAfter: newQty,
      // 批次信息（供调拨目标仓库创建容器时保留）
      unit:    container.unit,
      batchNo: container.batch_no,
      mfgDate: container.mfg_date,
      expDate: container.exp_date,
    })
    remaining -= take
  }

  return deducted
}

/**
 * 汇总指定 product_id + warehouse_id 的所有 ACTIVE 容器 remaining_qty，
 * 写入 inventory_stock.quantity（缓存更新）。
 *
 * 这是唯一允许修改 inventory_stock.quantity 的途径（采购与销售路径）。
 * 查询严格限定到单个 product_id + warehouse_id，禁止全表 SUM。
 *
 * @param {object} conn
 * @param {number} productId
 * @param {number} warehouseId
 * @returns {number} 汇总后的库存数量
 */
async function syncStockFromContainers(conn, productId, warehouseId) {
  // 仅汇总指定商品+仓库维度，禁止全表扫描
  const [[{ total }]] = await conn.query(
    `SELECT COALESCE(SUM(remaining_qty), 0) AS total
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL`,
    [productId, warehouseId]
  )
  const qty = Number(total)

  // 行锁保护，确保并发写安全
  await conn.query(
    `SELECT id FROM inventory_stock
     WHERE product_id=? AND warehouse_id=? FOR UPDATE`,
    [productId, warehouseId]
  )
  await conn.query(
    `INSERT INTO inventory_stock (product_id, warehouse_id, quantity)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE quantity=?`,
    [productId, warehouseId, qty, qty]
  )
  return qty
}

/**
 * 调拨容器操作：源仓库 FIFO 扣减 → 目标仓库创建（保留批次）→ 双仓同步
 *
 * 调拨不允许占用已被预占的库存：
 *   可用库存 = SUM(container.remaining_qty) - inventory_stock.reserved
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.productId
 * @param {string} [params.productName]
 * @param {number} params.fromWarehouseId
 * @param {number} params.toWarehouseId
 * @param {number} params.qty
 * @param {string} [params.sourceRefType]   - 'transfer'
 * @param {number} [params.sourceRefId]     - transfer_order.id
 * @param {string} [params.sourceRefNo]     - transfer_order.order_no
 * @param {string} [params.remark]
 *
 * @returns {{ fromBefore, fromAfter, toBefore, toAfter, deducted }}
 */
async function transferContainers(conn, {
  productId,
  productName    = '该商品',
  fromWarehouseId,
  toWarehouseId,
  qty,
  sourceRefType  = 'transfer',
  sourceRefId    = null,
  sourceRefNo    = null,
  remark         = null,
}) {
  // 1. 读源仓库 before 值（用于日志）+ 锁 inventory_stock
  const [[fromStock]] = await conn.query(
    'SELECT COALESCE(quantity,0) AS qty, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
    [productId, fromWarehouseId]
  )
  const fromBefore = fromStock ? Number(fromStock.qty)      : 0
  const reserved   = fromStock ? Number(fromStock.reserved) : 0

  // 2. 读目标仓库 before 值（用于日志）
  const [[toStock]] = await conn.query(
    'SELECT COALESCE(quantity,0) AS qty FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, toWarehouseId]
  )
  const toBefore = toStock ? Number(toStock.qty) : 0

  // 3. 可用库存校验（不允许调拨预占库存）
  const available = fromBefore - reserved
  if (available < qty) {
    throw new AppError(
      `调拨失败：商品「${productName}」可用库存不足，` +
      `实际库存 ${fromBefore}，已预占 ${reserved}，可用 ${available}，需要 ${qty}`,
      400
    )
  }

  // 4. FIFO 扣减源仓库容器（同时携带批次信息）
  const deducted = await deductFromContainers(conn, {
    productId, productName, warehouseId: fromWarehouseId, qty,
  })

  // 5. 在目标仓库按批次创建对应容器
  for (const d of deducted) {
    await createContainer(conn, {
      productId,
      warehouseId:   toWarehouseId,
      initialQty:    d.taken,
      unit:          d.unit,
      batchNo:       d.batchNo,
      mfgDate:       d.mfgDate ? (d.mfgDate instanceof Date ? d.mfgDate.toISOString().slice(0,10) : d.mfgDate) : null,
      expDate:       d.expDate ? (d.expDate instanceof Date ? d.expDate.toISOString().slice(0,10) : d.expDate) : null,
      sourceRefType,
      sourceRefId,
      sourceRefNo,
      remark,
    })
  }

  // 6. 同步两个仓库的 inventory_stock 缓存
  const fromAfter = await syncStockFromContainers(conn, productId, fromWarehouseId)
  const toAfter   = await syncStockFromContainers(conn, productId, toWarehouseId)

  return { fromBefore, fromAfter, toBefore, toAfter, deducted }
}

/**
 * 盘点容器调整
 *
 * 盘点不再直接修改 inventory_stock，而是通过容器增减实现：
 *   diffQty > 0  → 创建新容器（盘点正差异，增加库存）
 *   diffQty < 0  → FIFO 扣减容器（盘点负差异，减少库存）
 *   diffQty = 0  → 无操作
 *
 * 调整后强制 syncStockFromContainers 确保缓存与容器总和一致。
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.productId
 * @param {string} [params.productName]
 * @param {number} params.warehouseId
 * @param {number} params.diffQty           - 有符号差异量（正=盘盈，负=盘亏）
 * @param {string} [params.unit]
 * @param {string} [params.sourceRefType]   - 'stockcheck'
 * @param {number} [params.sourceRefId]
 * @param {string} [params.sourceRefNo]
 * @param {string} [params.remark]
 * @returns {{ before: number, after: number }}
 */
async function adjustContainersForStockcheck(conn, {
  productId,
  productName  = '该商品',
  warehouseId,
  diffQty,
  unit         = null,
  sourceRefType = 'stockcheck',
  sourceRefId   = null,
  sourceRefNo   = null,
  remark        = null,
}) {
  // 读取当前 inventory_stock 缓存值（用于日志 before_qty）
  const [[stockRow]] = await conn.query(
    'SELECT COALESCE(quantity, 0) AS qty FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
    [productId, warehouseId]
  )
  const before = stockRow ? Number(stockRow.qty) : 0

  if (diffQty > 0) {
    // 盘盈：创建新容器，source 标记为盘点
    await createContainer(conn, {
      productId,
      warehouseId,
      initialQty:   diffQty,
      unit,
      sourceRefType,
      sourceRefId,
      sourceRefNo,
      remark: remark || `盘点盘盈 ${sourceRefNo ?? ''}`,
    })
  } else if (diffQty < 0) {
    // 盘亏：FIFO 扣减容器（不足则抛出）
    await deductFromContainers(conn, {
      productId,
      productName,
      warehouseId,
      qty: Math.abs(diffQty),
    })
  }
  // diffQty === 0 时无需任何操作

  // 同步 inventory_stock 缓存（保证容器总和 = 缓存值）
  const after = await syncStockFromContainers(conn, productId, warehouseId)

  return { before, after }
}

/**
 * 通用容器库存调整（退货、手动操作通用入口）
 *
 * qty > 0  → 创建新容器（入库方向）
 * qty < 0  → FIFO 扣减容器（出库方向）
 * qty = 0  → 无操作
 *
 * 与 adjustContainersForStockcheck 逻辑相同，语义更通用。
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.productId
 * @param {string} [params.productName]
 * @param {number} params.warehouseId
 * @param {number} params.qty                - 有符号量（正=入库，负=出库）
 * @param {string} [params.unit]
 * @param {string} [params.sourceRefType]
 * @param {number} [params.sourceRefId]
 * @param {string} [params.sourceRefNo]
 * @param {string} [params.remark]
 * @returns {{ before: number, after: number }}
 */
async function adjustContainerStock(conn, {
  productId,
  productName  = '该商品',
  warehouseId,
  qty,
  unit         = null,
  sourceRefType = null,
  sourceRefId   = null,
  sourceRefNo   = null,
  remark        = null,
}) {
  const [[stockRow]] = await conn.query(
    'SELECT COALESCE(quantity, 0) AS qty FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
    [productId, warehouseId]
  )
  const before = stockRow ? Number(stockRow.qty) : 0

  if (qty > 0) {
    await createContainer(conn, {
      productId, warehouseId, initialQty: qty, unit,
      sourceRefType, sourceRefId, sourceRefNo,
      remark: remark || `入库 ${sourceRefNo ?? ''}`,
    })
  } else if (qty < 0) {
    await deductFromContainers(conn, { productId, productName, warehouseId, qty: Math.abs(qty) })
  }

  const after = await syncStockFromContainers(conn, productId, warehouseId)
  return { before, after }
}

/**
 * 锁定容器 — 将容器绑定到指定仓库任务
 *
 * 仅当容器未被锁定、或已被同一任务锁定时成功。
 * 如果容器已被其他任务锁定，抛出 AppError。
 *
 * @param {object} conn   - 事务连接
 * @param {number} containerId
 * @param {number} taskId
 */
async function lockContainer(conn, containerId, taskId) {
  const [result] = await conn.query(
    `UPDATE inventory_containers
     SET locked_by_task_id = ?, locked_at = IF(locked_by_task_id IS NULL, NOW(), locked_at)
     WHERE id = ? AND (locked_by_task_id IS NULL OR locked_by_task_id = ?)`,
    [taskId, containerId, taskId],
  )
  if (result.affectedRows === 0) {
    throw new AppError('该容器已被其他任务占用', 409)
  }
}

/**
 * 释放指定任务锁定的所有容器
 *
 * 在任务完成（ship）或取消（cancel）时调用。
 *
 * @param {object} conn   - 事务连接或 pool
 * @param {number} taskId
 * @returns {number} 释放的容器数量
 */
async function unlockContainersByTask(conn, taskId) {
  const [result] = await conn.query(
    `UPDATE inventory_containers
     SET locked_by_task_id = NULL, locked_at = NULL
     WHERE locked_by_task_id = ?`,
    [taskId],
  )
  return result.affectedRows
}

module.exports = {
  createContainer,
  deductFromContainers,
  syncStockFromContainers,
  transferContainers,
  adjustContainersForStockcheck,
  adjustContainerStock,
  genBarcode,
  lockContainer,
  unlockContainersByTask,
}
