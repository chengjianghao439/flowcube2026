const logger = require('../../utils/logger')

const PAYMENT_EVENT = Object.freeze({
  CREATED: 'PAYMENT_RECORD_CREATED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  ADJUSTED_BY_RETURN: 'PAYMENT_ADJUSTED_BY_RETURN',
})

async function record(conn, {
  paymentRecordId,
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
    `INSERT INTO payment_record_events
       (payment_record_id, order_no, event_type, title, description, payload_json, created_by, created_by_name, request_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      paymentRecordId,
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
  logger.info('记录账款事件', {
    paymentRecordId,
    orderNo,
    eventType,
    operatorId,
  }, 'PAYMENT_EVENT')
}

module.exports = { PAYMENT_EVENT, record }
