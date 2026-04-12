const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { moveStock, MOVE_TYPE } = require('../../engine/inventoryEngine')
const { unlockContainersByTask } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const { WT_STATUS, WT_STATUS_NAME, WT_STATUS_PICK_POOL, isValidTransition } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')

const TASK_STATUS = WT_STATUS_NAME
const PRIORITY    = { 1:'紧急',   2:'普通',   3:'低优先级' }

/**
 * 拣货闭环：已拣满 + 扫码合计与 picked_qty 一致 + 锁定容器集合与拣货扫码容器一致
 */
async function assertTaskPickScanClosure(conn, taskId) {
  const [items] = await conn.query(
    'SELECT id, required_qty, picked_qty FROM warehouse_task_items WHERE task_id=?',
    [taskId],
  )
  for (const row of items) {
    if (Number(row.picked_qty) !== Number(row.required_qty)) {
      throw new AppError(`拣货未完成：存在未拣满明细（需 ${row.required_qty}，已拣 ${row.picked_qty}）`, 400)
    }
    const [[agg]] = await conn.query(
      `SELECT COALESCE(SUM(qty),0) AS sq FROM scan_logs
       WHERE task_id=? AND item_id=? AND COALESCE(scan_purpose,1)=1`,
      [taskId, row.id],
    )
    if (Number(agg.sq) !== Number(row.picked_qty)) {
      throw new AppError('拣货扫码合计与明细已拣数量不一致，无法推进', 400)
    }
  }
  const [locked] = await conn.query(
    'SELECT id FROM inventory_containers WHERE locked_by_task_id=? AND deleted_at IS NULL',
    [taskId],
  )
  const [pickedContainers] = await conn.query(
    `SELECT DISTINCT container_id AS cid FROM scan_logs
     WHERE task_id=? AND COALESCE(scan_purpose,1)=1`,
    [taskId],
  )
  const lockedIds = new Set(locked.map(r => r.id))
  const pickIds = new Set(pickedContainers.map(r => r.cid))
  if (lockedIds.size !== pickIds.size) {
    throw new AppError('锁定容器与拣货扫码容器不一致：每个锁定容器必须完成拣货扫码', 400)
  }
  for (const id of lockedIds) {
    if (!pickIds.has(id)) throw new AppError('存在未经拣货扫码的锁定容器', 400)
  }
  for (const id of pickIds) {
    if (!lockedIds.has(id)) throw new AppError('拣货扫码中的容器必须全部锁定于本任务', 400)
  }
}

/**
 * 复核闭环：checked_qty === picked_qty，且复核扫码合计与 checked_qty 一致
 */
async function assertTaskCheckScanClosure(conn, taskId) {
  const [items] = await conn.query(
    'SELECT id, picked_qty, required_qty, checked_qty FROM warehouse_task_items WHERE task_id=?',
    [taskId],
  )
  for (const row of items) {
    const p = Number(row.picked_qty)
    const ch = Number(row.checked_qty)
    if (p !== Number(row.required_qty)) {
      throw new AppError('出库前置：存在未拣满明细', 400)
    }
    if (ch !== p) {
      throw new AppError('出库前置：复核未完成（已核须等于拣货数量）', 400)
    }
    const [[agg]] = await conn.query(
      `SELECT COALESCE(SUM(qty),0) AS sq FROM scan_logs
       WHERE task_id=? AND item_id=? AND scan_purpose=2`,
      [taskId, row.id],
    )
    if (Number(agg.sq) !== ch) {
      throw new AppError('复核扫码合计与已核数量不一致', 400)
    }
  }
}

