const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const { isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { logSideEffectFailure, assertTaskPickScanClosure, assertTaskScope } = require('./warehouse-tasks.helpers')
const { roundQty } = require('../../utils/unitConversion')
const { assertQtyPrecision } = require('../../utils/qtyPrecision')

/**
 * A —— 该明细的**全部有效盒取货量**（含尚未扫标签分拣的那部分）。
 *
 * 口径：`scan_purpose=1`（取货扫码）且 `source_container_id` 非空（这批货确实是从塑料盒里
 * 取出来的）。归属绑定**当前任务**，不认容器上的历史 `source_ref_type`——容器被取消/归还后
 * 可合法作为普通整件再给下一个任务拣，那时它仍是历史取货来源，但已不是新任务的取货标签。
 *
 * **这是旧商品码路径的上限依据**：标签份额在**拣货那一刻**就已确定归属，与有没有扫标签分拣
 * 无关，所以旧码最多只能报 `picked_qty - A`。若拿「已确认标签量 C」当上限，未扫任何标签时
 * 会算成「全都可以由旧码标完」，把标签份额静默吞掉。
 */
async function pickLabelTotalQty(conn, taskId, productId) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(sl.qty), 0) AS total
     FROM scan_logs sl
     JOIN warehouse_task_items wti ON wti.id = sl.item_id AND wti.task_id = sl.task_id
     WHERE sl.task_id = ? AND wti.product_id = ?
       AND COALESCE(sl.scan_purpose, 1) = 1
       AND sl.source_container_id IS NOT NULL`,
    [taskId, productId],
  )
  return roundQty(Number(row.total))
}

/**
 * C —— 该明细**已确认分拣**的取货标签份额。
 *
 * **只用于算总进度** `sorted_qty = 旧码份额 + C`；**不得**拿它当旧商品码的上限（那是 A 的职责）。
 *
 * 口径：`Σ min(sbi.qty, 该容器在本任务的当前有效取货量)`——**有效量必须受当前 PICK 约束**
 *（见函数内的说明）。有效取货量用**按容器聚合的子查询**而不是直接 JOIN `scan_logs`：
 * 同一容器多条 PICK 行时，直接 JOIN 会让 `sbi` 被重复累计、把 C 放大。
 */
async function confirmedPickLabelQty(conn, taskId, productId) {
  // 作业记录 `sbi.qty` 是**历史**值，不会随改单减量收缩（也不该被收缩）。因此这里取
  // **「该容器历史作业量」与「该容器在本任务的当前有效取货量」的较小者**：
  // 减量把 PICK 从 150 压到 100 后，`LEAST(150, 100) = 100`，不会拿历史份额去挤后续补拣；
  // 反过来，正常场景下两者相等，结果与旧口径一致。
  //
  // 有效取货量必须**先按容器聚合再 JOIN**（子查询），否则同一容器多条 PICK 行会让
  // `sbi` 被重复累计、C 被放大。口径与 A（`pickLabelTotalQty`）一致：只认
  // `scan_purpose=1` 且 `source_container_id` 非空——不认容器历史 `source_ref_type`。
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(LEAST(sbi.qty, pc.pick_qty)), 0) AS total
     FROM sorting_bin_items sbi
     INNER JOIN (
       SELECT sl.container_id, COALESCE(SUM(sl.qty), 0) AS pick_qty
       FROM scan_logs sl
       INNER JOIN warehouse_task_items wti ON wti.id = sl.item_id AND wti.task_id = sl.task_id
       WHERE sl.task_id = ? AND wti.product_id = ?
         AND COALESCE(sl.scan_purpose, 1) = 1
         AND sl.source_container_id IS NOT NULL
       GROUP BY sl.container_id
     ) pc ON pc.container_id = sbi.container_id
     WHERE sbi.task_id = ? AND sbi.product_id = ?`,
    [taskId, productId, taskId, productId],
  )
  return roundQty(Number(rows[0].total))
}

/**
 * 取货码分拣项（同一事务内）。把「该取货码容器在本任务的真实取货量」计为该明细的分拣份额。
 *
 * 绝对累计量 = 旧商品码份额 + 已确认标签份额 + 本次份额，并守住 <= picked_qty——
 * 所以连续两张取货码是**相加**，而不是后一张把前一张覆盖掉。容器 remaining_qty 全程不动
 *（分拣不改实存，扣减发生在出库）。
 *
 * **只做校验与作业记录，不写 `warehouse_task_items`**：最终数量由调用方在循环结束后
 * 一次批量 CASE UPDATE 写回（批量写约束，见 AGENTS）。
 */
