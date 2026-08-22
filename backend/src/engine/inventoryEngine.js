/**
 * Inventory Movement Engine — 库存变动引擎（最终收敛版）
 *
 * ─── Phase 5 架构规则 ───────────────────────────────────────────────────────
 *
 * 所有库存变动类型均已迁移至容器路径，inventory_stock 仅作缓存：
 *
 *   PURCHASE_IN   → purchase.service.receive()       createContainer + sync
 *   SALE_OUT      → moveStock()（本函数，路径B）       deductFromContainers + sync
 *   TASK_OUT      → moveStock()（本函数，路径B）       deductFromContainers + sync
 *   TRANSFER_OUT  → transfer.service.execute()        transferContainers
 *   TRANSFER_IN   → transfer.service.execute()        transferContainers
 *   STOCKCHECK    → stockcheck.service.submit()       adjustContainersForStockcheck
 *   PURCHASE_RET  → warehouse-tasks.service.ship()（PDA出库，isPurchaseReturn）moveStock
 *   SALE_RET      → return-tasks.service（PDA收货建容器+质检+上架）        createContainer/syncStockFromContainers
 *   MANUAL_IN     → inventory.service.changeStock()   adjustContainerStock
 *   MANUAL_OUT    → inventory.service.changeStock()   adjustContainerStock
 *   DISPOSAL      → disposal.service.dispose()        adjustContainerStock
 *
 * moveStock() 只负责 SALE_OUT + TASK_OUT 两条容器出库路径。
 * 所有其他类型调用 moveStock() 时将抛出 500 错误（防止误调用）。
 *
 * ─── 不变量 ─────────────────────────────────────────────────────────────────
 *  1. inventory_stock.quantity = SUM(container.remaining_qty WHERE status=1)
 *  2. 禁止任何代码直接 UPDATE inventory_stock SET quantity=...
 *  3. 所有操作必须在调用方已开启的事务连接中运行
 */

const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const { markFulfilled } = require('./reservationEngine')
const { deductFromContainers, deductFromTaskLockedContainers, syncStockFromContainers } = require('./containerEngine')

/**
 * 变动类型常量（对应 inventory_logs.move_type）
 */
const MOVE_TYPE = {
  PURCHASE_IN:  1,   // → purchase.service（容器引擎）
  SALE_OUT:     2,   // → moveStock 路径B
  STOCKCHECK:   3,   // → stockcheck.service（容器引擎）
  TRANSFER_OUT: 4,   // → transfer.service（容器引擎）
  TRANSFER_IN:  5,   // → transfer.service（容器引擎）
  PURCHASE_RET: 6,   // → returns-purchase.service（容器引擎）
  SALE_RET:     7,   // → returns-sale.service（容器引擎）
  TASK_OUT:     8,   // → moveStock 路径B
  MANUAL_IN:    9,   // → inventory.service（容器引擎）
  MANUAL_OUT:   10,  // → inventory.service（容器引擎）
  RECEIPT_VOID: 11,  // → inbound-tasks.void.js（撤回收货，容器引擎）
  // 容器拆分/并货：库存总量不变，只是货在容器之间转移，所以写 type=3（调整）而非 1/2。
  // 全站按 type 统计的地方（dashboard:49、reports.query:124/806、inventory.aging:73）都只看
  // type=1/2，不会被这类记录污染；而按 container_id 查流水的地方（塑料盒详情、库存流水页）
  // 正需要它们——在此之前拆分与并货完全没有留痕，追溯到容器这一层就断了。
  CONTAINER_SPLIT: 12, // → containerEngine.splitContainer
  DISPOSAL:        13, // → disposal.service.dispose()（呆滞处置出库，adjustContainerStock）
}