/** 打包闭环：全部箱子已完成，且存在装箱明细 */
async function assertTaskPackagingClosure(conn, taskId) {
  const [[{ open }]] = await conn.query(
    `SELECT COUNT(*) AS open FROM packages WHERE warehouse_task_id=? AND status <> 2`,
    [taskId],
  )
  if (Number(open) > 0) {
    throw new AppError('存在未完成的装箱，请先完成全部箱子打包', 400)
  }
  const [[{ cnt }]] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ? AND p.status = 2`,
    [taskId],
  )
  if (Number(cnt) === 0) {
    throw new AppError('没有已完成的装箱明细，无法进入待出库', 400)
  }
}

const fmt = r => ({
  id: r.id,
  taskNo: r.task_no,
  saleOrderId: r.sale_order_id,
  saleOrderNo: r.sale_order_no,
  customerId: r.customer_id,
  customerName: r.customer_name,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  status: r.status,
  statusName: TASK_STATUS[r.status],
  priority: r.priority,
  priorityName: PRIORITY[r.priority],
  assignedTo: r.assigned_to || null,
  assignedName: r.assigned_name || null,
  expectedShipDate: r.expected_ship_date,
  remark: r.remark,
  sortingBinId:   r.sorting_bin_id   || null,
  sortingBinCode: r.sorting_bin_code || null,
  shippedAt: r.shipped_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const genTaskNo = conn => generateDailyCode(conn, 'WT', 'warehouse_tasks', 'task_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null, warehouseId=null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['deleted_at IS NULL', '(task_no LIKE ? OR customer_name LIKE ? OR sale_order_no LIKE ?)']
  const params = [like, like, like]
  if (status)      { conds.push('status=?');       params.push(status) }
  if (warehouseId) { conds.push('warehouse_id=?'); params.push(warehouseId) }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(`SELECT * FROM warehouse_tasks WHERE ${where} ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM warehouse_tasks WHERE ${where}`, params)
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL', [id])
  if (!rows[0]) throw new AppError('仓库任务不存在', 404)
  const task = fmt(rows[0])
  const inboundThresholds = await getInboundClosureThresholds()
  const [items] = await pool.query('SELECT * FROM warehouse_task_items WHERE task_id=?', [id])
  task.items = items.map(r => ({
    id: r.id,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    unit: r.unit,
    requiredQty: Number(r.required_qty),
    pickedQty: Number(r.picked_qty),
    checkedQty: Number(r.checked_qty ?? 0),
  }))

  const [packageRows] = await pool.query(
    `SELECT id, status
     FROM packages
     WHERE warehouse_task_id = ?
     ORDER BY created_at ASC`,
    [id],
  )
  const [packageItemAgg] = await pool.query(
    `SELECT COALESCE(SUM(pi.qty), 0) AS total_items
     FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ?`,
    [id],
  )
  task.packageSummary = {
    totalPackages: packageRows.length,
    openPackages: packageRows.filter(row => Number(row.status) !== 2).length,
    donePackages: packageRows.filter(row => Number(row.status) === 2).length,
    totalItems: Number(packageItemAgg?.[0]?.total_items || 0),
  }

  const [printRows] = await pool.query(
    `SELECT
        j.status,
        j.updated_at,
        j.error_message,
        pr.code AS printer_code,
        pr.name AS printer_name
     FROM packages p
     LEFT JOIN (
       SELECT j1.*
       FROM print_jobs j1
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j1.id
     ) j ON j.ref_id = p.id AND j.ref_type = 'package'
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE p.warehouse_task_id = ?`,
    [id],
  )
  task.printSummary = {
    totalPackages: packageRows.length,
    successCount: 0,
    failedCount: 0,
    timeoutCount: 0,
    processingCount: 0,
    recentError: null,
    recentPrinter: null,
  }
  for (const row of printRows) {
    const status = Number(row.status)
    if (status === 2) task.printSummary.successCount += 1
    else if (status === 3) task.printSummary.failedCount += 1
    else if ((status === 0 || status === 1) && row.updated_at && (Date.now() - new Date(row.updated_at).getTime()) >= Number(inboundThresholds.printTimeoutMinutes) * 60 * 1000) task.printSummary.timeoutCount += 1
    else if (status === 0 || status === 1) task.printSummary.processingCount += 1
    if (!task.printSummary.recentError && row.error_message) task.printSummary.recentError = row.error_message
    if (!task.printSummary.recentPrinter && (row.printer_code || row.printer_name)) task.printSummary.recentPrinter = row.printer_code || row.printer_name
  }
  return task
}

/**
 * 由销售单确认时自动调用，在事务外部创建任务（使用 pool）
 * 创建后自动为任务分配一个空闲分拣格
 * status=2 拣货中（跳过待拣货，直接可拣）
 */
async function createForSaleOrder({ saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName, items, conn: extConn }) {
  const useConn = extConn || pool
  const taskNo = await genTaskNo(useConn)
  const [r] = await useConn.query(
    `INSERT INTO warehouse_tasks (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,priority) VALUES (?,?,?,?,?,?,?,${WT_STATUS.PICKING},2)`,
    [taskNo, saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName]
  )
  const taskId = r.insertId
  for (const item of items) {
    await useConn.query(
      `INSERT INTO warehouse_task_items (task_id,product_id,product_code,product_name,unit,required_qty,picked_qty) VALUES (?,?,?,?,?,?,0)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.quantity]
    )
  }
  // 自动分配分拣格（无空闲格时忽略，不阻断任务创建）
  // 注意：assignToTask 内部已使用 FOR UPDATE 行锁，保证原子性
  // 若分配部分失败，需回滚分拣格占用，避免孤立锁
  try {
    const bin = await sortingBinSvc.assignToTask(useConn, { warehouseId, taskId })
    if (bin) {
      await useConn.query(
        'UPDATE warehouse_tasks SET sorting_bin_id=?, sorting_bin_code=? WHERE id=?',
        [bin.binId, bin.binCode, taskId]
      )
      try {
        await recordEvent(useConn, { taskId, taskNo, eventType: WT_EVENT.SORTING_BIN_ASSIGNED, detail: { binCode: bin.binCode } })
      } catch (_) {}
    }
  } catch (binErr) {
    // 分拣格分配失败：尝试释放可能已占用的格，确保不产生孤立锁
    try { await sortingBinSvc.releaseByTask(useConn, taskId) } catch (_) {}
  }
  // 记录任务创建事件
  try {
    await recordEvent(useConn, {
      taskId, taskNo,
      eventType:  WT_EVENT.TASK_CREATED,
      toStatus:   WT_STATUS.PICKING,
      detail:     { itemCount: items.length },
    })
  } catch (_) {}
  return { taskId, taskNo }
}

