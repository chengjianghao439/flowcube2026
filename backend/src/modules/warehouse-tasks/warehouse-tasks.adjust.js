const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { reserve, partialReleaseByProduct } = require('../../engine/reservationEngine')
const { reserveTaskLockedContainersForReturn, unlockAndRelocateContainer } = require('../../engine/containerEngine')
const { WT_STATUS, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { logSideEffectFailure, assertTaskScope } = require('./warehouse-tasks.helpers')
const { scopeFilter } = require('../../utils/warehouseScope')

const QTY_EPS = 1e-6

/**
 * 按 FIFO 从某容器的拣货扫码记录（scan_purpose=1）里扣减 qty，扣到 0 的行整条删除。
 * 改单归还确认后调用：容器部分归还时，原容器仍锁定于任务但 remaining_qty 已经变小，
 * 其历史拣货扫码记录必须同步下调，否则后续复核扫码按旧的拣货扫码合计计算会与降低
 * 后的 picked_qty 对不上（"复核累计将超过拣货数量"）；容器整只归还时 qty 等于该
 * 容器全部扫码量，效果等同于把对应记录整条删除，与该容器已解锁、不再属于本任务的
 * 事实保持一致。
 */
async function reducePickScanLogForContainer(conn, { taskId, itemId, containerId, qty }) {
  let remaining = Number(qty)
  if (!(remaining > 0)) return
  const [rows] = await conn.query(
    `SELECT id, qty FROM scan_logs
     WHERE task_id=? AND item_id=? AND container_id=? AND scan_purpose=1
     ORDER BY id ASC FOR UPDATE`,
    [taskId, itemId, containerId],
  )
  for (const r of rows) {
    if (remaining <= QTY_EPS) break
    const rowQty = Number(r.qty)
    const take = Math.min(rowQty, remaining)
    if (take >= rowQty - QTY_EPS) {
      await conn.query('DELETE FROM scan_logs WHERE id=?', [r.id])
    } else {
      await conn.query('UPDATE scan_logs SET qty = qty - ? WHERE id=?', [take, r.id])
    }
    remaining -= take
  }
}

/**
 * 处理单个 product 的净变化（改单核心，逐 product 调用）。
 *
 * 调用方（sale.service.requestAdjustment）已在同一事务内锁定 warehouse_tasks 行，
 * 并对每个受影响 product 依次调用本函数；本函数只负责单个 product 的
 * warehouse_task_items / 预占 / 容器 / 箱子的分层处理，不做任务状态跃迁——
 * 调用方收集所有 product 的返回结果后统一决定任务状态是否需要回退
 * （见 finalizeTaskStatusAfterAdjustment）。
 *
 * 分流规则见 docs 中的方案说明：
 *   增量 → reserve 追加 + required_qty 上调，标记需要回退拣货中补拣
 *   减量 → 三层从浅到深吸收：①未拣部分直接下调 ②已打包部分先作废箱子腾容量
 *          ③物理归还库位（PDA确认后才真正生效），标记需要回退待复核重新走复核/打包
 */
async function applyProductDeltaWithinTransaction(conn, {
  taskId, warehouseId, saleOrderId, saleOrderNo,
  productId, productCode, productName, unit,
  articleNumber = null, spec = null, color = null,
  oldRequiredQty, newRequiredQty,
}) {
  const delta = Number(newRequiredQty) - Number(oldRequiredQty)
  if (Math.abs(delta) < QTY_EPS) return null

  const [[existingItem]] = await conn.query(
    `SELECT id, required_qty, picked_qty, sorted_qty, checked_qty
     FROM warehouse_task_items WHERE task_id=? AND product_id=? FOR UPDATE`,
    [taskId, productId],
  )

  // ── 增量分支 ──
  if (delta > 0) {
    await reserve(conn, {
      productId, productName, warehouseId, qty: delta,
      refType: 'sale_order', refId: saleOrderId, refNo: saleOrderNo,
    })
    if (existingItem) {
      await conn.query(
        'UPDATE warehouse_task_items SET required_qty = required_qty + ? WHERE id=?',
        [delta, existingItem.id],
      )
    } else {
      await conn.query(
        `INSERT INTO warehouse_task_items (task_id,product_id,product_code,product_name,unit,article_number,spec,color,required_qty,picked_qty)
         VALUES (?,?,?,?,?,?,?,?,?,0)`,
        [taskId, productId, productCode, productName, unit, articleNumber || null, spec || null, color || null, delta],
      )
    }
    return {
      productId, productCode, productName,
      oldRequiredQty: Number(oldRequiredQty), newRequiredQty: Number(newRequiredQty),
      pendingReturnQty: 0, pendingPickQty: delta,
      packageVoids: [], containerReturns: [],
      needsReopenPicking: true, needsReopenChecking: false,
      itemStatus: 3, // 无需物理动作（走现有拣货流程，不进待确认队列）
    }
  }

  // ── 减量分支 ──
  if (!existingItem) {
    throw new AppError(`商品「${productName}」不在当前仓库任务明细中，无法减少`, 400)
  }
  let reduceQty = -delta
  const pickedQty = Number(existingItem.picked_qty)
  const checkedQtyBefore = Number(existingItem.checked_qty)

  // 第①层：未拣部分，直接下调，无需实物动作
  const unpickedBuffer = Math.max(0, Number(existingItem.required_qty) - pickedQty)
  const layer1 = Math.min(reduceQty, unpickedBuffer)
  reduceQty -= layer1

  if (reduceQty <= QTY_EPS) {
    await conn.query(
      'UPDATE warehouse_task_items SET required_qty = required_qty - ? WHERE id=?',
      [layer1, existingItem.id],
    )
    await partialReleaseByProduct(conn, {
      refType: 'sale_order', refId: saleOrderId, productId, warehouseId, qty: layer1,
    })
    return {
      productId, productCode, productName,
      oldRequiredQty: Number(oldRequiredQty), newRequiredQty: Number(newRequiredQty),
      pendingReturnQty: 0, pendingPickQty: 0,
      packageVoids: [], containerReturns: [],
      needsReopenPicking: false, needsReopenChecking: false,
      itemStatus: 3,
    }
  }

  // 第③层：若「已拣未打包」的余量不够吸收剩余 reduceQty，先作废足够的已完成箱子腾出容量
  const [[{ packedUnits }]] = await conn.query(
    `SELECT COALESCE(SUM(pi.qty),0) AS packedUnits FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id=? AND pi.product_id=? AND p.status != 3`,
    [taskId, productId],
  )
  const freePickedNotPacked = Math.max(0, pickedQty - Number(packedUnits))

  const packageVoids = []
  if (reduceQty > freePickedNotPacked + QTY_EPS) {
    // 懒加载：packages.service.js 顶层 require 了聚合器 warehouse-tasks.service.js（用于
    // assertTaskCheckScanClosure 等闭环校验），聚合器又 require 本文件——顶层互相 require
    // 会在其中一方尚未跑完时拿到不完整的 exports，故在函数体内延迟加载打破循环。
    const packagesSvc = require('../packages/packages.service')
    let needFromPacked = reduceQty - freePickedNotPacked
    const [candidatePackages] = await conn.query(
      `SELECT p.id AS package_id, p.barcode,
              (SELECT qty FROM package_items WHERE package_id=p.id AND product_id=?) AS target_qty
       FROM packages p
       WHERE p.warehouse_task_id=? AND p.status=2
         AND EXISTS (SELECT 1 FROM package_items WHERE package_id=p.id AND product_id=?)
       ORDER BY p.id ASC`,
      [productId, taskId, productId],
    )
    for (const pkg of candidatePackages) {
      if (needFromPacked <= QTY_EPS) break
      const [otherItems] = await conn.query(
        `SELECT product_id, product_code, product_name, unit, qty
         FROM package_items WHERE package_id=? AND product_id != ?`,
        [pkg.package_id, productId],
      )
      await packagesSvc.voidCompletedPackage(conn, pkg.package_id, {
        reason: `改单调整：商品「${productName}」数量变更`,
      })
      packageVoids.push({
        packageId: Number(pkg.package_id),
        barcode: pkg.barcode,
        otherProducts: otherItems.map(o => ({
          productId: Number(o.product_id), productCode: o.product_code,
          productName: o.product_name, unit: o.unit, qty: Number(o.qty),
        })),
      })
      needFromPacked -= Number(pkg.target_qty)
    }
  }

  // 第②层：物理归还库位——从任务锁定的容器里按 FIFO 拆出 reduceQty，
  // 登记待确认队列，PDA 扫码确认目标库位后才真正解锁+释放预占。
  const containerReturns = reduceQty > QTY_EPS
    ? await reserveTaskLockedContainersForReturn(conn, { taskId, productId, qty: reduceQty })
    : []

  // required_qty 立即下调到新目标（防止继续朝旧目标复核/打包）；checked_qty 清零——
  // 无论物理是否已挪动，数量变了就必须重新复核。picked_qty/sorted_qty/预占的最终释放
  // 留给 PDA 确认全部归还后的 finalize（见 checkAdjustmentClearedAndFinalize）。
  await conn.query(
    'UPDATE warehouse_task_items SET required_qty = ?, checked_qty = 0 WHERE id=?',
    [Number(newRequiredQty), existingItem.id],
  )
  // 同步清掉该明细行既有的复核扫码记录（scan_purpose=2）——不清的话，scan-logs.service.js
  // 的复核扫码会拿"该容器已完成复核扫码"（历史扫码合计已等于旧checked_qty）挡住重新复核，
  // 造成 checked_qty 清零了却永远无法重新扫码通过的死锁。
  await conn.query(
    'DELETE FROM scan_logs WHERE task_id=? AND item_id=? AND scan_purpose=2',
    [taskId, existingItem.id],
  )

  return {
    productId, productCode, productName,
    oldRequiredQty: Number(oldRequiredQty), newRequiredQty: Number(newRequiredQty),
    pendingReturnQty: reduceQty, pendingPickQty: 0,
    packageVoids, containerReturns,
    needsReopenPicking: false, needsReopenChecking: true,
    itemStatus: 1, // 待确认
    hadCheckedQty: checkedQtyBefore > QTY_EPS,
  }
}

/**
 * 所有 product 处理完后，统一决定任务状态是否需要回退，并执行一次状态迁移。
 * 优先级：任何 product 需要补拣 → 回退拣货中(2)；否则任何 product 命中待确认
 * 队列/清零复核 → 回退待复核(4)；否则任务状态不变。
 */
async function finalizeTaskStatusAfterAdjustment(conn, { taskId, taskNo, descriptors }) {
  const needsReopenPicking = descriptors.some(d => d && d.needsReopenPicking)
  const needsReopenChecking = descriptors.some(d => d && d.needsReopenChecking)
  if (!needsReopenPicking && !needsReopenChecking) return null

  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks', id: taskId,
    columns: 'id, task_no, status, sorting_bin_id, sorting_bin_code',
    entityName: '仓库任务',
  })

  const action = needsReopenPicking ? 'adjustReopenPicking' : 'adjustReopenChecking'
  const targetStatus = needsReopenPicking ? WT_STATUS.PICKING : WT_STATUS.CHECKING
  // 任务当前已经在目标阶段或更早的阶段（比如补拣需求发生在任务还没离开拣货中时），
  // 根本不构成"回退"，直接跳过——WT_ACTION_RULES 里这两条内部 action 的 allowed
  // 范围只覆盖"比目标阶段更靠后"的状态，若在这里仍调用 assertWarehouseTaskAction
  // 会因为当前状态不在 allowed 列表里而误抛异常，把一次单纯的增量/减量请求搞崩。
  if (Number(taskRow.status) <= targetStatus) return null

  const rule = assertWarehouseTaskAction(action, taskRow.status)

  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks', id: taskId,
    fromStatus: taskRow.status, toStatus: rule.toStatus,
    entityName: '仓库任务',
  })
  try {
    await recordEvent(conn, {
      taskId, taskNo: taskNo || taskRow.task_no,
      eventType: WT_EVENT.ADJUSTMENT_REOPENED,
      fromStatus: taskRow.status, toStatus: rule.toStatus,
      detail: { reason: 'sale_order_adjustment', action },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：改单回退状态事件', eventErr, { taskId, action })
  }
  return { fromStatus: Number(taskRow.status), toStatus: rule.toStatus }
}

/**
 * PDA「改单确认」任务池：列出所有正在改单收尾中（adjustment_requested_at 非空）的任务，
 * 每条附带待确认拆箱/归还项数量。
 */
async function listPendingAdjustments(warehouseId, scopeWarehouseIds = null) {
  // 与主列表 findAll 同口径接入用户仓库数据范围：受限用户只看授权仓库的待改单任务
  const scope = scopeFilter(scopeWarehouseIds, 'wt.warehouse_id')
  const [rows] = await pool.query(
    `SELECT wt.id, wt.task_no, wt.customer_name, wt.warehouse_id, wt.warehouse_name,
            wt.status, wt.adjustment_requested_at,
            soa.id AS adjustment_id, soa.adjustment_no,
            (SELECT COUNT(*) FROM sale_order_adjustment_container_returns r
               INNER JOIN sale_order_adjustment_items i ON i.id = r.adjustment_item_id
              WHERE i.adjustment_id = soa.id AND r.status = 1) AS containerReturnsRemaining,
            (SELECT COUNT(*) FROM sale_order_adjustment_package_voids v
               INNER JOIN sale_order_adjustment_items i ON i.id = v.adjustment_item_id
              WHERE i.adjustment_id = soa.id AND v.status = 1) AS packageVoidsRemaining
       FROM warehouse_tasks wt
       INNER JOIN sale_order_adjustments soa ON soa.warehouse_task_id = wt.id AND soa.status = 1
      WHERE wt.adjustment_requested_at IS NOT NULL
        AND wt.deleted_at IS NULL
        ${warehouseId ? 'AND wt.warehouse_id = ?' : ''}${scope.sql}
      ORDER BY wt.adjustment_requested_at ASC`,
    [...(warehouseId ? [warehouseId] : []), ...scope.params],
  )
  return rows.map(r => ({
    id: Number(r.id),
    taskNo: r.task_no,
    customerName: r.customer_name,
    warehouseId: Number(r.warehouse_id),
    warehouseName: r.warehouse_name,
    status: Number(r.status),
    adjustmentRequestedAt: r.adjustment_requested_at,
    adjustmentId: Number(r.adjustment_id),
    adjustmentNo: r.adjustment_no,
    containerReturnsRemaining: Number(r.containerReturnsRemaining),
    packageVoidsRemaining: Number(r.packageVoidsRemaining),
  }))
}

/** 改单确认详情：待拆箱箱子 + 待归还容器，供 PDA 逐项扫码确认 */
async function getAdjustmentDetail(adjustmentId, scopeWarehouseIds = null) {
  const [[adj]] = await pool.query(
    `SELECT soa.*, wt.task_no, wt.warehouse_name, wt.customer_name, wt.warehouse_id
       FROM sale_order_adjustments soa
       INNER JOIN warehouse_tasks wt ON wt.id = soa.warehouse_task_id
      WHERE soa.id = ?`,
    [adjustmentId],
  )
  if (!adj) throw new AppError('改单记录不存在', 404)
  assertTaskScope(adj, { scopeWarehouseIds })

  const [items] = await pool.query(
    'SELECT * FROM sale_order_adjustment_items WHERE adjustment_id=?',
    [adjustmentId],
  )
  const itemIds = items.map(i => i.id)
  let voids = []
  let returns = []
  if (itemIds.length) {
    ;[voids] = await pool.query(
      `SELECT * FROM sale_order_adjustment_package_voids WHERE adjustment_item_id IN (?) ORDER BY id ASC`,
      [itemIds],
    )
    ;[returns] = await pool.query(
      `SELECT r.*, c.barcode AS container_barcode, c.remaining_qty AS container_remaining_qty,
              c.product_id AS container_product_id,
              loc.code AS suggested_location_code
         FROM sale_order_adjustment_container_returns r
         LEFT JOIN inventory_containers c ON c.id = r.source_container_id
         LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
        WHERE r.adjustment_item_id IN (?) ORDER BY r.id ASC`,
      [itemIds],
    )
  }

  return {
    id: Number(adj.id),
    adjustmentNo: adj.adjustment_no,
    status: Number(adj.status),
    saleOrderId: Number(adj.sale_order_id),
    warehouseTaskId: Number(adj.warehouse_task_id),
    taskNo: adj.task_no,
    warehouseName: adj.warehouse_name,
    customerName: adj.customer_name,
    items: items.map(i => ({
      id: Number(i.id),
      productId: Number(i.product_id),
      productCode: i.product_code,
      productName: i.product_name,
      oldRequiredQty: Number(i.old_required_qty),
      newRequiredQty: Number(i.new_required_qty),
      pendingReturnQty: Number(i.pending_return_qty),
      pendingPickQty: Number(i.pending_pick_qty),
      status: Number(i.status),
      packageVoids: voids.filter(v => Number(v.adjustment_item_id) === Number(i.id)).map(v => ({
        id: Number(v.id),
        packageId: Number(v.package_id),
        barcode: v.barcode,
        otherProductsSnapshot: v.other_products_snapshot
          ? (typeof v.other_products_snapshot === 'string' ? JSON.parse(v.other_products_snapshot) : v.other_products_snapshot)
          : [],
        status: Number(v.status),
      })),
      containerReturns: returns.filter(r => Number(r.adjustment_item_id) === Number(i.id)).map(r => ({
        id: Number(r.id),
        containerId: Number(r.source_container_id),
        barcode: r.container_barcode,
        qty: Number(r.qty),
        suggestedLocationCode: r.suggested_location_code || null,
        status: Number(r.status),
        containerRemainingQty: r.container_remaining_qty != null ? Number(r.container_remaining_qty) : null,
      })),
    })),
  }
}

/**
 * PDA 扫码确认拆箱：仅做procedural确认（箱子本身在改单发起时已作废），
 * 确认后检查该改单是否已全部清零。
 */
async function confirmPackageVoid(voidId, { operator, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[voidRow]] = await conn.query(
      `SELECT v.id, wt.warehouse_id
       FROM sale_order_adjustment_package_voids v
       INNER JOIN sale_order_adjustment_items i ON i.id = v.adjustment_item_id
       INNER JOIN sale_order_adjustments soa ON soa.id = i.adjustment_id
       INNER JOIN warehouse_tasks wt ON wt.id = soa.warehouse_task_id
       WHERE v.id=? AND v.status=1 FOR UPDATE`,
      [voidId],
    )
    if (!voidRow) throw new AppError('该拆箱项不存在或已确认', 409)
    assertTaskScope(voidRow, { scopeWarehouseIds, pdaWarehouseId })
    const [result] = await conn.query(
      `UPDATE sale_order_adjustment_package_voids
       SET status=2, confirmed_by=?, confirmed_by_name=?, confirmed_at=NOW()
       WHERE id=? AND status=1`,
      [operator?.userId ?? null, operator?.realName ?? null, voidId],
    )
    if (result.affectedRows !== 1) throw new AppError('该拆箱项不存在或已确认', 409)
    const [[row]] = await conn.query(
      `SELECT i.adjustment_id FROM sale_order_adjustment_package_voids v
       INNER JOIN sale_order_adjustment_items i ON i.id = v.adjustment_item_id
       WHERE v.id=?`,
      [voidId],
    )
    const outcome = await checkAdjustmentClearedAndFinalize(conn, Number(row.adjustment_id), { operator })
    await conn.commit()
    return outcome
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * PDA 扫码确认归还：解锁容器（写入目标库位），确认后检查该改单是否已全部清零。
 *
 * 仓库侧不能有决策权，只能执行——与取消逆向归还（scan-logs.service.js 的
 * createCancelReturnScanLog）同一口径，必须扫回容器当前登记的库位（即拆分时继承
 * 自原容器的库位），不允许操作员自选目标库位，否则账面库位和实物摆放位置会脱节。
 */
async function confirmContainerReturn(returnId, { targetLocationId = null, operator, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[ret]] = await conn.query(
      `SELECT r.*, wt.warehouse_id
       FROM sale_order_adjustment_container_returns r
       INNER JOIN sale_order_adjustment_items i ON i.id = r.adjustment_item_id
       INNER JOIN sale_order_adjustments soa ON soa.id = i.adjustment_id
       INNER JOIN warehouse_tasks wt ON wt.id = soa.warehouse_task_id
       WHERE r.id=? FOR UPDATE`,
      [returnId],
    )
    if (!ret) throw new AppError('该归还项不存在', 404)
    assertTaskScope(ret, { scopeWarehouseIds, pdaWarehouseId })
    if (Number(ret.status) !== 1) throw new AppError('该归还项已确认，无需重复操作', 400)

    const [[container]] = await conn.query(
      'SELECT id, barcode, location_id, product_id, remaining_qty, locked_by_task_id FROM inventory_containers WHERE id=? FOR UPDATE',
      [ret.source_container_id],
    )
    if (!container) throw new AppError('容器不存在', 404)
    // 归还库位强校验：必须扫回容器当前登记的原库位（拆分出的新容器继承同一库位，故先按源容器校验再拆分）。
    if (container.location_id == null || Number(targetLocationId) !== Number(container.location_id)) {
      const [[originalLoc]] = container.location_id
        ? await conn.query('SELECT code FROM warehouse_locations WHERE id=?', [container.location_id])
        : [[null]]
      throw new AppError(
        originalLoc ? `必须放回原库位 ${originalLoc.code}，不能放到其它库位` : '该容器原库位信息缺失，无法归还，请联系管理员',
        400,
      )
    }

    const returnedContainerId = Number(ret.source_container_id)
    await unlockAndRelocateContainer(conn, {
      containerId: returnedContainerId,
      targetLocationId,
    })
    // 部分拆分后归还的是新容器：把 source_container_id 校准到实际归还的容器；
    // original_container_id 不动，仍指向源容器供下调拣货扫码用。
    await conn.query(
      `UPDATE sale_order_adjustment_container_returns
       SET status=2, source_container_id=?, target_location_id=?, confirmed_by=?, confirmed_by_name=?, confirmed_at=NOW()
       WHERE id=?`,
      [returnedContainerId, targetLocationId, operator?.userId ?? null, operator?.realName ?? null, returnId],
    )
    const [[row]] = await conn.query(
      `SELECT i.adjustment_id FROM sale_order_adjustment_container_returns r
       INNER JOIN sale_order_adjustment_items i ON i.id = r.adjustment_item_id
       WHERE r.id=?`,
      [returnId],
    )
    const outcome = await checkAdjustmentClearedAndFinalize(conn, Number(row.adjustment_id), { operator })
    await conn.commit()
    return outcome
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 逐 adjustment_item 检查其待确认项是否清零：若清零，把该 product 的
 * picked_qty/sorted_qty 降到 new_required_qty，并按 pendingReturnQty 部分释放预占，
 * 该 item 状态转为已完成。全部 item 都完成后，整个改单转已完成、任务
 * adjustment_requested_at 清空，并按需回退到待复核(4)（若任务当前仍是
 * 更靠后的状态——正常不会，因为回退在 requestAdjustment 时已经做过一次；
 * 这里兜底处理任务在挂起期间被并发操作改变状态的极端情况不做处理，
 * 只清空标记，不重复触发状态迁移）。
 */
async function checkAdjustmentClearedAndFinalize(conn, adjustmentId, { operator } = {}) {
  const [[adj]] = await conn.query(
    'SELECT * FROM sale_order_adjustments WHERE id=? FOR UPDATE',
    [adjustmentId],
  )
  if (!adj) throw new AppError('改单记录不存在', 404)
  if (Number(adj.status) !== 1) return { finalized: true, alreadyFinalized: true }

  const [items] = await conn.query(
    'SELECT * FROM sale_order_adjustment_items WHERE adjustment_id=? FOR UPDATE',
    [adjustmentId],
  )

  let allItemsDone = true
  for (const item of items) {
    if (Number(item.status) !== 1) continue // 已完成或无需物理动作
    const [[{ pendingVoids }]] = await conn.query(
      'SELECT COUNT(*) AS pendingVoids FROM sale_order_adjustment_package_voids WHERE adjustment_item_id=? AND status=1',
      [item.id],
    )
    const [[{ pendingReturns }]] = await conn.query(
      'SELECT COUNT(*) AS pendingReturns FROM sale_order_adjustment_container_returns WHERE adjustment_item_id=? AND status=1',
      [item.id],
    )
    if (Number(pendingVoids) > 0 || Number(pendingReturns) > 0) {
      allItemsDone = false
      continue
    }

    // 该 product 的待确认项已全部清零：真正把 picked_qty/sorted_qty 降到新目标，释放预占
    const [[taskRow]] = await conn.query(
      'SELECT warehouse_id FROM warehouse_tasks WHERE id=?',
      [adj.warehouse_task_id],
    )
    await partialReleaseByProduct(conn, {
      refType: 'sale_order', refId: adj.sale_order_id, productId: item.product_id,
      warehouseId: Number(taskRow.warehouse_id), qty: Number(item.pending_return_qty),
    })
    await conn.query(
      `UPDATE warehouse_task_items
       SET picked_qty = ?, sorted_qty = LEAST(sorted_qty, ?)
       WHERE task_id=? AND product_id=?`,
      [Number(item.new_required_qty), Number(item.new_required_qty), adj.warehouse_task_id, item.product_id],
    )
    await conn.query(
      `UPDATE sale_order_items soi SET reserved_qty = (
         SELECT COALESCE(SUM(sr.qty), 0) FROM stock_reservations sr
         WHERE sr.ref_type='sale_order' AND sr.ref_id=soi.order_id
           AND sr.product_id=soi.product_id AND sr.warehouse_id=soi.warehouse_id AND sr.status=1
       ) WHERE soi.order_id=? AND soi.product_id=? AND soi.warehouse_id=?`,
      [adj.sale_order_id, item.product_id, Number(taskRow.warehouse_id)],
    )
    // 已归还容器对应的原容器（可能是被拆分的原容器，也可能是整只被归还的容器本身）
    // 同步下调拣货扫码记录，见 reducePickScanLogForContainer 顶部说明。
    const [returnedContainers] = await conn.query(
      `SELECT original_container_id, qty FROM sale_order_adjustment_container_returns
       WHERE adjustment_item_id=? AND status=2`,
      [item.id],
    )
    if (returnedContainers.length) {
      const [[taskItemRow]] = await conn.query(
        'SELECT id FROM warehouse_task_items WHERE task_id=? AND product_id=?',
        [adj.warehouse_task_id, item.product_id],
      )
      if (taskItemRow) {
        for (const rc of returnedContainers) {
          await reducePickScanLogForContainer(conn, {
            taskId: adj.warehouse_task_id, itemId: taskItemRow.id,
            containerId: Number(rc.original_container_id), qty: Number(rc.qty),
          })
        }
      }
    }
    await conn.query('UPDATE sale_order_adjustment_items SET status=2 WHERE id=?', [item.id])
  }

  if (!allItemsDone) return { finalized: false }

  await conn.query(
    'UPDATE sale_order_adjustments SET status=2, completed_at=NOW() WHERE id=?',
    [adjustmentId],
  )
  await conn.query(
    'UPDATE warehouse_tasks SET adjustment_requested_at=NULL WHERE id=?',
    [adj.warehouse_task_id],
  )
  try {
    const [[taskRow]] = await conn.query('SELECT task_no FROM warehouse_tasks WHERE id=?', [adj.warehouse_task_id])
    await recordEvent(conn, {
      taskId: Number(adj.warehouse_task_id),
      taskNo: taskRow?.task_no || '',
      eventType: WT_EVENT.ADJUSTMENT_FINALIZED,
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      detail: { adjustmentId: Number(adjustmentId), adjustmentNo: adj.adjustment_no },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：改单收尾完成事件', eventErr, {
      taskId: Number(adj.warehouse_task_id), adjustmentId: Number(adjustmentId),
    })
  }
  return { finalized: true }
}

module.exports = {
  applyProductDeltaWithinTransaction,
  finalizeTaskStatusAfterAdjustment,
  listPendingAdjustments,
  getAdjustmentDetail,
  confirmPackageVoid,
  confirmContainerReturn,
  checkAdjustmentClearedAndFinalize,
}
