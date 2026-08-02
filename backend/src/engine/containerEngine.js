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
  PENDING_QA:       5,
  REJECTED:         6,
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

/** 允许 createContainer 直接落 status=ACTIVE(1) 的来源（调拨入、同仓拆分）；其余（含销售退货，须先经 PENDING_QA 质检）先建 4 再 promote */
const DIRECT_ACTIVE_SOURCE_TYPES = new Set([
  SOURCE_TYPE.TRANSFER,
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
  // 该容器归属的收货明细行（inbound_task_items.id）。收货时已知这箱货来自哪张采购单的
  // 哪一行，记下来后上架才能把 putaway_qty 精确回写到对应明细，而不是再 first-fit 猜一次
  // （审计 P1-4，见迁移 132）。非收货来源的容器留 null。
  inboundTaskItemId = null,
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
      '禁止直接创建在库(ACTIVE)容器：仅「调拨入、同仓拆分」允许；盘点/导入/销售退货等须先待上架/质检再入账',
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
        source_ref_type, source_ref_id, source_ref_no, inbound_task_id, inbound_task_item_id, remark,
        source_type, source_audit_missing, putaway_flagged_overdue,
        is_legacy, putaway_deadline_at, is_overdue)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,0)`,
    [bc, containerType, productId, warehouseId, locationId,
     batchNo, mfgDate || null, expDate || null, unit,
     initialQty, initialQty, containerStatus,
     detailRefType, sid, sourceRefNo, inboundTaskId, inboundTaskItemId ?? null, remark,
     sourceType,
     deadline]
  )
  return { containerId: r.insertId, barcode: bc }
}

/**
 * 取「商品+仓库」维度锁 —— 上架类操作的加锁顺序基准。
 *
 * 任何「先改自己那一只容器、再汇总该维度全部容器刷新缓存」的流程，都必须先调用它。
 * 否则两个并发上架的加锁顺序天然相反：A 持有自己容器的行锁去请求包含 B 的汇总范围锁，
 * B 反之，必然成环死锁（实测 8 并发挂掉 5）。而如果为了绕开死锁干脆不给汇总加锁，
 * 就会退化成丢失更新：两个上架员各自只汇总到自己那半边（对方的 UPDATE 尚未提交），
 * 后写的一方直接覆盖先写的——实测 8 只各 10 件的容器上架完，缓存只剩 50（实际 80），
 * 30 件库存凭空消失且无任何报错。两条路都不可接受，唯一正解是统一加锁顺序。
 *
 * 锁定范围取 status IN (ACTIVE, PENDING_PUTAWAY)：既覆盖汇总要读的在库容器，
 * 也覆盖调用方即将转正的那只待上架容器，使后续的单容器 FOR UPDATE 变成同事务重入。
 * 代价是同一「商品+仓库」的上架会串行化——这正是保证汇总正确所必需的，
 * 不同商品或不同仓库之间互不影响。
 */
async function lockStockDimension(conn, productId, warehouseId) {
  // 串行化点选 inventory_stock 的单行，而不是「该维度的一批容器行」。
  // 试过后者，仍然死锁：上架会把容器的 status 由 4 改成 1，在 idx_container_hot 里
  // 相当于从 status=4 段迁到 status=1 段，于是每个事务都在持有一段范围锁的同时
  // 去请求另一段的插入意向锁——间隙锁彼此兼容、插入意向锁却与间隙锁冲突，照样成环。
  // 换成单行锁后，等待方手里不持有任何容器锁，构不成环。
  //
  // 先做一次 no-op upsert 确保该行存在：若行不存在就直接 FOR UPDATE，
  // 空结果集上的加锁会退化成间隙锁，两个事务锁住相邻间隙再各自插入，反而制造新死锁。
  await conn.query(
    `INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved)
     VALUES (?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE product_id = product_id`,
    [productId, warehouseId],
  )
  await conn.query(
    'SELECT quantity FROM inventory_stock WHERE product_id = ? AND warehouse_id = ? FOR UPDATE',
    [productId, warehouseId],
  )
}

/**
 * 待上架容器在同一事务内转为在库并刷新缓存（盘点盘盈、导入等非调拨/退货路径）
 */
async function promotePendingContainerToActive(conn, containerId, productId, warehouseId) {
  // 必须先取维度锁再改状态，理由见 lockStockDimension 注释
  await lockStockDimension(conn, productId, warehouseId)
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

  // 加行锁读取可动用的 ACTIVE 容器，FEFO 优先（有效期的先到期先出，无效期回退 FIFO），
  // 同时读取批次信息供调拨保留使用。
  //
  // 必须排除已被拣货任务锁定的容器（locked_by_task_id IS NOT NULL）：这些货在物理上
  // 已经被拣出货架、放进料箱或分拣区，只能由持锁任务经 deductFromTaskLockedContainers 扣减。
  // 调拨/盘点/手动出库等路径若从这里把它们扣走，持锁任务出库时会撞上
  // 「本任务锁定容器可用量不足」而永久卡在待出库——货就在料箱里，系统却拒绝出库，
  // 仓库现场无法自解（审计 P1-1）。上层的 available = quantity - reserved 挡不住这种情况：
  // 采购退货任务同样会锁容器，却完全不产生 reserved。
  const [containers] = await conn.query(
    `SELECT id, barcode, remaining_qty, unit, batch_no, mfg_date, exp_date
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL
       AND locked_by_task_id IS NULL
     ORDER BY (exp_date IS NULL) ASC, exp_date ASC, created_at ASC, id ASC
     FOR UPDATE`,
    [productId, warehouseId]
  )

  const totalAvailable = containers.reduce((s, c) => s + Number(c.remaining_qty), 0)
  if (totalAvailable < absQty) {
    // 被任务占用的量要单独说明，否则用户在库存页明明看到有货、这里却报库存不足，无从判断
    const [[lockedRow]] = await conn.query(
      `SELECT COALESCE(SUM(remaining_qty), 0) AS lockedQty
       FROM inventory_containers
       WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL
         AND locked_by_task_id IS NOT NULL`,
      [productId, warehouseId],
    )
    const lockedQty = Number(lockedRow?.lockedQty || 0)
    throw new AppError(
      `商品「${productName}」可动用容器库存不足，当前可用 ${totalAvailable}，需要 ${absQty}` +
      (lockedQty > 0
        ? `（另有 ${lockedQty} 正被拣货任务占用，需等该任务出库或取消后才会释放）`
        : ''),
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
      // 批次信息（供调拨调入仓库创建容器时保留）
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
     ORDER BY (exp_date IS NULL) ASC, exp_date ASC, created_at ASC, id ASC
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
  // 仅汇总指定商品+仓库维度，禁止全表扫描。
  //
  // 汇总本身必须持锁（FOR UPDATE），并发的 sync 才会在容器行上串行化。
  // 原实现把 `SELECT id FROM inventory_stock ... FOR UPDATE` 放在 SUM **之后**，
  // 那时汇总结果已经读完，锁保护不了任何东西：两个上架员同时上架同一商品的不同容器时，
  // 各自都只汇总到自己那半边（对方的 UPDATE 尚未提交），后写的一方直接覆盖先写的，
  // inventory_stock.quantity 就此与容器实际总和脱节——而这个字段是全系统的库存缓存。
  // 那条语句还有第二个副作用：stock 行不存在时（某商品首次入库）FOR UPDATE 会加间隙锁，
  // 两个事务同时首次入库相邻商品即可死锁。
  //
  // 改为让 SUM 持锁后，上述两个问题一并消除；配合迁移 131 的 idx_container_hot，
  // 锁范围收敛在「该商品+仓库的在库容器」这一精确区间内，不会波及 EMPTY 历史行。
  // 加锁顺序对所有调用方都是同一区间，不构成环，因此不会引入新的死锁。
  const [[{ total }]] = await conn.query(
    `SELECT COALESCE(SUM(remaining_qty), 0) AS total
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL
     FOR UPDATE`,
    [productId, warehouseId]
  )
  const qty = Number(total)

  // INSERT ... ON DUPLICATE KEY UPDATE 自带行锁且写入的是重算后的绝对值（非增量），
  // 在上面的容器锁保护下已经足够，无需再对 inventory_stock 单独预加锁。
  await conn.query(
    `INSERT INTO inventory_stock (product_id, warehouse_id, quantity)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE quantity=?`,
    [productId, warehouseId, qty, qty]
  )
  return qty
}

async function getStockProjection(conn, {
  productId,
  warehouseId,
  lock = false,
}) {
  if (lock) {
    // 统一加锁顺序：先锁 inventory_stock 维度单行、再锁 ACTIVE 容器行，与 lockStockDimension/
    // moveStock 一致。否则本函数是「先容器后 stock」，与出库(moveStock)/上架(lockStockDimension)
    // 的「先 stock 后容器」相反，reserve/调拨/导入 与 出库/上架 并发同一商品会 ABBA 死锁。
    await lockStockDimension(conn, productId, warehouseId)
  }
  const containerLockSql = lock ? ' FOR UPDATE' : ''
  const [containerRows] = await conn.query(
    `SELECT remaining_qty
     FROM inventory_containers
     WHERE product_id = ? AND warehouse_id = ? AND status = ? AND deleted_at IS NULL${containerLockSql}`,
    [productId, warehouseId, CONTAINER_STATUS.ACTIVE],
  )
  const quantity = containerRows.reduce((sum, row) => sum + Number(row.remaining_qty), 0)

  const stockLockSql = lock ? ' FOR UPDATE' : ''
  const [[stockRow]] = await conn.query(
    `SELECT COALESCE(quantity, 0) AS quantity, COALESCE(reserved, 0) AS reserved
     FROM inventory_stock
     WHERE product_id = ? AND warehouse_id = ?${stockLockSql}`,
    [productId, warehouseId],
  )
  const reserved = Number(stockRow?.reserved ?? 0)

  return {
    quantity,
    reserved,
    available: Math.max(0, quantity - reserved),
  }
}

/**
 * 业务判定型库存读取：
 * - quantity 基于 ACTIVE 容器事实层汇总
 * - reserved 基于 inventory_stock 的受控 projection
 * - 用于 reserve / transfer available check 等关键判断
 */
async function getAvailableStockForDecision(conn, params) {
  return getStockProjection(conn, params)
}

/**
 * 调拨容器操作：调出仓库 FIFO 扣减 → 调入仓库创建（保留批次）→ 双仓同步
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
  // 1. 基于事实层容器读取调出仓库当前库存，并锁定相关容器/预占行。
  const sourceProjection = await getStockProjection(conn, {
    productId,
    warehouseId: fromWarehouseId,
    lock: true,
  })
  const fromBefore = sourceProjection.quantity
  const reserved = sourceProjection.reserved

  // 2. 读调入仓库当前事实库存（用于日志 before_qty）
  const targetProjection = await getStockProjection(conn, {
    productId,
    warehouseId: toWarehouseId,
    lock: false,
  })
  const toBefore = targetProjection.quantity

  // 3. 可用库存校验（不允许调拨预占库存）
  const available = sourceProjection.available
  if (available < qty) {
    throw new AppError(
      `调拨失败：商品「${productName}」可用库存不足，` +
      `实际库存 ${fromBefore}，已预占 ${reserved}，可用 ${available}，需要 ${qty}`,
      400
    )
  }

  // 4. FIFO 扣减调出仓库容器（同时携带批次信息）
  const deducted = await deductFromContainers(conn, {
    productId, productName, warehouseId: fromWarehouseId, qty,
  })

  // 5. 在调入仓库按批次创建对应容器
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

  // 序列号管控商品（文档04 Phase3b · C）：盘点差异会「盘盈建容器(无SN)」或「盘亏扣容器(不删SN)」，
  // 都破坏「容器 remaining == 在库SN台数」不变量；且哪几台盈/亏需现场逐台核对（扫每台SN比对），
  // 盘盈的新 SN 来源也需业务口径。故序列号商品的盘点差异暂不走自动盘盈盘亏——挡住以防静默不一致
  // （旧行为是不挡→静默破不变量），完整 SN 级盘点作后续专项。
  if (Math.abs(Number(diffQty)) > 1e-9) {
    const { isSerialManaged } = require('./serialEngine')
    if (await isSerialManaged(conn, productId)) {
      throw new AppError(`序列号管控商品「${productName}」盘点差异需逐台核对处理，暂不支持自动盘盈盘亏`, 400, 'SERIAL_STOCKCHECK_UNSUPPORTED')
    }
  }

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
  respectReserved = true,
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
    // 出库方向：默认校验可用库存（已扣除销售预留），防止把被销售单预留的库存扣走导致超卖。
    // 采购退货、手动出库等走此路径；如确需绕过（极少数场景）可显式传 respectReserved=false。
    if (respectReserved) {
      const { available } = await getStockProjection(conn, { productId, warehouseId, lock: true })
      if (available < Math.abs(qty)) {
        throw new AppError(
          `商品「${productName}」可用库存不足（已扣除销售预留占用），无法出库：可用 ${available}，需要 ${Math.abs(qty)}`,
          400,
        )
      }
    }
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
 * @param {object} [options]
 * @param {number} [options.expectedProductId]
 * @param {number} [options.expectedWarehouseId]
 * @param {string} [options.expectedBarcode]
 * @param {number} [options.minRemainingQty]
 * @param {number} [options.expectedStatus]
 */
async function lockContainer(conn, containerId, taskId, options = {}) {
  const {
    expectedProductId,
    expectedWarehouseId,
    expectedBarcode,
    minRemainingQty,
    expectedStatus = CONTAINER_STATUS.ACTIVE,
  } = options
  const conditions = [
    'id = ?',
    'deleted_at IS NULL',
    '(locked_by_task_id IS NULL OR locked_by_task_id = ?)',
  ]
  const params = [containerId, taskId]

  if (expectedProductId != null) {
    conditions.push('product_id = ?')
    params.push(expectedProductId)
  }
  if (expectedWarehouseId != null) {
    conditions.push('warehouse_id = ?')
    params.push(expectedWarehouseId)
  }
  if (expectedBarcode != null) {
    conditions.push('barcode = ?')
    params.push(expectedBarcode)
  }
  if (minRemainingQty != null) {
    conditions.push('remaining_qty >= ?')
    params.push(minRemainingQty)
  }
  if (expectedStatus != null) {
    conditions.push('status = ?')
    params.push(expectedStatus)
  }

  const [result] = await conn.query(
    `UPDATE inventory_containers
     SET locked_by_task_id = ?, locked_at = NOW()
     WHERE ${conditions.join(' AND ')}`,
    [taskId, ...params],
  )
  if (result.affectedRows === 0) {
    throw new AppError('容器不满足拣货锁定条件，可能已被其它任务锁定或库存/商品/仓库/条码不匹配', 409)
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
async function splitContainer(conn, { containerId, qty, remark = null, targetContainerId = null, serialNos = null }) {
  const cid = Number(containerId)
  const q = Number(qty)
  const tid = targetContainerId != null ? Number(targetContainerId) : null
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
  if (q > rem) throw new AppError('拆分数量不能超过剩余数量', 400)

  // 序列号管控商品（文档04 Phase3b）：拆分须由现场逐台扫「要拆出的具体台」的 SN，迁移由
  // moveSerialsOnSplit 按名单执行（不能任取，否则台账与物理不符，将来该台出库扫码报 CONTAINER_MISMATCH）。
  // 未传 serialNos（或数量不符）则拒绝、提示扫码。引擎间懒加载避免顶层 require 顺序耦合。
  const { isSerialManaged: isSerialMgd, moveSerialsOnSplit } = require('./serialEngine')
  const serialProduct = await isSerialMgd(conn, row.product_id)
  if (serialProduct && (!Array.isArray(serialNos) || serialNos.length !== q)) {
    throw new AppError('序列号商品拆分须逐台扫描要拆出的序列号（数量须与拆分数量一致）', 400, 'SERIAL_SPLIT_NEEDS_SCAN')
  }

  // 转入已有塑料盒
  if (tid) {
    const [[target]] = await conn.query(
      `SELECT id, barcode, product_id, warehouse_id, remaining_qty, status, locked_by_task_id
       FROM inventory_containers
       WHERE id = ? AND barcode LIKE 'B%' AND deleted_at IS NULL
       FOR UPDATE`,
      [tid],
    )
    if (!target) throw new AppError('目标塑料盒不存在', 404)
    if (Number(target.status) !== CONTAINER_STATUS.ACTIVE && Number(target.remaining_qty) !== 0) {
      throw new AppError('目标塑料盒状态异常', 400)
    }
    // 目标容器同样不能处于任务锁定中——源容器上面已挡（第 774 行），目标这里原本漏了。
    // 往被拣货任务锁定的盒子里并货，会让该任务的锁定量凭空增加，出库时按新数量多扣，
    // 且拣货闭合校验只比对容器 ID 集合、发现不了数量变化（审计 P1-2）。
    if (target.locked_by_task_id != null) {
      throw new AppError('目标塑料盒已被拣货任务锁定，不可并入，请另选空盒', 409)
    }
    if (Number(target.product_id) !== Number(row.product_id)) {
      throw new AppError('目标塑料盒绑定产品不匹配', 400)
    }
    if (Number(target.warehouse_id) !== Number(row.warehouse_id)) {
      throw new AppError('目标塑料盒与源容器不在同一仓库，不可合并', 400)
    }

    const newRem = rem - q
    const newStatus = newRem === 0 ? CONTAINER_STATUS.EMPTY : CONTAINER_STATUS.ACTIVE
    await conn.query(
      'UPDATE inventory_containers SET remaining_qty = ?, status = ? WHERE id = ?',
      [newRem, newStatus, cid],
    )

    const targetNewQty = Number(target.remaining_qty) + q
    await conn.query(
      'UPDATE inventory_containers SET remaining_qty = ?, status = 1 WHERE id = ?',
      [targetNewQty, tid],
    )

    // 序列号商品：把扫到的 q 台从源容器迁到目标塑料盒（非序列号 no-op；已在上面校验数量）
    if (serialProduct) {
      await moveSerialsOnSplit(conn, { sourceContainerId: cid, targetContainerId: tid, qty: q, serialNos, warehouseId: row.warehouse_id })
    }

    await syncStockFromContainers(conn, row.product_id, row.warehouse_id)

    return {
      sourceContainerId:   cid,
      sourceBarcode:         row.barcode,
      sourceRemainingAfter:  newRem,
      targetContainerId:     tid,
      targetBarcode:         target.barcode,
      targetQtyAfter:        targetNewQty,
      newContainerId:        tid,
      newBarcode:            target.barcode,
      newContainerKind:      'plastic_box',
      productId:             row.product_id,
      warehouseId:           row.warehouse_id,
    }
  }

  // 创建新塑料盒（原有逻辑）
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

  // 序列号商品：把扫到的 q 台从源容器迁到新塑料盒（非序列号 no-op；已在上面校验数量）
  if (serialProduct) {
    await moveSerialsOnSplit(conn, { sourceContainerId: cid, targetContainerId: newId, qty: q, serialNos, warehouseId: row.warehouse_id })
  }

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

/**
 * 从「已锁定于某任务」的单一容器拆出待归还数量（改单减量专用）
 * 与 splitContainer 的区别：splitContainer 要求源容器必须是未锁定的 ACTIVE 容器
 * （面向普通拆分/转入场景）；本函数专门处理已锁定于任务的容器——拆出的部分继续
 * 锁定在同一任务下，直到 PDA 扫码确认归还库位（confirmContainerReturn）才真正解锁。
 * 若整只容器数量都要归还则无需拆分，直接把该容器整只登记为待归还。
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.taskId
 * @param {number} params.containerId
 * @param {number} params.qty
 * @returns {{ containerId: number, barcode: string, qty: number, wholeContainer: boolean }}
 */
async function splitTaskLockedContainerForReturn(conn, { taskId, containerId, qty }) {
  const [[row]] = await conn.query(
    `SELECT id, barcode, product_id, warehouse_id, location_id, remaining_qty, status,
            locked_by_task_id, batch_no, mfg_date, exp_date, unit
     FROM inventory_containers
     WHERE id = ? AND deleted_at IS NULL
     FOR UPDATE`,
    [containerId],
  )
  if (!row) throw new AppError('容器不存在', 404)
  if (Number(row.locked_by_task_id) !== Number(taskId)) {
    throw new AppError('容器未锁定于该任务，无法拆分归还', 409)
  }
  const rem = Number(row.remaining_qty)
  const q = Number(qty)
  if (!Number.isFinite(q) || q <= 0 || q > rem) throw new AppError('拆分归还数量无效', 400)

  if (q === rem) {
    return { containerId: row.id, barcode: row.barcode, qty: rem, wholeContainer: true }
  }

  const newRem = rem - q
  const newStatus = newRem === 0 ? CONTAINER_STATUS.EMPTY : CONTAINER_STATUS.ACTIVE
  await conn.query(
    'UPDATE inventory_containers SET remaining_qty = ?, status = ? WHERE id = ?',
    [newRem, newStatus, row.id],
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
    sourceRefId:     row.id,
    sourceRefType:   'sale_order_adjustment_return',
    remark:          `改单归还拆分自 ${row.barcode}`,
    barcodePrefix:   'B',
    containerType:   2,
    locationId:      row.location_id,
    containerStatus: CONTAINER_STATUS.ACTIVE,
  })
  // 新容器继续锁定在原任务下，直到 PDA 确认归还库位才解锁，避免拆分瞬间"看起来"可用
  await conn.query(
    'UPDATE inventory_containers SET parent_id = ?, locked_by_task_id = ?, locked_at = NOW() WHERE id = ?',
    [row.id, taskId, newId],
  )

  return { containerId: newId, barcode: newBc, qty: q, wholeContainer: false }
}

/**
 * 在某任务锁定的、指定商品的容器集合里，按 FIFO 拆出合计 qty 的待归还容器清单
 * （改单减量专用，调用方负责把返回的每一项写入 sale_order_adjustment_container_returns）
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.taskId
 * @param {number} params.productId
 * @param {number} params.qty
 * @returns {Array<{ containerId: number, barcode: string, qty: number, wholeContainer: boolean }>}
 */
async function reserveTaskLockedContainersForReturn(conn, { taskId, productId, qty }) {
  let remaining = Number(qty)
  if (!(remaining > 0)) return []
  const [containers] = await conn.query(
    `SELECT id FROM inventory_containers
     WHERE locked_by_task_id = ? AND product_id = ? AND deleted_at IS NULL AND status = ?
     ORDER BY id ASC`,
    [taskId, productId, CONTAINER_STATUS.ACTIVE],
  )
  const picks = []
  for (const c of containers) {
    if (remaining <= 0) break
    const [[fresh]] = await conn.query(
      'SELECT remaining_qty FROM inventory_containers WHERE id = ? FOR UPDATE',
      [c.id],
    )
    const avail = Number(fresh.remaining_qty)
    if (avail <= 0) continue
    const take = Math.min(avail, remaining)
    const split = await splitTaskLockedContainerForReturn(conn, { taskId, containerId: c.id, qty: take })
    picks.push({ ...split, originalContainerId: Number(c.id) })
    remaining -= take
  }
  if (remaining > 0) {
    throw new AppError('任务锁定容器数量不足，无法拆出待归还数量，请核实拣货记录', 409)
  }
  return picks
}

/**
 * PDA 扫码确认归还：解锁指定容器（或其拆分出的部分），写入实际归还库位
 * （改单减量专用，由 warehouse-tasks.adjust.js 的 confirmContainerReturn 调用）
 *
 * @param {object} conn
 * @param {object} params
 * @param {number} params.containerId
 * @param {number} [params.targetLocationId]
 */
async function unlockAndRelocateContainer(conn, { containerId, targetLocationId = null }) {
  const sets = ['locked_by_task_id = NULL', 'locked_at = NULL']
  const params = []
  if (targetLocationId != null) {
    sets.push('location_id = ?')
    params.push(targetLocationId)
  }
  params.push(containerId)
  const [result] = await conn.query(
    `UPDATE inventory_containers SET ${sets.join(', ')} WHERE id = ?`,
    params,
  )
  if (result.affectedRows !== 1) throw new AppError('容器不存在', 404)
}

module.exports = {
  createContainer,
  lockStockDimension,
  promotePendingContainerToActive,
  deductFromContainers,
  deductFromTaskLockedContainers,
  syncStockFromContainers,
  getStockProjection,
  getAvailableStockForDecision,
  transferContainers,
  adjustContainersForStockcheck,
  adjustContainerStock,
  genBarcode,
  lockContainer,
  reserveTaskLockedContainersForReturn,
  unlockAndRelocateContainer,
  unlockContainersByTask,
  splitContainer,
  CONTAINER_STATUS,
  SOURCE_TYPE,
  DIRECT_ACTIVE_SOURCE_TYPES,
}