const MOVE_TYPE_LABEL = {
  1:  '采购入库',     2:  '销售出库',     3:  '盘点调整',
  4:  '调拨出',       5:  '调拨入',       6:  '采购退货出库',
  7:  '销售退货入库', 8:  '仓库任务出库',
  9:  '手动入库',     10: '手动出库',     11: '入库撤回',
  12: '容器拆分',  13: '呆滞处置出库',
}

/**
 * 已完全迁移到容器引擎的类型集合——调用 moveStock() 时直接抛错
 */
const MIGRATED_TYPES = new Set([
  MOVE_TYPE.PURCHASE_IN,
  MOVE_TYPE.TRANSFER_OUT,
  MOVE_TYPE.TRANSFER_IN,
  MOVE_TYPE.STOCKCHECK,
  MOVE_TYPE.PURCHASE_RET,
  MOVE_TYPE.SALE_RET,
  MOVE_TYPE.MANUAL_IN,
  MOVE_TYPE.MANUAL_OUT,
])

const MIGRATED_GUIDE = {
  [MOVE_TYPE.PURCHASE_IN]:  'purchase.service.receive()（createContainer + sync）',
  [MOVE_TYPE.TRANSFER_OUT]: 'transfer.service.execute()（transferContainers）',
  [MOVE_TYPE.TRANSFER_IN]:  'transfer.service.execute()（transferContainers）',
  [MOVE_TYPE.STOCKCHECK]:   'stockcheck.service.submit()（adjustContainersForStockcheck）',
  [MOVE_TYPE.PURCHASE_RET]: 'warehouse-tasks.service.ship()（PDA出库，moveStock）',
  [MOVE_TYPE.SALE_RET]:     'return-tasks.service（PDA收货/质检/上架，createContainer）',
  [MOVE_TYPE.MANUAL_IN]:    'inventory.service.changeStock()（adjustContainerStock）',
  [MOVE_TYPE.MANUAL_OUT]:   'inventory.service.changeStock()（adjustContainerStock）',
}

/**
 * 执行容器出库库存变动（仅处理 SALE_OUT + TASK_OUT）
 *
 * 流程：
 *   1. 读 before（用于日志）
 *   2. FIFO 扣减容器 remaining_qty
 *   3. syncStockFromContainers → 刷新 inventory_stock 缓存
 *   4. 减少 reserved + 标记预占履行
 *   5. 安全收敛（reserved ≤ on_hand）
 *   6. 写 inventory_logs
 *
 * @param {object} conn          - 已开启事务的 mysql2 连接
 * @param {object} params
 * @param {number} params.moveType           - SALE_OUT(2) 或 TASK_OUT(8)
 * @param {number} params.productId
 * @param {string} [params.productName]
 * @param {number} params.warehouseId
 * @param {number} params.qty                - 出库数量（正数）
 * @param {number} [params.unitPrice]
 * @param {number} [params.supplierId]
 * @param {string} params.refType
 * @param {number} params.refId
 * @param {string} params.refNo
 * @param {string} [params.remark]
 * @param {number} params.operatorId
 * @param {string} params.operatorName
 * @param {string} [params.reservationRefType]
 * @param {number} [params.reservationRefId]
 * @param {number} [params.lockedByTaskId] - 若传入则仅从 locked_by_task_id 匹配的容器扣减（销售任务出库）
 *
 * @returns {{ before: number, after: number }}
 * @throws {AppError} 库存不足 / 类型已迁移
 */
