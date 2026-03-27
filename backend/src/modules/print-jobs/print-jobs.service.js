/**
 * print-jobs.service.js
 * 打印任务队列服务
 *
 * 架构：
 *  - PDA / ERP 调用 create() 入队（绑定打印机）
 *  - FlowCube 桌面端可本机直连 ZPL 出纸后 POST /print-jobs/:id/complete-local 核销
 *  - 独立 print-client（SSE/轮询）已移除
 *  - 仍保留 complete / fail（print:client）供自动化或兼容旧集成
 *  - 失败任务最多重试 3 次
 */
const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { resolvePrinterForJob, normalizeJobType } = require('./print-dispatch')
const { recordPrintSuccess, recordPrintFailure } = require('./printer-health')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }
const MAX_RETRY = 3
const EXPIRE_MESSAGE = 'no printer available'

function ttlMinutes() {
  const n = Number(process.env.PRINT_JOB_TTL_MINUTES)
  return Number.isFinite(n) && n > 0 ? n : 30
}

/** API 与前端展示用（DB 仍为 0–3 整型） */
const STATUS_KEY = ['pending', 'printing', 'success', 'failed']

function statusKey(n) {
  const i = Number(n)
  return STATUS_KEY[i] ?? 'unknown'
}

function printStateLabel(n) {
  switch (Number(n)) {
    case STATUS.PENDING: return '排队中'
    case STATUS.PRINTING: return '打印中'
    case STATUS.DONE: return '已打印'
    case STATUS.FAILED: return '打印失败'
    default: return '未知'
  }
}

function parsePriority(raw) {
  if (raw === 1 || raw === '1') return 1
  const s = String(raw || '').toLowerCase()
  if (s === 'high') return 1
  return 0
}

