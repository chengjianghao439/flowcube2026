const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')
const { normalizePagination } = require('../../utils/pagination')
const { lockStatusRow } = require('../../utils/statusTransition')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { WT_STATUS, WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
const sortingBins = require('../sorting-bins/sorting-bins.service')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')

const ASSIGN_ACTION = 'warehouse.assignSortingBin'

async function listAwaitingSortingBin({ page = 1, pageSize = 20, warehouseId = null, scopeWarehouseIds = null } = {}) {
  const pagination = normalizePagination({ page, pageSize })
  const warehouseClause = warehouseId ? ' AND wt.warehouse_id=?' : ''
  const warehouseParams = warehouseId ? [warehouseId] : []
  const scope = scopeFilter(scopeWarehouseIds, 'wt.warehouse_id')
  const where = `wt.deleted_at IS NULL AND COALESCE(wt.task_type,'sale_out')='sale_out'
    AND wt.status IN (?,?) AND wt.sorting_bin_id IS NULL
    AND wt.cancel_requested_at IS NULL AND wt.adjustment_requested_at IS NULL${warehouseClause}${scope.sql}`
  const params = [WT_STATUS.PICKING, WT_STATUS.SORTING, ...warehouseParams, ...scope.params]
  const [rows] = await pool.query(
    `SELECT wt.id,wt.task_no,wt.warehouse_id,wt.warehouse_name,wt.customer_name,wt.status,wt.created_at
     FROM warehouse_tasks wt WHERE ${where}
     ORDER BY wt.created_at ASC,wt.id ASC LIMIT ? OFFSET ?`,
    [...params, pagination.pageSize, pagination.offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM warehouse_tasks wt WHERE ${where}`, params)
  return {
    list: rows.map(row => ({
      id: Number(row.id), taskNo: row.task_no, warehouseId: Number(row.warehouse_id),
      warehouseName: row.warehouse_name, customerName: row.customer_name,
      status: Number(row.status), statusName: WT_STATUS_NAME[Number(row.status)], createdAt: row.created_at,
    })),
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total: Number(total) },
  }
}

async function assignSortingBin(taskId, { requestKey, userId, operatorName, scopeWarehouseIds = null } = {}) {
  if (!requestKey) throw new AppError('请提供稳定的请求键后重试', 400, 'REQUEST_KEY_REQUIRED')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 与取消、打包和强制释放统一先锁任务，再锁分拣格。
    const task = await lockStatusRow(conn, {
      table: 'warehouse_tasks', id: taskId,
      columns: 'id,task_no,task_type,warehouse_id,status,sorting_bin_id,cancel_requested_at,adjustment_requested_at',
      entityName: '仓库任务',
    })
    assertInScope(scopeWarehouseIds, task.warehouse_id, '仓库任务')
    const requestState = await beginResourceOperationRequest(conn, {
      requestKey, action: ASSIGN_ACTION, userId,
      resourceType: 'warehouse_task', resourceId: taskId,
    })
    if (requestState.replay) {
      await conn.commit()
      return requestState.responseData
    }
    if (String(task.task_type || 'sale_out') !== 'sale_out'
      || ![WT_STATUS.PICKING, WT_STATUS.SORTING].includes(Number(task.status))
      || task.cancel_requested_at || task.adjustment_requested_at || task.sorting_bin_id != null) {
      throw new AppError('该任务当前不能补分配分拣格，请刷新任务状态', 409, 'SORTING_BIN_ASSIGN_NOT_ALLOWED')
    }
    const [[orphan]] = await conn.query('SELECT id FROM sorting_bins WHERE current_task_id=? LIMIT 1', [taskId])
    if (orphan) throw new AppError('任务与分拣格绑定状态不一致，请主管核查', 409, 'SORTING_BIN_BINDING_CONFLICT')
    const bin = await sortingBins.assignToTask(conn, { warehouseId: task.warehouse_id, taskId })
    if (!bin) throw new AppError('该仓库暂无空闲分拣格，请释放空格后重试', 409, 'SORTING_BIN_NONE_AVAILABLE')
    const [updated] = await conn.query(
      `UPDATE warehouse_tasks SET sorting_bin_id=?,sorting_bin_code=?
       WHERE id=? AND sorting_bin_id IS NULL AND status IN (?,?)
         AND cancel_requested_at IS NULL AND adjustment_requested_at IS NULL`,
      [bin.binId, bin.binCode, taskId, WT_STATUS.PICKING, WT_STATUS.SORTING],
    )
    if (updated.affectedRows !== 1) throw new AppError('任务状态已变化，请刷新后重试', 409)
    await recordEvent(conn, {
      taskId, taskNo: task.task_no, eventType: WT_EVENT.SORTING_BIN_ASSIGNED,
      operatorId: userId ?? null, operatorName: operatorName ?? null,
      detail: { binId: bin.binId, binCode: bin.binCode, source: 'supervisor_recovery' },
    })
    const data = { taskId: Number(taskId), binId: Number(bin.binId), binCode: bin.binCode }
    await completeOperationRequest(conn, requestState, {
      data, message: '分拣格已补分配', resourceType: 'warehouse_task', resourceId: taskId,
    })
    await conn.commit()
    return data
  } catch (error) { await conn.rollback(); throw error }
  finally { conn.release() }
}

module.exports = { listAwaitingSortingBin, assignSortingBin }