async function moveStock(conn, {
  moveType, productId, productName = '该商品', warehouseId,
  qty, unitPrice = null, supplierId = null,
  refType, refId, refNo,
  remark = null, operatorId, operatorName,
  reservationRefType = null, reservationRefId = null,
  lockedByTaskId = null,
}) {
  // ── 拦截所有已迁移类型，防止误调用 ─────────────────────────────────────────
  if (MIGRATED_TYPES.has(moveType)) {
    const guide = MIGRATED_GUIDE[moveType] ?? '对应的 service 方法'
    throw new AppError(
      `moveType=${moveType}（${MOVE_TYPE_LABEL[moveType]}）已迁移至容器路径，` +
      `请通过 ${guide} 处理，禁止直接调用 moveStock()`,
      500
    )
  }

  // ── 容器出库路径（SALE_OUT + TASK_OUT）──────────────────────────────────────
  if (moveType === MOVE_TYPE.SALE_OUT || moveType === MOVE_TYPE.TASK_OUT) {
    // 1. 读当前缓存量（before_qty 供日志使用；reserved 供收敛截断探测）
    const [[stockRow]] = await conn.query(
      'SELECT quantity, reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=? FOR UPDATE',
      [productId, warehouseId]
    )
    const before = stockRow ? Number(stockRow.quantity) : 0
    const reservedBefore = stockRow ? Number(stockRow.reserved) : 0

    // 2. 容器扣减：任务出库且指定 lockedByTaskId 时仅扣本任务锁定容器，否则 FIFO
    const absQty = Math.abs(qty)
    const deducted = lockedByTaskId
      ? await deductFromTaskLockedContainers(conn, {
        productId, productName, warehouseId, qty: absQty, taskId: lockedByTaskId,
      })
      : await deductFromContainers(conn, { productId, productName, warehouseId, qty: absQty })

    // 3. 汇总容器 → 刷新 inventory_stock 缓存
    const after = await syncStockFromContainers(conn, productId, warehouseId)

    // 4. 减少 reserved + 按本次出库量核销预占（截断即告警——出库量大于 reserved 说明预占计数已漂移）
    //
    // reserved 扣减必须与 markFulfilled 同处一个条件下。采购退货出库（warehouse-tasks.ship.js
    // 对 isPurchaseReturn 显式传 reservationRefType=null）本身不携带任何预占，若在条件外无条件
    // 扣减，会把同商品同仓下其它销售单的预占凭空释放掉：可用量虚高 → 别的订单占走同一批货 →
    // 原订单拣货时货已不在 → 超卖。且事后 releaseByRef 的 GREATEST(0,...) 会把痕迹抹平，
    // 根因无从追查（审计 P0-1）。无预占的出库只依赖第 5 步的全局收敛兜底。
    const hasReservation = Boolean(reservationRefType && reservationRefId)
    if (hasReservation) {
      if (reservedBefore < absQty) {
        logger.error(
          '[GUARD] reserved 收敛截断：出库释放预占时 reserved 小于出库量',
          null,
          { moveType, productId, warehouseId, refNo, shipQty: absQty, reserved: reservedBefore },
          'StockClampGuard',
        )
      }
      await conn.query(
        'UPDATE inventory_stock SET reserved=GREATEST(0, reserved-?) WHERE product_id=? AND warehouse_id=?',
        [absQty, productId, warehouseId],
      )
      await markFulfilled(conn, reservationRefType, reservationRefId, productId, warehouseId, absQty)
    }

    // 5. 安全收敛：reserved 不得超过 on_hand（同样先探测再收敛，触发即告警）
    //    无预占出库（如采购退货）不改 reserved，此处以出库前的值参与判断——若它已超过出库后的
    //    在库量，说明物理库存已不足以支撑在册预占，收敛的同时必须告警：这是超卖的直接信号。
    const reservedAfterRelease = hasReservation ? Math.max(0, reservedBefore - absQty) : reservedBefore
    if (reservedAfterRelease > after) {
      logger.error(
        '[GUARD] reserved 收敛截断：释放后 reserved 仍大于在库量，已压到在库量',
        null,
        { moveType, productId, warehouseId, refNo, reserved: reservedAfterRelease, quantity: after },
        'StockClampGuard',
      )
    }
    await conn.query(
      'UPDATE inventory_stock SET reserved=LEAST(reserved, quantity) WHERE product_id=? AND warehouse_id=? AND reserved > quantity',
      [productId, warehouseId]
    )

    // 6. 写日志（按实际扣减容器分行记录，便于追溯 container_id）
    const logRemark = remark || `${MOVE_TYPE_LABEL[moveType]} ${refNo}`
    const logSourceType = lockedByTaskId ? 'sale_task' : refType
    const logSourceRefId = lockedByTaskId ? lockedByTaskId : refId

    if (lockedByTaskId && deducted.length > 1) {
      let runningBefore = before
      for (const d of deducted) {
        const chunkAfter = runningBefore - d.taken
        await writeInventoryLog(conn, {
          moveType, type: 2,
          productId, warehouseId, supplierId,
          quantity: d.taken, beforeQty: runningBefore, afterQty: chunkAfter, unitPrice,
          refType, refId, refNo,
          containerId: d.containerId, sourceType: logSourceType, sourceRefId: logSourceRefId,
          remark: logRemark, operatorId, operatorName,
        })
        runningBefore = chunkAfter
      }
    } else {
      const primaryContainerId = deducted[0]?.containerId ?? null
      await writeInventoryLog(conn, {
        moveType, type: 2,
        productId, warehouseId, supplierId,
        quantity: absQty, beforeQty: before, afterQty: after, unitPrice,
        refType, refId, refNo,
        containerId: primaryContainerId, sourceType: logSourceType, sourceRefId: logSourceRefId,
        remark: logRemark, operatorId, operatorName,
      })
    }

    return { before, after }
  }

  // ── 未知类型兜底 ─────────────────────────────────────────────────────────
  throw new AppError(
    `未知的 moveType: ${moveType}，请检查调用方是否传入了正确的 MOVE_TYPE 常量`,
    500
  )
}

