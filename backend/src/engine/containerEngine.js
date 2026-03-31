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

/** 与 inventory_containers.status 一致 */
const CONTAINER_STATUS = {
  ACTIVE:           1,
  EMPTY:            2,
  VOID:             3,
  PENDING_PUTAWAY:  4,
}

/** 写入 inventory_containers.source_type 的规范取值 */
const SOURCE_TYPE = {
  INBOUND_TASK:     'inbound_task',
  STOCKCHECK:       'stockcheck',
  TRANSFER:         'transfer',
  RETURN:           'return',
  IMPORT:           'import',
  MANUAL:           'manual',
  LEGACY:           'legacy',
  CONTAINER_SPLIT:  'container_split',
}

const ALLOWED_SOURCE_TYPES = new Set(Object.values(SOURCE_TYPE))

/** 允许 createContainer 直接落 status=ACTIVE(1) 的来源（调拨入、销售退货、同仓拆分）；其余须先 4 再 promote */
const DIRECT_ACTIVE_SOURCE_TYPES = new Set([
  SOURCE_TYPE.TRANSFER,
  SOURCE_TYPE.RETURN,
  SOURCE_TYPE.CONTAINER_SPLIT,
])

const PUTAWAY_DEFAULT_HOURS = 24

function defaultPutawayDeadline() {
  const d = new Date()
  d.setTime(d.getTime() + PUTAWAY_DEFAULT_HOURS * 3600 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

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
 * - I + 6位数字：库存条码
 * - B + 6位数字：塑料盒条码
 */
async function genBarcode(conn, prefix = 'I') {
  return generateContainerCode(conn, prefix)
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
 * @param {string} params.sourceType         - SOURCE_TYPE.*，必填
 * @param {number} params.sourceRefId          - 来源单据 ID，必填且 >0
 * @param {string} [params.sourceRefType]      - 细分类（写入 source_ref_type，如 sale_return）
 * @param {string} [params.sourceRefNo]
 * @param {string} [params.remark]
 * @param {string} [params.barcode]          - 自定义条码（不传则自动生成）
 * @param {'I'|'B'} [params.barcodePrefix]   - 自动生成条码前缀；默认 I
 * @param {number} [params.containerType]    - 1=库存条码 2=塑料盒条码
 * @param {number} [params.locationId]       - 库位ID
 * @param {number} [params.inboundTaskId]     - 入库任务ID（收货生成待上架容器）
 * @param {number} [params.containerStatus]   - 默认 ACTIVE（仅调拨/退货允许）；其它来源须显式传 PENDING_PUTAWAY 或由引擎内部两段式入账
 * @param {string|null} [params.putawayDeadlineAt] - status=4 时写入；默认当前 +24h（YYYY-MM-DD HH:mm:ss）
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
  sourceType,
  sourceRefId,
  sourceRefType = null,
  sourceRefNo   = null,
  remark        = null,
  barcode       = null,
  barcodePrefix = 'I',
  containerType = 1,
  locationId    = null,
  inboundTaskId = null,
  containerStatus = CONTAINER_STATUS.ACTIVE,
  putawayDeadlineAt = null,
}) {
  assertNonNegativeQty(initialQty, `createContainer productId=${productId} warehouseId=${warehouseId}`)

  if (!sourceType || typeof sourceType !== 'string' || !ALLOWED_SOURCE_TYPES.has(sourceType)) {
    throw new AppError(`容器 sourceType 无效或未传：${sourceType}`, 400)
  }
  const sid = Number(sourceRefId)
  if (!Number.isFinite(sid) || sid <= 0) {
    throw new AppError('容器必须提供有效的 sourceRefId（正整数单据ID）', 400)
  }

  const st = Number(containerStatus)
  if (st === CONTAINER_STATUS.ACTIVE && !DIRECT_ACTIVE_SOURCE_TYPES.has(sourceType)) {
    throw new AppError(
      '禁止直接创建在库(ACTIVE)容器：仅「调拨入、销售退货」允许；盘点/导入等须先待上架再入账',
      400,
    )
  }
  if (st === CONTAINER_STATUS.ACTIVE && sourceType === SOURCE_TYPE.INBOUND_TASK) {
    throw new AppError('禁止以在库状态创建入库任务容器，须先收货(待上架)再上架', 400)
  }

  let deadline = null
  if (st === CONTAINER_STATUS.PENDING_PUTAWAY) {
    deadline = putawayDeadlineAt || defaultPutawayDeadline()
  }

  const bc = barcode || await genBarcode(conn, barcodePrefix)
  const detailRefType = sourceRefType || sourceType
  const [r] = await conn.query(
    `INSERT INTO inventory_containers
       (barcode, container_type, product_id, warehouse_id, location_id,
        batch_no, mfg_date, exp_date, unit,
        initial_qty, remaining_qty, status,
        source_ref_type, source_ref_id, source_ref_no, inbound_task_id, remark,
        source_type, source_audit_missing, putaway_flagged_overdue,
        is_legacy, putaway_deadline_at, is_overdue)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,0)`,
    [bc, containerType, productId, warehouseId, locationId,
     batchNo, mfgDate || null, expDate || null, unit,
     initialQty, initialQty, containerStatus,
     detailRefType, sid, sourceRefNo, inboundTaskId, remark,
     sourceType,
     deadline]
  )
  return { containerId: r.insertId, barcode: bc }
}

/**
 * 待上架容器在同一事务内转为在库并刷新缓存（盘点盘盈、导入等非调拨/退货路径）
 */
async function promotePendingContainerToActive(conn, containerId, productId, warehouseId) {
  const [r] = await conn.query(
    `UPDATE inventory_containers
     SET status = ?, is_overdue = 0, putaway_flagged_overdue = 0, putaway_deadline_at = NULL
     WHERE id = ? AND status = ? AND deleted_at IS NULL`,
    [CONTAINER_STATUS.ACTIVE, containerId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  if (r.affectedRows !== 1) {
    throw new AppError('容器无法从待上架转为在库（状态已变更或不存在）', 409)
  }
  return syncStockFromContainers(conn, productId, warehouseId)
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
 * 仅扣减被指定仓库任务锁定的在库容器（locked_by_task_id = taskId）
 * 用于销售任务出库，禁止全局 FIFO 绕过拣货容器。
 *
 * @param {number} params.taskId - warehouse_tasks.id
 */
async function deductFromTaskLockedContainers(conn, {
  productId,
  productName = '该商品',
  warehouseId,
  qty,
  taskId,
}) {
  const absQty = Math.abs(qty)
  const tid = Number(taskId)
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new AppError('deductFromTaskLockedContainers 需要有效的 taskId', 500)
  }

  const [containers] = await conn.query(
    `SELECT id, barcode, remaining_qty, unit, batch_no, mfg_date, exp_date
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL
       AND locked_by_task_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, warehouseId, tid],
  )

  const totalAvailable = containers.reduce((s, c) => s + Number(c.remaining_qty), 0)
  if (totalAvailable < absQty) {
    throw new AppError(
      `商品「${productName}」本任务锁定容器可用量不足，当前 ${totalAvailable}，需要 ${absQty}`,
      400,
    )
  }

  let remaining = absQty
  const deducted = []

  for (const container of containers) {
    if (remaining <= 0) break
    const containerQty = Number(container.remaining_qty)
    const take = Math.min(containerQty, remaining)
    const newQty = containerQty - take
    const newStatus = newQty === 0 ? 2 : 1

    assertNonNegativeQty(newQty, `containerId=${container.id} barcode=${container.barcode}`)

    await conn.query(
      'UPDATE inventory_containers SET remaining_qty=?, status=? WHERE id=?',
      [newQty, newStatus, container.id],
    )

    deducted.push({
      containerId:    container.id,
      barcode:        container.barcode,
      taken:          take,
      remainingAfter: newQty,
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
  let firstNewContainerId = null
  for (const d of deducted) {
    const { containerId } = await createContainer(conn, {
      productId,
      warehouseId:   toWarehouseId,
      initialQty:    d.taken,
      unit:          d.unit,
      batchNo:       d.batchNo,
      mfgDate:       d.mfgDate ? (d.mfgDate instanceof Date ? d.mfgDate.toISOString().slice(0,10) : d.mfgDate) : null,
      expDate:       d.expDate ? (d.expDate instanceof Date ? d.expDate.toISOString().slice(0,10) : d.expDate) : null,
      sourceType:    SOURCE_TYPE.TRANSFER,
      sourceRefId,
      sourceRefType,
      sourceRefNo,
      remark,
    })
    if (!firstNewContainerId) firstNewContainerId = containerId
  }

  // 6. 同步两个仓库的 inventory_stock 缓存
  const fromAfter = await syncStockFromContainers(conn, productId, fromWarehouseId)
  const toAfter   = await syncStockFromContainers(conn, productId, toWarehouseId)

  return { fromBefore, fromAfter, toBefore, toAfter, deducted, firstNewContainerId }
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

  let createdContainerId = null
  let primaryDeductContainerId = null

  if (diffQty > 0) {
    const r = await createContainer(conn, {
      productId,
      warehouseId,
      initialQty:   diffQty,
      unit,
      sourceType:   SOURCE_TYPE.STOCKCHECK,
      sourceRefId,
      sourceRefType,
      sourceRefNo,
      remark: remark || `盘点盘盈 ${sourceRefNo ?? ''}`,
      containerStatus: CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    await promotePendingContainerToActive(conn, r.containerId, productId, warehouseId)
    createdContainerId = r.containerId
  } else if (diffQty < 0) {
    const ded = await deductFromContainers(conn, {
      productId,
      productName,
      warehouseId,
      qty: Math.abs(diffQty),
    })
    primaryDeductContainerId = ded[0]?.containerId ?? null
  }
  // diffQty === 0 时无需任何操作

  // 同步 inventory_stock 缓存（保证容器总和 = 缓存值）
  const after = await syncStockFromContainers(conn, productId, warehouseId)

  return { before, after, createdContainerId, primaryDeductContainerId }
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
 * @param {string} params.sourceType   - SOURCE_TYPE.*
 * @param {number} params.sourceRefId
 * @param {string} [params.sourceRefType]
 * @param {string} [params.sourceRefNo]
 * @param {string} [params.remark]
 * @returns {{ before: number, after: number, createdContainerId: number|null, primaryDeductContainerId: number|null }}
 */
async function adjustContainerStock(conn, {
  productId,
  productName  = '该商品',
  warehouseId,
  qty,
  unit         = null,
  sourceType,
  sourceRefId,
  sourceRefType = null,
  sourceRefNo   = null,
  remark        = null,
}) {
  const [[stockRow]] = await conn.query(
    'SELECT COALESCE(quantity, 0) AS qty FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
    [productId, warehouseId]
  )
  const before = stockRow ? Number(stockRow.qty) : 0

  let createdContainerId = null
  let primaryDeductContainerId = null

  if (qty > 0) {
    const directActive = DIRECT_ACTIVE_SOURCE_TYPES.has(sourceType)
    const r = await createContainer(conn, {
      productId, warehouseId, initialQty: qty, unit,
      sourceType,
      sourceRefId,
      sourceRefType: sourceRefType || sourceType,
      sourceRefNo,
      remark: remark || `入库 ${sourceRefNo ?? ''}`,
      containerStatus: directActive ? CONTAINER_STATUS.ACTIVE : CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    if (!directActive) {
      await promotePendingContainerToActive(conn, r.containerId, productId, warehouseId)
    }
    createdContainerId = r.containerId
  } else if (qty < 0) {
    const ded = await deductFromContainers(conn, { productId, productName, warehouseId, qty: Math.abs(qty) })
    primaryDeductContainerId = ded[0]?.containerId ?? null
  }

  const after = await syncStockFromContainers(conn, productId, warehouseId)
  return { before, after, createdContainerId, primaryDeductContainerId }
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
     SET locked_by_task_id = ?, locked_at = NOW()
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

function fmtSqlDate(d) {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

/**
 * 同仓容器拆分：从单一 ACTIVE 容器扣减数量，生成新塑料盒（B 条码，继承库位与批次）
 *
 * @param {object} conn
 * @param {{ containerId: number, qty: number, remark?: string|null }} params
 * @returns {Promise<{ sourceContainerId: number, sourceBarcode: string, sourceRemainingAfter: number, newContainerId: number, newBarcode: string, newContainerKind: 'plastic_box', productId: number, warehouseId: number }>}
 */
async function splitContainer(conn, { containerId, qty, remark = null }) {
  const cid = Number(containerId)
  const q = Number(qty)
  if (!Number.isFinite(cid) || cid <= 0) throw new AppError('无效容器 ID', 400)
  if (!Number.isFinite(q) || q <= 0) throw new AppError('拆分数量须为正数', 400)

  const [[row]] = await conn.query(
    `SELECT id, barcode, product_id, warehouse_id, location_id, remaining_qty, status,
            locked_by_task_id, batch_no, mfg_date, exp_date, unit
     FROM inventory_containers
     WHERE id = ? AND deleted_at IS NULL
     FOR UPDATE`,
    [cid],
  )
  if (!row) throw new AppError('容器不存在', 404)
  if (Number(row.status) !== CONTAINER_STATUS.ACTIVE) {
    throw new AppError('源容器须为在库(ACTIVE)状态', 400)
  }
  if (row.locked_by_task_id != null) {
    throw new AppError('容器已被任务锁定，不可拆分', 409)
  }
  const rem = Number(row.remaining_qty)
  if (q >= rem) throw new AppError('拆分数量须小于剩余数量', 400)

  const newRem = rem - q
  const newStatus = newRem === 0 ? CONTAINER_STATUS.EMPTY : CONTAINER_STATUS.ACTIVE
  await conn.query(
    'UPDATE inventory_containers SET remaining_qty = ?, status = ? WHERE id = ?',
    [newRem, newStatus, cid],
  )

  const { containerId: newId, barcode: newBc } = await createContainer(conn, {
    productId:       row.product_id,
    warehouseId:     row.warehouse_id,
    initialQty:      q,
    unit:            row.unit,
    batchNo:         row.batch_no,
    mfgDate:         fmtSqlDate(row.mfg_date),
    expDate:         fmtSqlDate(row.exp_date),
    sourceType:      SOURCE_TYPE.CONTAINER_SPLIT,
    sourceRefId:     cid,
    sourceRefType:   'container_split',
    remark:          remark || `自 ${row.barcode} 拆分`,
    barcodePrefix:   'B',
    containerType:   2,
    locationId:      row.location_id,
    containerStatus: CONTAINER_STATUS.ACTIVE,
  })

  await conn.query(
    'UPDATE inventory_containers SET parent_id = ? WHERE id = ?',
    [cid, newId],
  )

  await syncStockFromContainers(conn, row.product_id, row.warehouse_id)

  return {
    sourceContainerId:   cid,
    sourceBarcode:         row.barcode,
    sourceRemainingAfter:  newRem,
    newContainerId:        newId,
    newBarcode:            newBc,
    newContainerKind:      'plastic_box',
    productId:             row.product_id,
    warehouseId:           row.warehouse_id,
  }
}

module.exports = {
  createContainer,
  promotePendingContainerToActive,
  deductFromContainers,
  deductFromTaskLockedContainers,
  syncStockFromContainers,
  transferContainers,
  adjustContainersForStockcheck,
  adjustContainerStock,
  genBarcode,
  lockContainer,
  unlockContainersByTask,
  splitContainer,
  CONTAINER_STATUS,
  SOURCE_TYPE,
  DIRECT_ACTIVE_SOURCE_TYPES,
}
