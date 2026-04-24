const logger = require('../../utils/logger')

const RETURN_EVENT = Object.freeze({
  CREATED: 'RETURN_CREATED',
  CONFIRMED: 'RETURN_CONFIRMED',
  EXECUTED: 'RETURN_EXECUTED',
  CANCELLED: 'RETURN_CANCELLED',
})

async function record(conn, {
  returnType,
  returnId,
  returnNo,
  eventType,
  title,
  description = null,
  operatorId = null,
  operatorName = null,
  requestId = null,
  payload = null,
}) {
  await conn.query(
    `INSERT INTO return_order_events
       (return_type, return_id, return_no, event_type, title, description, payload_json, created_by, created_by_name, request_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      returnType,
      returnId,
      returnNo,
      eventType,
      title,
      description,
      payload ? JSON.stringify(payload) : null,
      operatorId,
      operatorName,
      requestId,
    ],
  )
  logger.info('记录退货事件', {
    returnType,
    returnId,
    returnNo,
    eventType,
    operatorId,
  }, 'RETURN_EVENT')
}

module.exports = { RETURN_EVENT, record }