function num(v) {
  if (v == null) return null
  if (typeof v === 'bigint') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmt(row, { includeAckToken = false } = {}) {
  const st = Number(row.status)
  const pr = Number(row.priority ?? 0)
  const o = {
    id:           num(row.id),
    printerId:    num(row.printer_id),
    printerCode:  row.printer_code,
    printerName:  row.printer_name,
    templateId:   num(row.template_id),
    title:        row.title,
    contentType:  row.content_type,
    content:      row.content,
    copies:       row.copies != null ? Number(row.copies) : 0,
    priority:     pr,
    priorityKey:  pr === 1 ? 'high' : 'normal',
    jobType:      row.job_type ?? null,
    warehouseId:  row.warehouse_id != null ? Number(row.warehouse_id) : null,
    tenantId:     row.tenant_id != null ? Number(row.tenant_id) : 0,
    status:       st,
    statusKey:    statusKey(st),
    printStateLabel: printStateLabel(st),
    retryCount:   row.retry_count != null ? Number(row.retry_count) : 0,
    errorMessage: row.error_message,
    expiresAt:    row.expires_at ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    jobUniqueKey: row.job_unique_key ?? null,
    dispatchReason: row.dispatch_reason ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    createdBy:    num(row.created_by),
    createdAt:    row.created_at,
  }
  if (includeAckToken && row.ack_token) o.ackToken = row.ack_token
  return o
}

// ── 查询 ──────────────────────────────────────────────────────────────────────

async function findAll({ printerId, status, page = 1, pageSize = 50, tenantId = 0 } = {}) {
  await expireStaleJobs()
  const tid = Number(tenantId) >= 0 ? Number(tenantId) : 0
  const conds = ['j.tenant_id=?']
  const params = [tid]
  if (printerId) { conds.push('j.printer_id=?'); params.push(printerId) }
  if (status !== undefined && status !== null) { conds.push('j.status=?'); params.push(status) }
  const where = 'WHERE ' + conds.join(' AND ')
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j
     LEFT JOIN printers p ON p.id = j.printer_id
     ${where} ORDER BY j.priority DESC, j.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM print_jobs j ${where}`, params
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id, { tenantId } = {}) {
  let sql = `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j LEFT JOIN printers p ON p.id = j.printer_id
     WHERE j.id=?`
  const params = [id]
  if (tenantId !== undefined) {
    sql += ' AND j.tenant_id=?'
    params.push(Number(tenantId))
  }
  const [[row]] = await pool.query(sql, params)
  if (!row) throw new AppError('打印任务不存在', 404)
  return fmt(row)
}

// ── 创建任务（PDA / ERP 调用）────────────────────────────────────────────────

async function create({
  printerId,
  warehouseId: warehouseIdIn,
  jobType: jobTypeIn,
  priority: priorityIn,
  jobUniqueKey: jobUniqueKeyRaw,
  dispatchReason: dispatchReasonIn,
  templateId,
  title,
  contentType = 'html',
  content,
  copies = 1,
  createdBy,
  tenantId: tenantIdIn,
}) {
  const tid = Number(tenantIdIn) >= 0 && Number.isFinite(Number(tenantIdIn)) ? Number(tenantIdIn) : 0
  if (!content) throw new AppError('打印内容不能为空', 400)
  if (!title) throw new AppError('任务标题不能为空', 400)

  const jobUniqueKey = jobUniqueKeyRaw != null ? String(jobUniqueKeyRaw).trim() || null : null
  if (jobUniqueKey && jobUniqueKey.length > 160) {
    throw new AppError('jobUniqueKey 长度不能超过 160', 400)
  }

  const priority = parsePriority(priorityIn)
  const jobTypeNorm = normalizeJobType(jobTypeIn, contentType)
  const warehouseId =
    warehouseIdIn != null && warehouseIdIn !== '' && Number.isFinite(Number(warehouseIdIn))
      ? Number(warehouseIdIn)
      : null

  if (jobUniqueKey) {
    const [[dup]] = await pool.query(
      `SELECT id FROM print_jobs
       WHERE job_unique_key=? AND status IN (?,?,?)
         AND (warehouse_id <=> ?) AND (job_type <=> ?) AND (tenant_id <=> ?)
       ORDER BY id DESC LIMIT 1`,
      [jobUniqueKey, STATUS.PENDING, STATUS.PRINTING, STATUS.DONE, warehouseId, jobTypeNorm, tid],
    )
    if (dup && dup.id != null) return findById(Number(dup.id))
  }

  const explicitPrinter =
    printerId != null &&
    printerId !== '' &&
    Number.isFinite(Number(printerId)) &&
    Number(printerId) > 0

  let resolvedId = explicitPrinter ? Number(printerId) : null
  let dispatchReason = 'explicit'

  if (!explicitPrinter) {
    const r = await resolvePrinterForJob({
      tenantId: tid,
      warehouseId: warehouseId ?? undefined,
      jobType: jobTypeNorm,
      contentType,
    })
    resolvedId = r.printerId
    dispatchReason = r.dispatchReason || 'fallback'
  }
  if (dispatchReasonIn) dispatchReason = String(dispatchReasonIn)

  if (!resolvedId) {
    throw new AppError('无法分配打印机：请指定 printerId，或传入 warehouseId 并配置打印机用途绑定', 400)
  }

  const [[printer]] = await pool.query(
    'SELECT id, code, status FROM printers WHERE id=? AND (tenant_id=? OR tenant_id=0)',
    [resolvedId, tid],
  )
  if (!printer) throw new AppError('打印机不存在', 400)

  const ttl = ttlMinutes()
  const [r] = await pool.query(
    `INSERT INTO print_jobs (printer_id, template_id, title, content_type, content, copies, priority, job_type, warehouse_id, tenant_id, job_unique_key, dispatch_reason, created_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [
      resolvedId,
      templateId || null,
      title,
      contentType,
      content,
      copies,
      priority,
      jobTypeNorm,
      warehouseId,
      tid,
      jobUniqueKey,
      dispatchReason,
      createdBy || null,
      ttl,
    ],
  )
  const insertId = r.insertId != null ? Number(r.insertId) : NaN
  if (!Number.isFinite(insertId) || insertId <= 0) {
    throw new AppError('创建打印任务失败（无法解析任务 ID）', 500)
  }
  const job = await findById(insertId)

  try {
    await pushToClients(printer.code, job)
  } catch (e) {
    logger.error(
      `[print-jobs] pushToClients 失败（任务已入库 id=${insertId}）`,
      e instanceof Error ? e : new Error(String(e)),
      { printerCode: printer.code },
      'PrintJobs',
    )
  }

  return findById(insertId)
}

// ── 打印客户端回调：完成 ──────────────────────────────────────────────────────

async function complete(id, { ackToken } = {}, { tenantId } = {}) {
  const job = await findById(id, { tenantId })
  if (job.status === STATUS.DONE) return job
  if (job.status === STATUS.FAILED) {
    throw new AppError('任务已失败，无法标记为完成', 400)
  }
  const [[sec]] = await pool.query('SELECT ack_token FROM print_jobs WHERE id=?', [id])
  if (sec?.ack_token) {
    const t = String(ackToken || '').trim()
    if (!t || t !== sec.ack_token) {
      throw new AppError('打印确认令牌无效或缺失', 400)
    }
  }
  const [[latRow]] = await pool.query(
    `SELECT printer_id,
            TIMESTAMPDIFF(MICROSECOND, dispatched_at, NOW()) / 1000 AS latency_ms
     FROM print_jobs WHERE id=? AND dispatched_at IS NOT NULL`,
    [id],
  )
  const latencyMs =
    latRow && latRow.latency_ms != null && Number(latRow.latency_ms) > 0
      ? Number(latRow.latency_ms)
      : null

  await pool.query(
    'UPDATE print_jobs SET status=?, error_message=NULL, ack_token=NULL, acknowledged_at=NOW() WHERE id=? AND tenant_id=?',
    [STATUS.DONE, id, job.tenantId],
  )
  if (latRow?.printer_id && latencyMs != null) {
    await recordPrintSuccess(latRow.printer_id, latencyMs, job.tenantId).catch(() => {})
  }
  return findById(id, { tenantId })
}

/**
 * ERP 桌面端本机出纸后核销：仅允许仍为「待打印」且未生成 ack_token 的任务（未被打印工作站领取）
 */
async function completeLocalDesktop(id, { tenantId } = {}) {
  const job = await findById(id, { tenantId })
  if (job.status === STATUS.DONE) return job
  if (job.status === STATUS.FAILED) {
    throw new AppError('任务已失败，无法核销', 400)
  }
  if (job.status === STATUS.PRINTING) {
    throw new AppError('任务已被打印工作站领取，无法本机核销', 409)
  }
  if (job.status !== STATUS.PENDING) {
    throw new AppError('无法核销该任务', 400)
  }
  const [[sec]] = await pool.query('SELECT ack_token FROM print_jobs WHERE id=?', [id])
  if (sec?.ack_token) {
    throw new AppError('任务已下发至工作站，请使用打印客户端确认完成', 409)
  }
  const [ur] = await pool.query(
    'UPDATE print_jobs SET status=?, error_message=NULL, ack_token=NULL, acknowledged_at=NOW() WHERE id=? AND tenant_id=? AND status=?',
    [STATUS.DONE, id, job.tenantId, STATUS.PENDING],
  )
  if (!ur.affectedRows) {
    throw new AppError('任务状态已变更，请刷新后重试', 409)
  }
  return findById(id, { tenantId })
}

// ── 打印客户端回调：失败 ──────────────────────────────────────────────────────

async function fail(id, errorMessage, { tenantId } = {}) {
  const job = await findById(id, { tenantId })
  if (job.status === STATUS.DONE) return job
  if (job.status === STATUS.FAILED && job.retryCount >= MAX_RETRY) return job

  await recordPrintFailure(job.printerId, job.tenantId).catch(() => {})

  const newRetry = job.retryCount + 1
  const newStatus = newRetry >= MAX_RETRY ? STATUS.FAILED : STATUS.PENDING
  const msg = errorMessage || '未知错误'
  if (newStatus === STATUS.PENDING) {
    await pool.query(
      'UPDATE print_jobs SET status=?, retry_count=?, error_message=?, ack_token=NULL, dispatched_at=NULL, expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=? AND tenant_id=?',
      [newStatus, newRetry, msg, ttlMinutes(), id, job.tenantId],
    )
  } else {
    await pool.query(
      'UPDATE print_jobs SET status=?, retry_count=?, error_message=?, ack_token=NULL, dispatched_at=NULL WHERE id=? AND tenant_id=?',
      [newStatus, newRetry, msg, id, job.tenantId],
    )
  }
  // 如果还有重试机会，重新推送
  if (newStatus === STATUS.PENDING) {
    const updated = await findById(id, { tenantId })
    const [[printer]] = await pool.query('SELECT code FROM printers WHERE id=?', [job.printerId])
    if (printer) await pushToClients(printer.code, updated)
  }
  return findById(id, { tenantId })
}

// ── 手动重试 ──────────────────────────────────────────────────────────────────

async function retry(id, { tenantId } = {}) {
  const job = await findById(id, { tenantId })
  await pool.query(
    'UPDATE print_jobs SET status=0, retry_count=0, error_message=NULL, ack_token=NULL, dispatched_at=NULL, expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=? AND tenant_id=?',
    [ttlMinutes(), id, job.tenantId],
  )
  const updated = await findById(id, { tenantId })
  const [[printer]] = await pool.query('SELECT code FROM printers WHERE id=?', [job.printerId])
  if (printer) await pushToClients(printer.code, updated)
  return updated
}

/**
 * 入队后给前端的提示（独立 print-client 已移除；桌面端走本机直连 + complete-local）
 * @returns {{ code: string, message: string, sseClients: number }}
 */
async function getDispatchHintForJob(printerCode, jobId) {
  const jid = Number(jobId)
  if (!Number.isFinite(jid) || jid <= 0) {
    return { code: 'unknown', message: '', sseClients: 0 }
  }
  let code = String(printerCode || '').trim()
  const job = await findById(jid)
  if (!job) return { code: 'unknown', message: '任务不存在', sseClients: 0 }
  if (!code) code = String(job.printerCode || '').trim()

  const st = Number(job.status)
  if (st === STATUS.PRINTING) {
    return {
      code: 'dispatched',
      message: '任务处于打印中（例如已下发至外部集成），请等待核销',
      sseClients: 0,
    }
  }
  if (st === STATUS.DONE) {
    return { code: 'done', message: '已完成', sseClients: 0 }
  }
  if (st === STATUS.FAILED) {
    return {
      code: 'failed',
      message: job.errorMessage ? String(job.errorMessage).slice(0, 200) : '打印失败',
      sseClients: 0,
    }
  }
  if (st !== STATUS.PENDING) {
    return { code: 'unknown', message: '', sseClients: 0 }
  }

  return {
    code: 'no_print_client',
    message:
      '任务已入队。请使用 FlowCube 桌面端，在「打印机管理」通过「从本机添加」绑定标签机并绑定用途后，再执行打印；桌面端将按打印机名称本机出纸并核销队列。',
    sseClients: 0,
  }
}

/** 原 SSE 推送入口；独立打印客户端已移除，此处不再下发 */
async function pushToClients(_printerCode, _job) {
  return
}

/** ZPL 容器标签（Code128），供斑马等标签机 */
function buildContainerLabelZpl({ container_code, product_name, qty }) {
  const code = String(container_code ?? '').replace(/[\r\n^~]/g, '')
  const name = String(product_name ?? '')
    .slice(0, 32)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
  const q = Number(qty)
  const qtyStr = Number.isFinite(q) ? String(q) : String(qty ?? '')
  return `^XA^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,24,24^FD${name}^FS^FO32,148^A0N,24,24^FDQTY ${qtyStr}^FS^XZ`
}

/** ZPL 货架标签 */
function buildRackLabelZpl({ rack_barcode, rack_code, zone, name }) {
  const code = String(rack_barcode ?? '').replace(/[\r\n^~]/g, '')
  const rc = String(rack_code ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 28)
  const z = String(zone ?? '').slice(0, 12)
  const n = String(name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  return `^XA^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${rc}^FS^FO32,138^A0N,20,20^FD${z} ${n}^FS^XZ`
}

/** ZPL 物流箱贴 */
function buildPackageLabelZpl({ box_code, task_no, customer_name, summary }) {
  const bc = String(box_code ?? '').replace(/[\r\n^~]/g, '')
  const tn = String(task_no ?? '').slice(0, 24)
  const cn = String(customer_name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 24)
  const sm = String(summary ?? '').slice(0, 36)
  return `^XA^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${bc}^FS^FO32,108^A0N,22,22^FD${tn}^FS^FO32,142^A0N,20,20^FD${cn}^FS^FO32,176^A0N,18,18^FD${sm}^FS^XZ`
}

/**
 * 解析用于容器标签的打印机：优先环境变量 code，否则第一台「在线 + 标签机 type=1」
 */
async function resolveLabelPrinterId(tenantId = 0) {
  const tid = Number(tenantId) >= 0 ? Number(tenantId) : 0
  const code = (process.env.INBOUND_LABEL_PRINTER_CODE || process.env.PDA_LABEL_PRINTER_CODE || '').trim()
  if (code) {
    const [[byCode]] = await pool.query(
      'SELECT id, code FROM printers WHERE code = ? AND status = 1 AND (tenant_id = ? OR tenant_id = 0)',
      [code, tid],
    )
    if (byCode) return byCode.id
    logger.warn(`[print] 环境变量指定的标签机 code=${code} 不存在或未在线，将尝试使用默认标签机`, {}, 'PrintJobs')
  }
  const [[first]] = await pool.query(
    `SELECT id, code FROM printers WHERE status = 1 AND type = 1 AND (tenant_id = ? OR tenant_id = 0)
     ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, id ASC LIMIT 1`,
    [tid, tid],
  )
  return first?.id ?? null
}

/**
 * 入库收货后排队打印容器条码
 * payload: { type?: 'container_label', data: { container_code, product_name, qty }, createdBy }
 */
async function enqueueContainerLabelJob(payload) {
  const data = payload?.data
  if (!data?.container_code) return null
  const tid = Number(payload.tenantId) >= 0 && Number.isFinite(Number(payload.tenantId)) ? Number(payload.tenantId) : 0
  const wh = payload.warehouseId != null ? Number(payload.warehouseId) : null
  const resolved = await resolvePrinterForJob({
    tenantId: tid,
    warehouseId: wh ?? undefined,
    jobType: 'inventory_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId(tid)
    dispatchReason = 'fallback'
  }
  if (!printerId) return null
  const zpl = buildContainerLabelZpl({
    container_code: data.container_code,
    product_name: data.product_name,
    qty: data.qty,
  })
  return create({
    printerId,
    dispatchReason,
    tenantId: tid,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'inventory_label',
    title: `容器标 ${data.container_code}`,
    contentType: 'zpl',
    content: zpl,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey,
  })
}

/**
 * 货架条码标签入队
 * payload: { rackId, tenantId?, createdBy?, jobUniqueKey? }
 */
async function enqueueRackLabelJob(payload) {
  const rackId = payload?.rackId
  if (!rackId) return null
  const tid = Number(payload.tenantId) >= 0 && Number.isFinite(Number(payload.tenantId)) ? Number(payload.tenantId) : 0
  let row
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.barcode, r.code, r.zone, r.name, r.warehouse_id
       FROM warehouse_racks r
       WHERE r.id = ? AND r.deleted_at IS NULL`,
      [rackId],
    )
    row = rows[0]
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column ['`]?barcode/i.test(String(e.message))) {
      throw new AppError('数据库缺少 warehouse_racks.barcode，请执行迁移 051_warehouse_racks_barcode.sql', 503)
    }
    throw e
  }
  if (!row || !row.barcode) return null
  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  // 与打印机管理中「库存标签」绑定一致（inventory_label），勿单独使用未绑定的 rack_label
  const resolved = await resolvePrinterForJob({
    tenantId: tid,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType: 'inventory_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId(tid)
    dispatchReason = 'fallback'
  }
  if (!printerId) return null
  const zpl = buildRackLabelZpl({
    rack_barcode: row.barcode,
    rack_code: row.code,
    zone: row.zone,
    name: row.name,
  })
  try {
    const job = await create({
      printerId,
      dispatchReason,
      tenantId: tid,
      warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
      jobType: 'inventory_label',
      title: `货架标 ${row.barcode}`,
      contentType: 'zpl',
      content: zpl,
      copies: 1,
      createdBy: payload.createdBy ?? null,
      jobUniqueKey: payload.jobUniqueKey ?? null,
    })
    const dispatchHint = await getDispatchHintForJob(job.printerCode, job.id)
    // 始终附带 ZPL：桌面端本机 RAW 出纸需要；仅登录用户可调此接口，不依赖自定义头
    return {
      id: job.id,
      printerCode: job.printerCode,
      printerName: job.printerName,
      dispatchHint,
      contentType: 'zpl',
      content: zpl,
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(String(e.message))) {
      throw new AppError('打印入库失败：数据库字段异常，请先执行迁移或联系管理员', 503)
    }
    throw e
  }
}

/**
 * 物流箱贴入队（完成装箱或补打）
 * payload: { packageId, tenantId?, createdBy?, jobUniqueKey? }
 */
async function enqueuePackageLabelJob(payload) {
  const packageId = payload?.packageId
  if (!packageId) return null
  const tid = Number(payload.tenantId) >= 0 && Number.isFinite(Number(payload.tenantId)) ? Number(payload.tenantId) : 0
  const [[row]] = await pool.query(
    `SELECT p.id, p.barcode, wt.task_no, wt.customer_name, wt.warehouse_id,
            (SELECT COUNT(*) FROM package_items pi WHERE pi.package_id = p.id) AS line_count,
            (SELECT COALESCE(SUM(pi.qty), 0) FROM package_items pi WHERE pi.package_id = p.id) AS total_qty
     FROM packages p
     JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.id = ?`,
    [packageId],
  )
  if (!row) return null
  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  const summary = `${Number(row.line_count)} 行 / ${Number(row.total_qty)} 件`
  const resolved = await resolvePrinterForJob({
    tenantId: tid,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType: 'package_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId(tid)
    dispatchReason = 'fallback'
  }
  if (!printerId) return null
  const zpl = buildPackageLabelZpl({
    box_code: row.barcode,
    task_no: row.task_no,
    customer_name: row.customer_name,
    summary,
  })
  return create({
    printerId,
    dispatchReason,
    tenantId: tid,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'package_label',
    title: `箱贴 ${row.barcode}`,
    contentType: 'zpl',
    content: zpl,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey ?? null,
  })
}

/** 将超时仍处 pending/printing 的任务标为失败（无可用打印机在规定时间内完成） */
async function expireStaleJobs() {
  const [r] = await pool.query(
    `UPDATE print_jobs
     SET status=?, error_message=?
     WHERE status IN (?, ?)
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`,
    [STATUS.FAILED, EXPIRE_MESSAGE, STATUS.PENDING, STATUS.PRINTING],
  )
  return r.affectedRows ?? 0
}

/** 监控：待打印数、失败数（会先执行过期清扫） */
async function getStatsCounts(tenantId = 0) {
  const tid = Number(tenantId) >= 0 ? Number(tenantId) : 0
  await expireStaleJobs()
  const [[p]] = await pool.query(
    'SELECT COUNT(*) AS c FROM print_jobs WHERE tenant_id=? AND status=?',
    [tid, STATUS.PENDING],
  )
  const [[f]] = await pool.query(
    'SELECT COUNT(*) AS c FROM print_jobs WHERE tenant_id=? AND status=?',
    [tid, STATUS.FAILED],
  )
  return { pending: Number(p.c), failed: Number(f.c) }
}

/** 打印机健康度快照（error_rate / avg_latency_ms） */
async function listPrinterHealth(tenantId = 0) {
  const tid = Number(tenantId) >= 0 ? Number(tenantId) : 0
  const [rows] = await pool.query(
    `SELECT h.printer_id, h.error_rate, h.avg_latency_ms, h.sample_count, h.updated_at,
            p.code AS printer_code, p.name AS printer_name
     FROM printer_health_stats h
     LEFT JOIN printers p ON p.id = h.printer_id
     WHERE h.tenant_id = ?
     ORDER BY h.printer_id ASC`,
    [tid],
  )
  return rows.map((r) => ({
    tenantId: tid,
    printerId: Number(r.printer_id),
    printerCode: r.printer_code,
    printerName: r.printer_name,
    errorRate: Number(r.error_rate),
    avgLatencyMs: Number(r.avg_latency_ms),
    sampleCount: Number(r.sample_count),
    updatedAt: r.updated_at,
  }))
}

/** 列表查询 ?status= 支持数字或 pending|printing|success|failed|done */
function parseListStatus(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined
  const map = {
    pending: STATUS.PENDING,
    printing: STATUS.PRINTING,
    success: STATUS.DONE,
    done: STATUS.DONE,
    failed: STATUS.FAILED,
  }
  const key = String(raw).toLowerCase()
  if (map[key] !== undefined) return map[key]
  const n = Number(raw)
  return Number.isNaN(n) ? undefined : n
}

if (process.env.DISABLE_PRINT_JOB_SWEEPER !== '1') {
  const raw = Number(process.env.PRINT_JOB_SWEEP_MS)
  const ms = raw === 0 ? 0 : Number.isFinite(raw) && raw > 0 ? raw : 60_000
  if (ms > 0) {
    const tick = () => {
      expireStaleJobs().catch(() => {})
    }
    tick()
    setInterval(tick, ms)
  }
}

module.exports = {
  findAll,
  findById,
  create,
  complete,
  completeLocalDesktop,
  normalizeJobType,
  resolvePrinterForJob,
  fail,
  retry,
  expireStaleJobs,
  getStatsCounts,
  listPrinterHealth,
  STATUS,
  parseListStatus,
  enqueueContainerLabelJob,
  enqueueRackLabelJob,
  getDispatchHintForJob,
  enqueuePackageLabelJob,
  buildContainerLabelZpl,
  buildRackLabelZpl,
  buildPackageLabelZpl,
}
