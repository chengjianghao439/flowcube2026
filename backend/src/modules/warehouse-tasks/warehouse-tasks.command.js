const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { releaseByRef } = require('../../engine/reservationEngine')
const { unlockContainersByTask } = require('../../engine/containerEngine')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const {
  WT_STATUS,
  WT_STATUS_TERMINAL,
  isValidTransition,
  assertWarehouseTaskAction,
} = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { genTaskNo, logSideEffectFailure } = require('./warehouse-tasks.helpers')
const { findById } = require('./warehouse-tasks.query')

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
      `INSERT INTO warehouse_task_items (task_id,product_id,product_code,product_name,unit,article_number,spec,color,required_qty,picked_qty) VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.articleNumber || null, item.spec || null, item.color || null, item.quantity]
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
      } catch (eventErr) {
        logSideEffectFailure('仓库任务事件写入失败：分拣格分配事件', eventErr, {
          taskId,
          taskNo,
          eventType: WT_EVENT.SORTING_BIN_ASSIGNED,
        })
      }
    }
  } catch (binErr) {
    // 分拣格分配失败：尝试释放可能已占用的格，确保不产生孤立锁
    logSideEffectFailure('分拣格自动分配失败，任务继续创建但进入待人工分配降级状态', binErr, {
      taskId,
      taskNo,
      warehouseId,
      degradation: 'sorting_bin_assignment_failed',
    })
    try {
      await sortingBinSvc.releaseByTask(useConn, taskId)
    } catch (releaseErr) {
      logSideEffectFailure('分拣格分配失败后的释放兜底也失败', releaseErr, {
        taskId,
        taskNo,
        degradation: 'sorting_bin_release_after_assignment_failed',
      })
    }
  }
  // 记录任务创建事件
  try {
    await recordEvent(useConn, {
      taskId, taskNo,
      eventType:  WT_EVENT.TASK_CREATED,
      toStatus:   WT_STATUS.PICKING,
      detail:     { itemCount: items.length },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：任务创建事件', eventErr, {
      taskId,
      taskNo,
      eventType: WT_EVENT.TASK_CREATED,
    })
  }
  return { taskId, taskNo }
}

/**
 * 为采购退货创建出库任务（仅拣货→出库，无分拣/复核/打包环节）
 */
async function createForPurchaseReturn({ returnId, returnNo, supplierName, warehouseId, warehouseName, items, conn }) {
  const taskNo = await genTaskNo(conn)
  const [r] = await conn.query(
    `INSERT INTO warehouse_tasks
       (task_no, task_type, return_id, sale_order_id, sale_order_no,
        customer_id, customer_name, warehouse_id, warehouse_name, status, priority)
     VALUES (?, 'purchase_return', ?, NULL, NULL, NULL, ?, ?, ?, ${WT_STATUS.PICKING}, 2)`,
    [taskNo, returnId, supplierName, warehouseId, warehouseName],
  )
  const taskId = r.insertId
  for (const item of items) {
    await conn.query(
      `INSERT INTO warehouse_task_items
         (task_id, product_id, product_code, product_name, unit, article_number, spec, color, required_qty, picked_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.articleNumber || null, item.spec || null, item.color || null, item.quantity],
    )
  }
  try {
    await recordEvent(conn, {
      taskId, taskNo,
      eventType: WT_EVENT.TASK_CREATED,
      toStatus: WT_STATUS.PICKING,
      detail: { itemCount: items.length, taskType: 'purchase_return', returnId, returnNo },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：退货任务创建事件', eventErr, {
      taskId, taskNo, eventType: WT_EVENT.TASK_CREATED,
    })
  }
  return { taskId, taskNo }
}

/**
 * 分配操作员
 */
async function assign(id, { userId, userName }) {
  const task = await findById(id)
  assertWarehouseTaskAction('assign', task.status)
  await pool.query('UPDATE warehouse_tasks SET assigned_to=?, assigned_name=? WHERE id=?', [userId, userName, id])
}

/**
 * 修改优先级
 */
