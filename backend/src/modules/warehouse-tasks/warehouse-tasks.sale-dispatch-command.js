'use strict'

const { assertQtyPrecision } = require('../../utils/qtyPrecision')
const AppError = require('../../utils/AppError')
const { WT_STATUS } = require('../../constants/warehouseTaskStatus')
const { assignToTask, releaseByTask } = require('../sorting-bins/sorting-bins.service')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { genTaskNo, logSideEffectFailure } = require('./warehouse-tasks.helpers')

/**
 * 销售派发在原订单事务中借用连接创建任务
 * 创建后自动为任务分配一个空闲分拣格
 * status=2 拣货中（跳过待拣货，直接可拣）
 */
async function createForSaleOrder({ saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName, items, conn: extConn }) {
  if (!extConn) throw new AppError('销售出库任务须在原单事务中生成',500,'WAREHOUSE_TASK_TRANSACTION_REQUIRED')
  const useConn = extConn
  await assertQtyPrecision(useConn, items.map(item => ({productId:item.productId,qty:item.quantity,label:'仓库任务数量'})))
  const taskNo = await genTaskNo(useConn)
  const [r] = await useConn.query(
    `INSERT INTO warehouse_tasks (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,priority) VALUES (?,?,?,?,?,?,?,${WT_STATUS.PICKING},2)`,
    [taskNo, saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName]
  )
  const taskId = r.insertId
  for (const item of items) {
    await useConn.query(
      `INSERT INTO warehouse_task_items (task_id,product_id,product_code,product_name,unit,article_number,spec,color,required_qty,allow_decimal_qty_snapshot,picked_qty) VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.articleNumber || null, item.spec || null, item.color || null, item.quantity, item.allowDecimalQtySnapshot ?? null]
    )
  }
  // 自动分配分拣格（无空闲格时忽略，不阻断任务创建）
  // 注意：assignToTask 内部已使用 FOR UPDATE 行锁，保证原子性
  // 若分配部分失败，需回滚分拣格占用，避免孤立锁
  try {
    const bin = await assignToTask(useConn, { warehouseId, taskId })
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
      await releaseByTask(useConn, taskId)
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

module.exports = { createForSaleOrder }
