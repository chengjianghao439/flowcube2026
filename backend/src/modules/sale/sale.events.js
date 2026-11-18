'use strict'

async function appendSaleEvent(conn, saleOrderId, eventType, title, description, operator = null, payload = null) {
  const [result] = await conn.query(
    `INSERT INTO sale_order_events (sale_order_id,event_type,title,description,payload_json,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [
      saleOrderId,
      eventType,
      title,
      description || null,
      payload ? JSON.stringify(payload) : null,
      operator?.userId || null,
      operator?.realName || null,
    ],
  )
  return Number(result.insertId)
}

module.exports = { appendSaleEvent }