/**
 * 分配操作员
 */
async function assign(id, { userId, userName }) {
  const task = await findById(id)
  if (task.status === WT_STATUS.SHIPPED)   throw new AppError('已出库的任务不能修改', 400)
  if (task.status === WT_STATUS.CANCELLED) throw new AppError('已取消的任务不能修改', 400)
  await pool.query('UPDATE warehouse_tasks SET assigned_to=?, assigned_name=? WHERE id=?', [userId, userName, id])
}

/**
 * 开始拣货（2 拣货中，已是默认状态，保留此接口供 PDA 兼容调用）
 * 同时清除孤立容器锁
 */
async function startPicking(id) {
  const task = await findById(id)
  if (![WT_STATUS.PENDING, WT_STATUS.PICKING].includes(task.status)) throw new AppError('只有"待拣货"或"拣货中"状态可以开始拣货', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('UPDATE warehouse_tasks SET status=? WHERE id=?', [WT_STATUS.PICKING, id])
    // 清除孤立容器锁（防止历史数据清空或任务已终结后残留锁阻断拣货）
    await conn.query(
      `UPDATE inventory_containers
       SET locked_by_task_id = NULL, locked_at = NULL
       WHERE locked_by_task_id IS NOT NULL
         AND locked_by_task_id NOT IN (
           SELECT wt.id FROM warehouse_tasks wt
           WHERE wt.status NOT IN (?,?)
         )`,
      [WT_STATUS.SHIPPED, WT_STATUS.CANCELLED],
    )
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 已废弃：已拣数量仅允许由拣货扫码（scan_logs）累加
 */
async function updatePickedQty() {
  throw new AppError('禁止直接修改已拣数量，请使用 PDA 拣货扫码', 400)
}

/**
 * 拣货完成，自动推进到「待分拣」（2→3）
 * 同步销售单状态 → 3；释放分拣格
 */
async function readyToShip(id) {
  const task = await findById(id)
  if (task.status !== WT_STATUS.PICKING) throw new AppError('只有"拣货中"状态可以标记拣货完成', 400)
  if (!isValidTransition(task.status, WT_STATUS.SORTING)) throw new AppError(`非法状态迁移：${task.status} → ${WT_STATUS.SORTING}`, 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertTaskPickScanClosure(conn, id)
    // 乐观锁：带状态条件防止并发重复推进
    const [r] = await conn.query('UPDATE warehouse_tasks SET status=? WHERE id=? AND status=?', [WT_STATUS.SORTING, id, WT_STATUS.PICKING])
    if (r.affectedRows === 0) throw new AppError('任务状态已变更，请刷新后重试', 409)
    if (task.saleOrderId) {
      await conn.query('UPDATE sale_orders SET status=3 WHERE id=?', [task.saleOrderId])
    }
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType:  WT_EVENT.PICKING_DONE,
        fromStatus: WT_STATUS.PICKING,
        toStatus:   WT_STATUS.SORTING,
      })
    } catch (_) {}
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 分拣完成，自动推进到「待复核」（3→4）
 * 接收已分拣的 item 列表，后端校验全部完成后自动推进
 * @param {number} id - 任务ID
 * @param {Array<{itemId: number, sortedQty: number}>} [sortedItems] - 可选，逐件上报时传入；不传则视为整任务完成
 */
async function sortTask(id, sortedItems = null) {
  const task = await findById(id)
  if (task.status !== WT_STATUS.SORTING) throw new AppError('只有"待分拣"状态可以完成分拣', 400)
  if (!isValidTransition(task.status, WT_STATUS.CHECKING)) throw new AppError(`非法状态迁移：${task.status} → ${WT_STATUS.CHECKING}`, 400)
  const conn = await pool.getConnection()
  let released = false
  try {
    await conn.beginTransaction()

    await assertTaskPickScanClosure(conn, id)

    // 若传入明细，逐件更新 sorted_qty
    if (sortedItems && sortedItems.length > 0) {
      for (const { itemId, sortedQty } of sortedItems) {
        await conn.query(
          'UPDATE warehouse_task_items SET sorted_qty=? WHERE id=? AND task_id=?',
          [sortedQty, itemId, id],
        )
      }
    } else {
      // 不传明细时：将所有 item 的 sorted_qty 设为 picked_qty（整任务一次性完成）
      await conn.query(
        'UPDATE warehouse_task_items SET sorted_qty=picked_qty WHERE task_id=?',
        [id],
      )
    }

    // 后端校验：所有 item 的 sorted_qty >= picked_qty
    const [updatedItems] = await conn.query(
      'SELECT picked_qty, sorted_qty FROM warehouse_task_items WHERE task_id=?',
      [id],
    )
    const allSorted = updatedItems.every(
      i => Number(i.sorted_qty) >= Number(i.picked_qty),
    )
    if (!allSorted) {
      await conn.rollback()
      conn.release()
      released = true
      const done = updatedItems.filter(i => Number(i.sorted_qty) >= Number(i.picked_qty)).length
      // 记录分拣进度事件（非阻断）
      try {
        const { pool: p } = require('../../config/db')
        await recordEvent(p, {
          taskId: id, taskNo: task.taskNo,
          eventType: WT_EVENT.SORT_PROGRESS,
          detail:    { done, total: updatedItems.length, progress: `${done}/${updatedItems.length}` },
        })
      } catch (_) {}
      return { allSorted: false, progress: `${done}/${updatedItems.length}` }
    }

    // 乐观锁推进状态
    const [r] = await conn.query('UPDATE warehouse_tasks SET status=? WHERE id=? AND status=?', [WT_STATUS.CHECKING, id, WT_STATUS.SORTING])
    if (r.affectedRows === 0) throw new AppError('任务状态已变更，请刷新后重试', 409)

    // 分拣完成 → 释放分拣格供下一订单使用
    await sortingBinSvc.releaseByTask(conn, id)
    await conn.query('UPDATE warehouse_tasks SET sorting_bin_id=NULL, sorting_bin_code=NULL WHERE id=?', [id])

    try {
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType:  WT_EVENT.SORT_DONE,
        fromStatus: WT_STATUS.SORTING,
        toStatus:   WT_STATUS.CHECKING,
        detail:     { itemCount: updatedItems.length },
      })
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType: WT_EVENT.SORTING_BIN_RELEASED,
        detail:    { binCode: task.sortingBinCode },
      })
    } catch (_) {}

    await conn.commit()
    return { allSorted: true }
  } catch (e) { await conn.rollback(); throw e }
  finally { if (!released) conn.release() }
}
async function checkDone(id) {
  const task = await findById(id)
  if (task.status !== WT_STATUS.CHECKING) throw new AppError('只有"待复核"状态可以完成复核', 400)
  if (!isValidTransition(task.status, WT_STATUS.PACKING)) throw new AppError(`非法状态迁移：${task.status} → ${WT_STATUS.PACKING}`, 400)
  for (const i of task.items) {
    if (Number(i.checkedQty) !== Number(i.pickedQty)) {
      throw new AppError('复核未完成：每条明细已核数量须等于拣货数量', 400)
    }
  }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertTaskCheckScanClosure(conn, id)
    const [r] = await conn.query('UPDATE warehouse_tasks SET status=? WHERE id=? AND status=?', [WT_STATUS.PACKING, id, WT_STATUS.CHECKING])
    if (r.affectedRows === 0) throw new AppError('任务状态已变更，请刷新后重试', 409)
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType:  WT_EVENT.CHECK_DONE,
        fromStatus: WT_STATUS.CHECKING,
        toStatus:   WT_STATUS.PACKING,
      })
    } catch (_) {}
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 打包完成，自动推进到「待出库」（5→6）
 */