/**
 * 统一写库存流水（2026-08-22 DRY 收敛）：此前 8 处模块各自手写 16 列 INSERT，
 * 列序/取值漂移风险高。所有写流水的调用方改走本函数。
 *
 * @param {object} conn 事务连接
 * @param {object} log {
 *   moveType,        // MOVE_TYPE 常量（inventory_logs.move_type）
 *   type,            // 1=入库方向 2=出库方向（inventory_logs.type）
 *   productId, warehouseId,
 *   quantity, beforeQty, afterQty,
 *   supplierId,       // 可空（inventory_logs.supplier_id，手动出库用）
 *   unitPrice,        // 可空（inventory_logs.unit_price，处置/手动出库用）
 *   refType, refId, refNo,
 *   containerId,      // 可空
 *   sourceType, sourceRefId,   // log_source_type/log_source_ref_id
 *   remark, operatorId, operatorName
 * }
 */
async function writeInventoryLog(conn, {
  moveType, type,
  productId, warehouseId,
  quantity, beforeQty, afterQty,
  supplierId = null, unitPrice = null,
  refType, refId, refNo,
  containerId = null,
  sourceType, sourceRefId,
  remark, operatorId, operatorName,
}) {
  await conn.query(
    `INSERT INTO inventory_logs
       (move_type, type, product_id, warehouse_id, supplier_id,
        quantity, before_qty, after_qty, unit_price,
        ref_type, ref_id, ref_no,
        container_id, log_source_type, log_source_ref_id,
        remark, operator_id, operator_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      moveType, type,
      Number(productId), Number(warehouseId),
      supplierId != null ? Number(supplierId) : null,
      Number(quantity), beforeQty != null ? Number(beforeQty) : null, afterQty != null ? Number(afterQty) : null,
      unitPrice != null ? Number(unitPrice) : null,
      refType || null, refId != null ? Number(refId) : null, refNo || null,
      containerId != null ? Number(containerId) : null,
      sourceType || null, sourceRefId != null ? Number(sourceRefId) : null,
      remark || null, operatorId != null ? Number(operatorId) : null, operatorName || null,
    ],
  )
}

module.exports = { moveStock, writeInventoryLog, MOVE_TYPE, MOVE_TYPE_LABEL }
