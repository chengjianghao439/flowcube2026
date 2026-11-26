'use strict'

const AppError = require('../../utils/AppError')
const { assertTaskScope } = require('./warehouse-tasks.helpers')

function isAdjustmentReceipt(action) {
  return /^warehouse\.adjustment-(?:void|return)(?:\.[1-9]\d*)?$/.test(String(action ?? ''))
}

async function assertAdjustmentReceipt(conn, receipt, matchedAction, scope) {
  if (!isAdjustmentReceipt(matchedAction) || receipt.status !== 'success') return
  const isReturn = matchedAction.startsWith('warehouse.adjustment-return.')
  const table = isReturn ? 'sale_order_adjustment_container_returns' : 'sale_order_adjustment_package_voids'
  const type = isReturn ? 'adjustment_container_return' : 'adjustment_package_void'
  if (receipt.resourceType !== type || !matchedAction.endsWith(`.${receipt.resourceId}`)) {
    throw new AppError('原改单的处理结果与明细不一致，请核对', 409)
  }
  const [[task]] = await conn.query(
    `SELECT wt.warehouse_id FROM ${table} e
     JOIN sale_order_adjustment_items i ON i.id=e.adjustment_item_id
     JOIN sale_order_adjustments a ON a.id=i.adjustment_id
     JOIN warehouse_tasks wt ON wt.id=a.warehouse_task_id WHERE e.id=?`, [receipt.resourceId],
  )
  if (!task) throw new AppError('原改单作业不存在，请核对', 409)
  assertTaskScope(task, scope)
}

module.exports = { isAdjustmentReceipt, assertAdjustmentReceipt }
