const { pool } = require('../../config/db')

function num(v) {
  if (v == null) return null
  if (typeof v === 'bigint') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmt(row, { includeAckToken = false, statusKey, printStateLabel } = {}) {
  const st = Number(row.status)
  const pr = Number(row.priority ?? 0)
  const o = {
    id: num(row.id),
    printerId: num(row.printer_id),
    printerCode: row.printer_code,
    printerName:
      row.printer_name != null && String(row.printer_name).trim()
        ? String(row.printer_name).trim()
        : null,
    templateId: num(row.template_id),
    title: row.title,
    contentType: row.content_type,
    content: row.content,
    copies: row.copies != null ? Number(row.copies) : 0,
    priority: pr,
    priorityKey: pr === 1 ? 'high' : 'normal',
    jobType: row.job_type ?? null,
    warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
    status: st,
    statusKey,
    printStateLabel,
    retryCount: row.retry_count != null ? Number(row.retry_count) : 0,
    errorMessage: row.error_message,
    expiresAt: row.expires_at ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    jobUniqueKey: row.job_unique_key ?? null,
    dispatchReason: row.dispatch_reason ?? null,
    refType: row.ref_type ?? null,
    refId: row.ref_id != null ? Number(row.ref_id) : null,
    refCode: row.ref_code ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    createdBy: num(row.created_by),
    createdAt: row.created_at,
  }
  if (includeAckToken && row.ack_token) o.ackToken = row.ack_token
  return o
}

async function appendInboundPrintEventByJob(job, eventType, title, description = null, payload = null) {
  if (!job || job.refType !== 'inventory_container' || !job.refId) return
  const [[container]] = await pool.query(
    `SELECT inbound_task_id, barcode
     FROM inventory_containers
     WHERE id = ? AND deleted_at IS NULL`,
    [job.refId],
  )
  if (!container?.inbound_task_id) return
  await pool.query(
    `INSERT INTO inbound_task_events (task_id, event_type, title, description, payload_json, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [
      Number(container.inbound_task_id),
      eventType,
      title,
      description,
      payload ? JSON.stringify(payload) : null,
      null,
      '打印中心',
    ],
  )
}

module.exports = {
  num,
  fmt,
  appendInboundPrintEventByJob,
}
