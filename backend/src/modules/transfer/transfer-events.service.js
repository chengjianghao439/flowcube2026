const logger = require('../../utils/logger')

const TRANSFER_EVENT = Object.freeze({
  CREATED: 'TRANSFER_CREATED',
  CONFIRMED: 'TRANSFER_CONFIRMED',
  EXECUTED: 'TRANSFER_EXECUTED',
  CANCELLED: 'TRANSFER_CANCELLED',
})

async function record(conn, {
  transferOrderId,
  orderNo,
  eventType,
  title,
  description = null,
  operatorId = null,
  operatorName = null,
  requestId = null,
  payload = null,
}) {
  await conn.query(
    `INSERT INTO transfer_order_events
       (transfer_order_id, order_no, event_type, title, description, payload_json, created_by, created_by_name, request_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      transferOrderId,
      orderNo,
      eventType,
      title,
      description,
      payload ? JSON.stringify(payload) : null,
      operatorId,
      operatorName,
      requestId,
    ],
  )
  logger.info('记录调拨事件', {
    transferOrderId,
    orderNo,
    eventType,
    operatorId,
  }, 'TRANSFER_EVENT')
}

module.exports = { TRANSFER_EVENT, record }
