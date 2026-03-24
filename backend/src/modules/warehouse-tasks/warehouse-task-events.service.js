/**
 * warehouse-task-events.service.js
 * 仓库任务事件记录服务
 *
 * 设计原则：
 *  - 只写，不读（查询由 routes 层直接查表）
 *  - 所有写入在调用方事务内执行（传入 conn）
 *  - 单条写入失败不阻断主流程（调用方 catch 后忽略）
 *  - event_type 与 WT_ON_ENTER_ACTIONS / WT_ON_EXIT_ACTIONS 对应
 */

const WT_EVENT = Object.freeze({
  TASK_CREATED:           'TASK_CREATED',
  PICKING_STARTED:        'PICKING_STARTED',
  PICKING_DONE:           'PICKING_DONE',
  SORT_PROGRESS:          'SORT_PROGRESS',
  SORT_DONE:              'SORT_DONE',
  CHECK_PROGRESS:         'CHECK_PROGRESS',
  CHECK_DONE:             'CHECK_DONE',
  PACK_PROGRESS:          'PACK_PROGRESS',
  PACK_DONE:              'PACK_DONE',
  SHIP_DONE:              'SHIP_DONE',
  TASK_CANCELLED:         'TASK_CANCELLED',
  SORTING_BIN_ASSIGNED:   'SORTING_BIN_ASSIGNED',
  SORTING_BIN_RELEASED:   'SORTING_BIN_RELEASED',
})

/**
 * 写入一条任务事件记录
 *
 * @param {object} conn            - 事务连接（或 pool）
 * @param {object} params
 * @param {number} params.taskId
 * @param {string} params.taskNo
 * @param {string} params.eventType  - WT_EVENT 中的值
 * @param {number} [params.fromStatus]
 * @param {number} [params.toStatus]
 * @param {number} [params.operatorId]
 * @param {string} [params.operatorName]
 * @param {object} [params.detail]   - 任意 JSON 附加信息
 */
async function record(conn, {
  taskId,
  taskNo,
  eventType,
  fromStatus   = null,
  toStatus     = null,
  operatorId   = null,
  operatorName = null,
  detail       = null,
}) {
  await conn.query(
    `INSERT INTO warehouse_task_events
       (task_id, task_no, event_type, from_status, to_status, operator_id, operator_name, detail)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      taskId,
      taskNo,
      eventType,
      fromStatus,
      toStatus,
      operatorId,
      operatorName,
      detail ? JSON.stringify(detail) : null,
    ],
  )
}

module.exports = { WT_EVENT, record }