async function updatePriority(id, priority) {
  if (![1,2,3].includes(priority)) throw new AppError('优先级无效', 400)
  const task = await findById(id)
  if (WT_STATUS_TERMINAL.includes(Number(task.status))) {
    throw new AppError('已出库或已取消的任务不允许修改优先级', 409, 'WAREHOUSE_TASK_TERMINAL_PRIORITY_FORBIDDEN')
  }
  const [result] = await pool.query(
    `UPDATE warehouse_tasks
     SET priority=?
     WHERE id=? AND deleted_at IS NULL AND status NOT IN (?)`,
    [priority, id, WT_STATUS_TERMINAL],
  )
  if (result.affectedRows !== 1) {
    throw new AppError('任务状态已变化，请刷新后重试', 409, 'WAREHOUSE_TASK_PRIORITY_STATUS_CONFLICT')
  }
}

/**
 * 取消任务（→8）：同步销售单状态 → 5；释放分拣格
 */
async function cancel(id, options = {}) {
  const manageConn = !options.conn
  const conn = options.conn || await pool.getConnection()
  try {
    if (manageConn) await conn.beginTransaction()

    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks',
      id,
      columns: 'id, task_no, status, sale_order_id, sorting_bin_id, sorting_bin_code, cancel_requested_at',
      entityName: '仓库任务',
    })
    if (taskRow.cancel_requested_at) {
      throw new AppError('任务已在取消收尾中，请等待逆向归还完成', 409)
    }
    const rule = assertWarehouseTaskAction('cancel', taskRow.status)
    if (!isValidTransition(taskRow.status, rule.toStatus)) {
      throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
    }

    // 解锁/清理前先查询所有被锁容器及其库位——用于判断分流路径，也用于归还指引
    const [lockedContainers] = await conn.query(
      `SELECT c.id, c.barcode, c.container_type,
              loc.code AS location_code,
              loc.zone, loc.aisle, loc.rack, loc.level, loc.position
       FROM inventory_containers c
       LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
       WHERE c.locked_by_task_id = ?`,
      [id],
    )
    const containersToReturn = lockedContainers.map(c => ({
      containerId: Number(c.id),
      barcode: c.barcode,
      containerKind: Number(c.container_type) === 2 || /^B/i.test(String(c.barcode || ''))
        ? 'plastic_box' : 'inventory',
      locationCode: c.location_code || null,
      zone: c.zone || null,
      aisle: c.aisle || null,
      rack: c.rack || null,
      level: c.level || null,
      position: c.position || null,
    }))

    // 已经拣出货架、还没归位的容器不能批量后台解锁——货物实际在哪只有人知道，
    // 批量解锁只是清空数据库字段，不会引导任何人把已经拿出来的货放回原位，
    // 容器会立刻"看起来"可用，可能被派发给别的任务却扑空。这种情况改走逆向
    // 归还流程：逐容器扫码确认放回位置，全部归位后才真正完成取消。
    const needsReverseReturn = lockedContainers.length > 0
      && [WT_STATUS.PICKING, WT_STATUS.SORTING, WT_STATUS.CHECKING, WT_STATUS.PACKING, WT_STATUS.SHIPPING]
           .includes(Number(taskRow.status))

    if (needsReverseReturn) {
      const [casResult] = await conn.query(
        `UPDATE warehouse_tasks SET cancel_requested_at = NOW()
         WHERE id = ? AND status = ? AND cancel_requested_at IS NULL`,
        [id, taskRow.status],
      )
      if (casResult.affectedRows !== 1) {
        throw new AppError('任务状态已变化，请刷新后重试', 409)
      }
      // 未拣货的明细行直接撤回：required_qty 下调到当前 picked_qty，防止继续为
      // 已取消的订单拣更多货；已经拣的部分保留原样，等逆向扫码归还。
      await conn.query(
        `UPDATE warehouse_task_items SET required_qty = picked_qty
         WHERE task_id = ? AND picked_qty < required_qty`,
        [id],
      )
      // 打包中(未完成/未打印箱贴)的箱子没有物理实体可供扫码核对，直接由系统作废；
      // 已完成(已打印箱贴)的箱子才需要仓库人工扫码确认拆箱——两者判断依据见
      // warehouse-tasks.cancel-return.js 顶部说明。装箱本身不影响容器库存数字
      // （package_items 与 inventory_containers 无关联），作废箱子不需要任何数量回滚。
      await conn.query(
        `UPDATE packages SET status = 3 WHERE warehouse_task_id = ? AND status = 1`,
        [id],
      )
      const [sealedPackages] = await conn.query(
        `SELECT id, barcode FROM packages WHERE warehouse_task_id = ? AND status = 2`,
        [id],
      )
      const packagesToUnpack = sealedPackages.map(p => ({ packageId: Number(p.id), barcode: p.barcode }))
      if (taskRow.sale_order_id) {
        await releaseByRef(conn, 'sale_order', Number(taskRow.sale_order_id))
        // 销售单业务状态立即变为已取消——不依赖物理归还进度。走 sale.service.cancel()
        // 间接调用时它自己会做这一步（并传 syncSaleStatus:false 跳过这里，避免重复）；
        // 直接调用本接口（PUT /warehouse-tasks/:id/cancel）时没有别人会做，必须在这里做。
        if (options.syncSaleStatus !== false) {
          const saleSvc = require('../sale/sale.service')
          await saleSvc.syncCancelledByWarehouseTaskWithinTransaction(conn, Number(taskRow.sale_order_id), {
            taskId: Number(taskRow.id),
            taskNo: taskRow.task_no,
          })
        }
      }
      try {
        await recordEvent(conn, {
          taskId: id, taskNo: taskRow.task_no,
          eventType: WT_EVENT.CANCEL_REQUESTED,
          operatorId: options.operator?.userId ?? null,
          operatorName: options.operator?.realName ?? null,
          detail: {
            saleOrderId: taskRow.sale_order_id != null ? Number(taskRow.sale_order_id) : null,
            reservationReleased: taskRow.sale_order_id != null,
            containersToReturn,
            packagesToUnpack,
          },
        })
      } catch (eventErr) {
        logSideEffectFailure('仓库任务事件写入失败：取消收尾发起事件', eventErr, {
          taskId: id,
          taskNo: taskRow.task_no,
          eventType: WT_EVENT.CANCEL_REQUESTED,
        })
      }
      if (manageConn) await conn.commit()
      return
    }

    await compareAndSetStatus(conn, {
      table: 'warehouse_tasks',
      id,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      entityName: '仓库任务',
      extraSet: {
        sorting_bin_id: null,
        sorting_bin_code: null,
      },
    })

    // 只有任务真实切换到 CANCELLED 后，才执行资源释放与单据同步副作用。

    await unlockContainersByTask(conn, id)
    await sortingBinSvc.releaseByTask(conn, id)

    if (taskRow.sale_order_id) {
      await releaseByRef(conn, 'sale_order', Number(taskRow.sale_order_id))
    }

    // 取消关联的包裹（标记 status=3）并清理包裹打印任务
    const packagesSvc = require('../packages/packages.service')
    const cancelledPkgCount = await packagesSvc.cancelByTaskId(conn, id)
    if (cancelledPkgCount > 0) {
      await conn.query(
        `UPDATE print_jobs SET status = 3, error_message = '仓库任务已取消'
         WHERE ref_type = 'package'
           AND ref_id IN (SELECT id FROM packages WHERE warehouse_task_id = ?)
           AND status IN (0, 1)`,
        [id],
      )
    }

    if (taskRow.sale_order_id && options.syncSaleStatus !== false) {
      const saleSvc = require('../sale/sale.service')
      await saleSvc.syncCancelledByWarehouseTaskWithinTransaction(conn, Number(taskRow.sale_order_id), {
        taskId: Number(taskRow.id),
        taskNo: taskRow.task_no,
      })
    }
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: taskRow.task_no,
        eventType:  WT_EVENT.TASK_CANCELLED,
        fromStatus: taskRow.status,
        toStatus:   rule.toStatus,
        operatorId: options.operator?.userId ?? null,
        operatorName: options.operator?.realName ?? null,
        detail:     {
          saleOrderId: taskRow.sale_order_id != null ? Number(taskRow.sale_order_id) : null,
          reservationReleased: taskRow.sale_order_id != null,
          packagesCancelled: cancelledPkgCount,
          containersToReturn,
        },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：任务取消事件', eventErr, {
        taskId: id,
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.TASK_CANCELLED,
      })
    }
    if (manageConn) await conn.commit()
  } catch (e) {
    if (manageConn) await conn.rollback()
    throw e
  } finally {
    if (manageConn) conn.release()
  }
}

module.exports = {
  createForSaleOrder,
  createForPurchaseReturn,
  assign,
  updatePriority,
  cancel,
}