async function packDone(id) {
  const task = await findById(id)
  if (task.status !== WT_STATUS.PACKING) throw new AppError('只有"待打包"状态可以完成打包', 400)
  if (!isValidTransition(task.status, WT_STATUS.SHIPPING)) throw new AppError(`非法状态迁移：${task.status} → ${WT_STATUS.SHIPPING}`, 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertTaskCheckScanClosure(conn, id)
    await assertTaskPackagingClosure(conn, id)
    const [r] = await conn.query('UPDATE warehouse_tasks SET status=? WHERE id=? AND status=?', [WT_STATUS.SHIPPING, id, WT_STATUS.PACKING])
    if (r.affectedRows === 0) throw new AppError('任务状态已变更，请刷新后重试', 409)
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType:  WT_EVENT.PACK_DONE,
        fromStatus: WT_STATUS.PACKING,
        toStatus:   WT_STATUS.SHIPPING,
      })
    } catch (_) {}
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 执行出库（6→7）：扣减库存 + 更新销售单状态 + 生成应收账款
 */
async function ship(id, operator, saleData) {
  const task = await findById(id)
  if (task.status !== WT_STATUS.SHIPPING) throw new AppError('只有"待出库"状态可以执行出库', 400)
  if (!isValidTransition(task.status, WT_STATUS.SHIPPED)) throw new AppError(`非法状态迁移：${task.status} → ${WT_STATUS.SHIPPED}`, 400)

  const { saleOrderId, warehouseId, totalAmount, customerName, items } = saleData

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    await assertTaskPickScanClosure(conn, id)
    await assertTaskCheckScanClosure(conn, id)
    await assertTaskPackagingClosure(conn, id)

    if (saleOrderId) {
      const [[saleRow]] = await conn.query(
        'SELECT id, status, order_no FROM sale_orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [saleOrderId],
      )
      if (!saleRow) throw new AppError('关联销售单不存在，无法出库', 404)
      if (Number(saleRow.status) === 5) {
        throw new AppError(`关联销售单 ${saleRow.order_no} 已取消，无法继续出库`, 400)
      }
      if (Number(saleRow.status) === 4) {
        throw new AppError(`关联销售单 ${saleRow.order_no} 已完成出库，请勿重复操作`, 400)
      }
    }

    // 通过引擎扣减库存（仅本任务锁定容器）
    for (const item of items) {
      await moveStock(conn, {
        moveType:    MOVE_TYPE.TASK_OUT,
        productId:   item.productId,
        productName: item.productName,
        warehouseId,
        qty:         item.quantity,
        unitPrice:   item.unitPrice,
        refType:     'warehouse_task',
        refId:       task.id,
        refNo:       task.taskNo,
        reservationRefType: 'sale_order',
        reservationRefId:   saleOrderId,
        operatorId:  operator.userId,
        operatorName: operator.realName,
        lockedByTaskId: id,
      })
    }

    // 更新销售单 + 仓库任务状态（乐观锁）
    await conn.query('UPDATE sale_orders SET status=4 WHERE id=?', [saleOrderId])
    const [rShip] = await conn.query('UPDATE warehouse_tasks SET status=?, shipped_at=NOW() WHERE id=? AND status=?', [WT_STATUS.SHIPPED, id, WT_STATUS.SHIPPING])
    if (rShip.affectedRows === 0) throw new AppError('任务状态已变更，请刷新后重试', 409)

    // 释放该任务锁定的所有容器
    await unlockContainersByTask(conn, id)

    // 自动生成应收账款（如已存在则忽略）
    await conn.query(
      `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date) VALUES (2,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [saleOrderId, task.taskNo, customerName, totalAmount, totalAmount]
    )

    try {
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType:    WT_EVENT.SHIP_DONE,
        fromStatus:   WT_STATUS.SHIPPING,
        toStatus:     WT_STATUS.SHIPPED,
        operatorId:   operator.userId,
        operatorName: operator.realName,
        detail:       { saleOrderId, totalAmount, itemCount: items.length },
      })
    } catch (_) {}

    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 取消任务（→8）：同步销售单状态 → 5；释放分拣格
 */
async function cancel(id, options = {}) {
  const task = await findById(id)
  if (task.status === WT_STATUS.SHIPPED)   throw new AppError('已出库的任务不能取消', 400)
  if (task.status === WT_STATUS.CANCELLED) throw new AppError('任务已取消', 400)
  if (!isValidTransition(task.status, WT_STATUS.CANCELLED)) throw new AppError(`非法状态迁移：${task.status} → ${WT_STATUS.CANCELLED}`, 400)

  const manageConn = !options.conn
  const conn = options.conn || await pool.getConnection()
  try {
    if (manageConn) await conn.beginTransaction()
    await conn.query('UPDATE warehouse_tasks SET status=?, sorting_bin_id=NULL, sorting_bin_code=NULL WHERE id=?', [WT_STATUS.CANCELLED, id])
    await unlockContainersByTask(conn, id)
    await sortingBinSvc.releaseByTask(conn, id)
    if (task.saleOrderId && options.syncSaleStatus !== false) {
      await conn.query('UPDATE sale_orders SET status=5 WHERE id=?', [task.saleOrderId])
    }
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: task.taskNo,
        eventType:  WT_EVENT.TASK_CANCELLED,
        fromStatus: task.status,
        toStatus:   WT_STATUS.CANCELLED,
        detail:     { saleOrderId: task.saleOrderId },
      })
    } catch (_) {}
    if (manageConn) await conn.commit()
  } catch (e) {
    if (manageConn) await conn.rollback()
    throw e
  } finally {
    if (manageConn) conn.release()
  }
}

/**
 * 修改优先级
 */
async function updatePriority(id, priority) {
  if (![1,2,3].includes(priority)) throw new AppError('优先级无效', 400)
  await findById(id)
  await pool.query('UPDATE warehouse_tasks SET priority=? WHERE id=?', [priority, id])
}

/**
 * 公共容器查询 — 一次性批量获取多个商品的可用容器，按库位路径排序
 * 消除 getPickSuggestions / getPickRoute 的 N+1 查询
 *
 * @param {number[]} productIds
 * @param {number}   warehouseId
 * @param {number}   taskId       - 当前任务ID（排除其他任务锁定的容器）
 * @returns {Record<number, Array>}  key = productId
 */
async function _fetchContainersForProducts(productIds, warehouseId, taskId) {
  if (!productIds.length) return {}
  const [containers] = await pool.query(
    `SELECT c.id AS containerId, c.barcode, c.container_type AS containerType, c.remaining_qty AS remainingQty,
            c.product_id AS productId,
            c.locked_by_task_id AS lockedByTaskId,
            loc.code AS locationCode,
            loc.zone, loc.aisle, loc.rack, loc.level, loc.position
     FROM inventory_containers c
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.product_id IN (?)
       AND c.warehouse_id = ?
       AND c.remaining_qty > 0
       AND c.status = 1
       AND c.deleted_at IS NULL
       AND (c.locked_by_task_id IS NULL OR c.locked_by_task_id = ?)
     ORDER BY
       loc.zone ASC, loc.aisle ASC, loc.rack ASC, loc.level ASC, loc.position ASC,
       c.created_at ASC`,
    [productIds, warehouseId, taskId],
  )
  const grouped = {}
  for (const c of containers) {
    if (!grouped[c.productId]) grouped[c.productId] = []
    grouped[c.productId].push(c)
  }
  return grouped
}

/**
 * 自动推荐拣货容器（N+1 已优化：批量查询后 JS 分组）
 */
async function getPickSuggestions(taskId) {
  const task = await findById(taskId)
  if (task.status >= WT_STATUS.SHIPPED) throw new AppError('任务已完成或已取消', 400)

  const pendingItems = task.items.filter(i => i.requiredQty - i.pickedQty > 0)
  const productIds   = pendingItems.map(i => i.productId)
  const grouped      = await _fetchContainersForProducts(productIds, task.warehouseId, taskId)

  const items = task.items.map(item => {
    const remaining = item.requiredQty - item.pickedQty
    if (remaining <= 0) return { ...item, remaining: 0, suggestions: [] }
    const containers = (grouped[item.productId] || []).slice(0, 10)
    return {
      ...item,
      remaining,
      suggestions: containers.map(c => ({
        containerId:  c.containerId,
        barcode:      c.barcode,
        containerKind: Number(c.containerType) === 2 || /^B/i.test(String(c.barcode || '')) ? 'plastic_box' : 'inventory',
        locationCode: c.locationCode || null,
        remainingQty: Number(c.remainingQty),
        locked:       c.lockedByTaskId === taskId,
      })),
    }
  })

  return { taskId, taskNo: task.taskNo, items }
}

/**
 * 生成最优拣货路线（N+1 已优化：批量查询后 JS 分组排序）
 */
async function getPickRoute(taskId) {
  const task = await findById(taskId)
  if (task.status >= WT_STATUS.SHIPPED) throw new AppError('任务已完成或已取消', 400)

  const pendingItems = task.items.filter(i => i.requiredQty - i.pickedQty > 0)
  const productIds   = pendingItems.map(i => i.productId)
  const grouped      = await _fetchContainersForProducts(productIds, task.warehouseId, taskId)

  const allSteps = []
  for (const item of pendingItems) {
    let need = item.requiredQty - item.pickedQty
    for (const c of (grouped[item.productId] || [])) {
      if (need <= 0) break
      const qty = Math.min(Number(c.remainingQty), need)
      allSteps.push({
        itemId:       item.id,
        productId:    item.productId,
        productCode:  item.productCode,
        productName:  item.productName,
        unit:         item.unit,
        containerId:  c.containerId,
        barcode:      c.barcode,
        locationCode: c.locationCode || null,
        zone:     c.zone     || '',
        aisle:    c.aisle    || '',
        rack:     c.rack     || '',
        level:    c.level    || '',
        position: c.position || '',
        qty,
        locked: c.lockedByTaskId === taskId,
      })
      need -= qty
    }
  }

  allSteps.sort((a, b) => {
    for (const k of ['zone','aisle','rack','level','position']) {
      if (a[k] < b[k]) return -1
      if (a[k] > b[k]) return  1
    }
    return 0
  })

  return {
    taskId,
    taskNo: task.taskNo,
    totalSteps: allSteps.length,
    route: allSteps.map((s, idx) => ({
      step:         idx + 1,
      itemId:       s.itemId,
      productName:  s.productName,
      productCode:  s.productCode,
      unit:         s.unit,
      containerId:  s.containerId,
      barcode:      s.barcode,
      locationCode: s.locationCode,
      qty:          s.qty,
      locked:       s.locked,
    })),
  }
}

/**
 * PDA 任务池 — 返回所有待分配/备货中的任务（供 PDA 主页显示）
 * 使用 JOIN + GROUP BY 替代 N+1 子查询
 */
async function findMyTasks() {
  const [rows] = await pool.query(`
    SELECT wt.*,
      COUNT(wti.id)                     AS item_count,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0)   AS total_picked
    FROM warehouse_tasks wt
    LEFT JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')}) AND wt.deleted_at IS NULL
    GROUP BY wt.id
    ORDER BY wt.priority ASC, wt.created_at DESC
    LIMIT 50
  `)
  return rows.map(r => ({
    ...fmt(r),
    itemCount:     Number(r.item_count),
    totalRequired: Number(r.total_required),
    totalPicked:   Number(r.total_picked),
  }))
}

/**
 * 复核：批量更新明细的 checked_qty
 * 当所有明细 checked_qty >= required_qty 时，在任务上记录复核完成时间
 *
 * @param {number} taskId
 * @param {Array<{itemId: number, checkedQty: number}>} items
 */
async function checkItems(taskId, items) {
  void taskId
  void items
  throw new AppError('已禁止手动提交复核数量，请使用 PDA 复核扫码（扫描容器条码）', 400)
}

module.exports = {
  findAll,
  findById,
  findMyTasks,
  createForSaleOrder,
  assign,
  startPicking,
  updatePickedQty,
  readyToShip,
  sortTask,
  checkDone,
  packDone,
  ship,
  cancel,
  updatePriority,
  getPickSuggestions,
  getPickRoute,
  checkItems,
  assertTaskPickScanClosure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
}
