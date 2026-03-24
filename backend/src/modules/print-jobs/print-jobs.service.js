/**
 * print-jobs.service.js
 * 打印任务队列服务
 *
 * 架构：
 *  - PDA / ERP 调用 create() 投入任务
 *  - 桌面端打印客户端通过 SSE 订阅 /api/print-jobs/listen/:printerCode
 *  - 客户端拿到任务后执行本地打印，完成后回调 complete() 或 fail()
 *  - 失败任务最多重试 3 次
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }
const MAX_RETRY = 3

// SSE 客户端注册表：printerCode → Set<res>
const sseClients = new Map()

function fmt(row) {
  return {
    id:           row.id,
    printerId:    row.printer_id,
    printerCode:  row.printer_code,
    printerName:  row.printer_name,
    templateId:   row.template_id,
    title:        row.title,
    contentType:  row.content_type,
    content:      row.content,
    copies:       row.copies,
    status:       row.status,
    retryCount:   row.retry_count,
    errorMessage: row.error_message,
    createdBy:    row.created_by,
    createdAt:    row.created_at,
  }
}

// ── 查询 ──────────────────────────────────────────────────────────────────────

async function findAll({ printerId, status, page = 1, pageSize = 50 } = {}) {
  const conds = []
  const params = []
  if (printerId) { conds.push('j.printer_id=?'); params.push(printerId) }
  if (status !== undefined && status !== null) { conds.push('j.status=?'); params.push(status) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j
     LEFT JOIN printers p ON p.id = j.printer_id
     ${where} ORDER BY j.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM print_jobs j ${where}`, params
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j LEFT JOIN printers p ON p.id = j.printer_id
     WHERE j.id=?`, [id]
  )
  if (!row) throw new AppError('打印任务不存在', 404)
  return fmt(row)
}

// ── 创建任务（PDA / ERP 调用）────────────────────────────────────────────────

async function create({ printerId, templateId, title, contentType = 'html', content, copies = 1, createdBy }) {
  if (!printerId) throw new AppError('请指定打印机', 400)
  if (!content)   throw new AppError('打印内容不能为空', 400)
  if (!title)     throw new AppError('任务标题不能为空', 400)

  const [[printer]] = await pool.query('SELECT id, code, status FROM printers WHERE id=?', [printerId])
  if (!printer) throw new AppError('打印机不存在', 400)

  const [r] = await pool.query(
    `INSERT INTO print_jobs (printer_id, template_id, title, content_type, content, copies, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [printerId, templateId || null, title, contentType, content, copies, createdBy || null]
  )
  const job = await findById(r.insertId)

  // 实时推送给已连接的打印客户端
  pushToClients(printer.code, job)

  return job
}

// ── 打印客户端回调：完成 ──────────────────────────────────────────────────────

async function complete(id) {
  const job = await findById(id)
  if (job.status === STATUS.DONE) return job
  await pool.query(
    'UPDATE print_jobs SET status=?, error_message=NULL WHERE id=?',
    [STATUS.DONE, id]
  )
  return findById(id)
}

// ── 打印客户端回调：失败 ──────────────────────────────────────────────────────

async function fail(id, errorMessage) {
  const job = await findById(id)
  const newRetry = job.retryCount + 1
  const newStatus = newRetry >= MAX_RETRY ? STATUS.FAILED : STATUS.PENDING
  await pool.query(
    'UPDATE print_jobs SET status=?, retry_count=?, error_message=? WHERE id=?',
    [newStatus, newRetry, errorMessage || '未知错误', id]
  )
  // 如果还有重试机会，重新推送
  if (newStatus === STATUS.PENDING) {
    const updated = await findById(id)
    const [[printer]] = await pool.query('SELECT code FROM printers WHERE id=?', [job.printerId])
    if (printer) pushToClients(printer.code, updated)
  }
  return findById(id)
}

// ── 手动重试 ──────────────────────────────────────────────────────────────────

async function retry(id) {
  const job = await findById(id)
  await pool.query(
    'UPDATE print_jobs SET status=0, retry_count=0, error_message=NULL WHERE id=?', [id]
  )
  const updated = await findById(id)
  const [[printer]] = await pool.query('SELECT code FROM printers WHERE id=?', [job.printerId])
  if (printer) pushToClients(printer.code, updated)
  return updated
}

// ── SSE：注册客户端 ───────────────────────────────────────────────────────────

function registerClient(printerCode, res) {
  if (!sseClients.has(printerCode)) sseClients.set(printerCode, new Set())
  sseClients.get(printerCode).add(res)

  // 连接后立即推送队列中待打印任务
  flushPendingToClient(printerCode, res)

  res.on('close', () => {
    sseClients.get(printerCode)?.delete(res)
  })
}

async function flushPendingToClient(printerCode, res) {
  try {
    const [[printer]] = await pool.query('SELECT id FROM printers WHERE code=?', [printerCode])
    if (!printer) return
    const [rows] = await pool.query(
      `SELECT j.*, p.code AS printer_code, p.name AS printer_name
       FROM print_jobs j LEFT JOIN printers p ON p.id=j.printer_id
       WHERE j.printer_id=? AND j.status=0 ORDER BY j.id ASC`,
      [printer.id]
    )
    rows.forEach(row => {
      res.write(`data: ${JSON.stringify(fmt(row))}\n\n`)
    })
    // 标记为打印中
    if (rows.length) {
      await pool.query(
        `UPDATE print_jobs SET status=1 WHERE printer_id=? AND status=0`,
        [printer.id]
      )
    }
  } catch { /* 静默 */ }
}

function pushToClients(printerCode, job) {
  const clients = sseClients.get(printerCode)
  if (!clients || clients.size === 0) return
  const payload = `data: ${JSON.stringify(job)}\n\n`
  clients.forEach(res => {
    try { res.write(payload) } catch { clients.delete(res) }
  })
}

module.exports = { findAll, findById, create, complete, fail, retry, registerClient, STATUS }