async function planPickCodeSortItem(conn, { taskRow, taskId, entry, itemMap, seenContainerIds, operatorId, operatorName }) {
  const containerId = Number(entry.containerId)
  if (!Number.isInteger(containerId) || containerId <= 0) {
    throw new AppError('分拣明细无效', 400)
  }
  if (seenContainerIds.has(containerId)) {
    throw new AppError('分拣明细不能重复提交', 400)
  }
  seenContainerIds.add(containerId)

  const binCode = entry.binCode == null ? '' : String(entry.binCode).trim()
  if (!binCode) {
    throw new AppError('缺少实扫分拣格码，请扫分拣格后再确认', 400, 'SORTING_BIN_CODE_REQUIRED')
  }

  // 锁序：任务 → 格位 → 容器。这里**真实锁住分拣格**并复查归属，而不是只比 taskRow 上的快照——
  // 格可能已被主管强制释放并改配给别的任务，只信快照会把货照旧记到已易主的格上。
  const [[bin]] = await conn.query(
    'SELECT id, code, warehouse_id, current_task_id, status FROM sorting_bins WHERE id = ? FOR UPDATE',
    [Number(taskRow.sorting_bin_id)],
  )
  if (!bin) throw new AppError('本任务占用的分拣格已不存在，请联系主管', 409, 'SORTING_BIN_MISSING')
  if (Number(bin.current_task_id) !== Number(taskId)) {
    throw new AppError('该分拣格当前不属于本任务（可能已被重新分配），请刷新后重试', 409, 'SORTING_BIN_NOT_OWNED')
  }
  if (Number(bin.status) !== 2) {
    throw new AppError('该分拣格当前不是占用状态，请刷新后重试', 409, 'SORTING_BIN_NOT_OCCUPIED')
  }
  if (Number(bin.warehouse_id) !== Number(taskRow.warehouse_id)) {
    throw new AppError('分拣格与任务不在同一仓库，无法分拣', 409, 'SORTING_BIN_WAREHOUSE_MISMATCH')
  }
  if (String(bin.code).toUpperCase() !== binCode.toUpperCase()) {
    throw new AppError(`放错格：本任务占用分拣格 ${bin.code}，实扫 ${binCode}`, 409, 'SORTING_BIN_MISMATCH')
  }

  // 先**无锁 peek**：明显不属于本任务的取货码直接拒绝，不要先对它 FOR UPDATE——
  // 那会把别的任务的容器资源锁住（反向扫描他任务码时会拖慢甚至卡住对方）。
  const [[peek]] = await conn.query(
    'SELECT locked_by_task_id FROM inventory_containers WHERE id = ? AND deleted_at IS NULL',
    [containerId],
  )
  if (peek && Number(peek.locked_by_task_id) !== Number(taskId)) {
    throw new AppError('该库存条码不是本任务的取货码，无法分拣', 409, 'PICK_CODE_NOT_IN_TASK')
  }

  // 正式锁行，并在锁到手后**复查**归属（peek 只用来省掉明显的错误锁，不能替代锁后校验）
  const [[c]] = await conn.query(
    `SELECT id, barcode, product_id, locked_by_task_id, warehouse_id
     FROM inventory_containers WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [containerId],
  )
  if (!c) throw new AppError('取货码对应的库存条码不存在', 404, 'PICK_CODE_NOT_FOUND')
  if (Number(c.locked_by_task_id) !== Number(taskId)) {
    throw new AppError(`库存条码 ${c.barcode} 不是本任务的取货码，无法分拣`, 409, 'PICK_CODE_NOT_IN_TASK')
  }
  if (Number(c.warehouse_id) !== Number(taskRow.warehouse_id)) {
    throw new AppError('取货码所属仓库与任务仓库不一致', 409, 'PICK_CODE_WAREHOUSE_MISMATCH')
  }

  const [picks] = await conn.query(
    `SELECT item_id, COALESCE(SUM(qty), 0) AS pick_qty
     FROM scan_logs
     WHERE task_id = ? AND container_id = ?
       AND COALESCE(scan_purpose, 1) = 1
       AND source_container_id IS NOT NULL
     GROUP BY item_id`,
    [taskId, containerId],
  )
  if (!picks.length) {
    throw new AppError(`库存条码 ${c.barcode} 在本任务没有有效的盒取货记录，不能作为取货码分拣`, 409, 'PICK_CODE_NO_PICK_RECORD')
  }
  if (picks.length > 1) {
    throw new AppError('该取货码在本任务对应多条明细，无法确定分拣归属', 409, 'PICK_CODE_AMBIGUOUS')
  }

  const itemId = Number(picks[0].item_id)
  const item = itemMap.get(itemId)
  if (!item) throw new AppError('取货码对应的任务明细不属于当前任务', 409, 'PICK_CODE_ITEM_NOT_IN_TASK')
  if (Number(item.product_id) !== Number(c.product_id)) {
    throw new AppError('取货码上的商品与任务明细不一致', 409, 'PICK_CODE_PRODUCT_MISMATCH')
  }

  const thisQty = roundQty(Number(picks[0].pick_qty))
  const existingLabelQty = await confirmedPickLabelQty(conn, taskId, Number(item.product_id))
  const legacyPortion = roundQty(Math.max(0, Number(item.sorted_qty) - existingLabelQty))
  const nextSortedQty = roundQty(legacyPortion + existingLabelQty + thisQty)
  // 超量**拒绝**而不是截断到 picked：截掉会让「多出来的量去哪了」无从追查
  if (nextSortedQty > Number(item.picked_qty)) {
    throw new AppError(
      `该取货码分拣后将超过已拣数量（已拣 ${Number(item.picked_qty)}，已确认取货标签 ${existingLabelQty}，本次 ${thisQty}），请核对实物`,
      409,
      'PICK_CODE_EXCEEDS_PICKED',
    )
  }

  try {
    await conn.query(
      `INSERT INTO sorting_bin_items
         (bin_id, task_id, container_id, product_id, qty, operator_id, operator_name)
       VALUES (?,?,?,?,?,?,?)`,
      [taskRow.sorting_bin_id, taskId, containerId, Number(c.product_id), thisQty, operatorId || null, operatorName || null],
    )
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      throw new AppError(`取货码 ${c.barcode} 已经分拣过，请勿重复扫描`, 409, 'PICK_CODE_ALREADY_SORTED')
    }
    throw e
  }

  item.sorted_qty = nextSortedQty  // 同一请求内若还有该明细的项，据此继续累计
  return { itemId, nextSortedQty }
}

/**
 * 一次批量写回 `sorted_qty`：按最终数量拼 `CASE id WHEN ? THEN ? ... END`，循环内**不**逐行 UPDATE
 *（批量写约束，见 AGENTS）。传空表示本次没有任何明细需要改——直接跳过，不发 `IN ()` 那种怪语句。
 */
async function flushSortedQty(conn, taskId, qtyByItemId) {
  if (!qtyByItemId.size) return
  const ids = [...qtyByItemId.keys()]
  const cases = ids.map(() => 'WHEN ? THEN ?').join(' ')
  const params = []
  for (const [itemId, qty] of qtyByItemId) params.push(itemId, qty)
  await conn.query(
    `UPDATE warehouse_task_items SET sorted_qty = CASE id ${cases} END WHERE task_id = ? AND id IN (?)`,
    [...params, taskId, ids],
  )
}

/**
 * 分拣完成，自动推进到「待复核」（3→4）
 * 接收已分拣的 item 列表，后端校验全部完成后自动推进
 * @param {number} id - 任务ID
 * @param {Array<{itemId: number, sortedQty: number}>} [sortedItems] - 可选，逐件上报时传入；不传则视为整任务完成
 */
async function sortTaskWithinTransaction(conn, id, sortedItems = null, { requestKey, userId, operatorName = null, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status, sorting_bin_id, sorting_bin_code, cancel_requested_at, adjustment_requested_at, warehouse_id',
    entityName: '仓库任务',
  })
  assertTaskScope(taskRow, { scopeWarehouseIds, pdaWarehouseId })
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在拣货退回中，不可继续分拣', 409)
  }
  if (taskRow.adjustment_requested_at) {
    throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
  }
  // 幂等 begin/replay **必须先于状态规则**：分拣完成会把状态 CAS 成「待复核」，而
  // assertWarehouseTaskAction('sortTask') 只允许「待分拣」——原键重放若被状态规则拦在前面，
  // PDA 丢响应后就永远查不回原回执，只能靠换新键重试（那反而有重复推进风险）。
  // 范围/设备仓、取消闸、改单闸仍在其之前，所以被拒路径拿不到任何回执、也不会留下记录。
  const requestState = await beginResourceOperationRequest(conn, {
    requestKey,
    action: 'warehouse.sort',
    userId: userId || null,
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  if (requestState.replay) {
    return requestState.responseData
  }
  const rule = assertWarehouseTaskAction('sortTask', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  if (!taskRow.sorting_bin_id) {
    throw new AppError('该任务尚未分配分拣格，请联系主管补分配，刷新后重新扫码', 409, 'SORTING_BIN_REQUIRED')
  }

  await assertTaskPickScanClosure(conn, id)

  if (sortedItems != null && !Array.isArray(sortedItems)) {
    throw new AppError('分拣明细格式无效', 400)
  }

  if (Array.isArray(sortedItems)) {
    if (!sortedItems.length) throw new AppError('分拣明细不能为空', 400)
    if (sortedItems.length > 50) throw new AppError('分拣明细数量超出单次上限', 400)
    // 支持边界（第一期）：每个请求只处理**一张取货码**。多于一张时**显式拒绝**，
    // 不依赖「PDA 一次只扫一张」这种隐含假设——批量取货码要先在事务内聚合记录再一次性
    // 批量写入，本期不做。边界记录见 docs/inventory-transaction-invariants.md 的分拣确认口径。
    const pickCodeEntryCount = sortedItems.filter(e => e && e.containerId != null).length
    if (pickCodeEntryCount > 1) {
      throw new AppError('一次只能提交一张取货码，请逐张分拣', 400, 'PICK_CODE_MULTIPLE_NOT_SUPPORTED')
    }
    const [taskItems] = await conn.query(
      'SELECT id, product_id, picked_qty, sorted_qty FROM warehouse_task_items WHERE task_id=? FOR UPDATE',
      [id],
    )
    const itemMap = new Map(taskItems.map(item => [Number(item.id), item]))
    const pendingSortedQty = new Map()   // itemId → 最终 sorted_qty；循环内只算，循环后一次批量写回
    const seenItemIds = new Set()
    const seenContainerIds = new Set()
    for (const entry of sortedItems) {
      // 取货码项：`{ containerId, binCode }`——服务端在同一事务内解析归属与份额
      if (entry && entry.containerId != null) {
        const planned = await planPickCodeSortItem(conn, {
          taskRow, taskId: id, entry, itemMap, seenContainerIds,
          operatorId: userId, operatorName,
        })
        pendingSortedQty.set(planned.itemId, planned.nextSortedQty)
        continue
      }
      const normalizedItemId = Number(entry?.itemId)
      const normalizedSortedQty = Number(entry?.sortedQty)
      if (!Number.isInteger(normalizedItemId) || normalizedItemId <= 0) {
        throw new AppError('分拣明细无效', 400)
      }
      if (seenItemIds.has(normalizedItemId)) {
        throw new AppError('分拣明细不能重复提交', 400)
      }
      seenItemIds.add(normalizedItemId)
      const item = itemMap.get(normalizedItemId)
      if (!item) {
        throw new AppError('分拣明细不属于当前任务', 400)
      }
      const pickedQty = Number(item.picked_qty)
      if (!Number.isFinite(normalizedSortedQty) || normalizedSortedQty < 0) {
        throw new AppError('分拣数量必须为大于或等于 0 的有效数字', 400)
      }
      if (normalizedSortedQty > pickedQty) {
        throw new AppError('分拣数量不能超过已拣数量', 400)
      }
      // 精度校验**原始输入**（最多两位小数 + 整数商品的整数约束），不能先 round 再校验——
      // 那样会把用户填的三位小数静默舍入掉，账面与实际就此分叉。
      await assertQtyPrecision(conn, [{ productId: Number(item.product_id), qty: normalizedSortedQty, label: '分拣数量' }])
      // 旧商品码只能标**未被盒取货标签占走**的那部分已拣量：上限 = picked - A（A 含尚未分拣的标签）。
      // 超限直接拒绝，不用 Math.min 静默夹成满量——夹掉会把「标签份额被旧码吞掉」这件事掩盖过去。
      const labelTotalQty = await pickLabelTotalQty(conn, id, Number(item.product_id))
      const legacyLimitQty = roundQty(pickedQty - labelTotalQty)
      if (normalizedSortedQty > legacyLimitQty) {
        throw new AppError(
          `分拣数量超过旧商品码可标的份额（已拣 ${pickedQty}，取货标签已占 ${labelTotalQty}，最多可报 ${legacyLimitQty}）`,
          400,
        )
      }
      // 绝对累计量 = 旧码份额 + **已确认**标签份额 C ⇒ 两种来源互不覆盖
      const confirmedLabelQty = await confirmedPickLabelQty(conn, id, Number(item.product_id))
      const nextSortedQty = roundQty(normalizedSortedQty + confirmedLabelQty)
      item.sorted_qty = nextSortedQty
      pendingSortedQty.set(normalizedItemId, nextSortedQty)
    }
    await flushSortedQty(conn, id, pendingSortedQty)
  } else {
    // 整任务完成同样按份额写：旧商品码份额 = picked - A（未标签部分全部由旧码标完），
    // 再加**已确认**标签份额 C。**不**用无条件 `SET sorted_qty = picked_qty`——那会把
    // 「已拣、但取货标签还没扫」的量一并算作已分拣，任务会在标签未扫时分拣完成。
    // 注意不是恒等式：未扫任何标签时结果只有 picked - A，任务不会因此推进。
    const [allItems] = await conn.query(
      'SELECT id, product_id, picked_qty FROM warehouse_task_items WHERE task_id=? FOR UPDATE',
      [id],
    )
    const pendingSortedQty = new Map()
    for (const item of allItems) {
      const labelTotalQty = await pickLabelTotalQty(conn, id, Number(item.product_id))
      const confirmedLabelQty = await confirmedPickLabelQty(conn, id, Number(item.product_id))
      const legacyPortion = roundQty(Math.max(0, Number(item.picked_qty) - labelTotalQty))
      pendingSortedQty.set(Number(item.id), roundQty(legacyPortion + confirmedLabelQty))
    }
    // 一次批量写回（空集时 flushSortedQty 直接跳过），不再逐行 UPDATE
    await flushSortedQty(conn, id, pendingSortedQty)
  }

  const [updatedItems] = await conn.query(
    'SELECT picked_qty, sorted_qty FROM warehouse_task_items WHERE task_id=?',
    [id],
  )
  const allSorted = updatedItems.every(i => Number(i.sorted_qty) >= Number(i.picked_qty))
  if (!allSorted) {
    const done = updatedItems.filter(i => Number(i.sorted_qty) >= Number(i.picked_qty)).length
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: taskRow.task_no,
        eventType: WT_EVENT.SORT_PROGRESS,
        detail: { done, total: updatedItems.length, progress: `${done}/${updatedItems.length}` },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：分拣进度事件', eventErr, {
        taskId: id,
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.SORT_PROGRESS,
      })
    }
    const capacityWarning = await sortingBinSvc.checkCapacityWarning(conn, taskRow.sorting_bin_id)
    const payload = { allSorted: false, progress: `${done}/${updatedItems.length}`, warning: capacityWarning?.message ?? null }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: `分拣进度 ${payload.progress}，继续操作`,
      resourceType: 'warehouse_task',
      resourceId: id,
    })
    return payload
  }

  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
  })

  // 分拣格在此不释放：货物未装箱前会一直放在分拣格里，要到打包完成
  // （packDoneWithinTransaction）才真正离开分拣格。这里提前释放会导致分拣格
  // 在"分拣完成→打包完成"这段窗口期被系统当作空闲重新分配给别的任务，造成混货。
  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SORT_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      detail: { itemCount: updatedItems.length },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：分拣完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.SORT_DONE,
    })
  }

  const payload = { allSorted: true }
  await completeOperationRequest(conn, requestState, {
    data: payload,
    message: '分拣完成，已进入待复核',
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  return payload
}

async function sortTask(id, sortedItems = null, { requestKey, userId, operatorName = null, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await sortTaskWithinTransaction(conn, id, sortedItems, { requestKey, userId, operatorName, scopeWarehouseIds, pdaWarehouseId })
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

module.exports = {
  sortTask,
  sortTaskWithinTransaction,
}
