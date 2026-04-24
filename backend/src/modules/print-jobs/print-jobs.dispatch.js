const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { listJobsByIds, findById } = require('./print-jobs.query')
const { STATUS, EXPIRE_MESSAGE, ttlMinutes } = require('./print-jobs.status')

async function claimClientJobs({ clientId, limit = 3 } = {}) {
  const cid = String(clientId || '').trim()
  if (!cid) throw new AppError('clientId 必填', 400, 'PRINT_CLIENT_ID_REQUIRED')
  const n = Math.min(10, Math.max(1, Number(limit) || 3))

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE print_clients
       SET last_seen = NOW(), status = 1
       WHERE client_id = ?`,
      [cid],
    )

    const [rows] = await conn.query(
      `SELECT j.id
       FROM print_jobs j
       INNER JOIN printers p ON p.id = j.printer_id
       WHERE j.status = ?
         AND p.status = 1
         AND p.client_id = ?
       ORDER BY j.priority DESC, j.id ASC
       LIMIT ?
       FOR UPDATE`,
      [STATUS.PENDING, cid, n],
    )
    const ids = rows.map((r) => Number(r.id)).filter(Boolean)
    if (!ids.length) {
      await conn.commit()
      return []
    }

    const jobsWithToken = ids.map((id) => ({
      id,
      ackToken: crypto.randomBytes(16).toString('hex'),
    }))

    for (const job of jobsWithToken) {
      await conn.query(
        `UPDATE print_jobs
         SET status = ?, ack_token = ?, dispatched_at = NOW(), error_message = NULL,
             expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
         WHERE id = ? AND status = ?`,
        [STATUS.PRINTING, job.ackToken, ttlMinutes(), job.id, STATUS.PENDING],
      )
    }

    await conn.commit()

    const jobs = await listJobsByIds(ids, { includeAckToken: true })
    const tokenMap = new Map(jobsWithToken.map((job) => [job.id, job.ackToken]))
    return jobs.map((job) => ({
      ...job,
      ackToken: tokenMap.get(Number(job.id)) || job.ackToken || null,
    }))
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function getDispatchHintForJob(printerCode, jobId) {
  const withClients = (code, message, onlineClients = 0) => ({
    code,
    message,
    onlineClients,
    sseClients: onlineClients,
  })
  const jid = Number(jobId)
  if (!Number.isFinite(jid) || jid <= 0) {
    return withClients('unknown', '', 0)
  }
  let code = String(printerCode || '').trim()
  const job = await findById(jid)
  if (!job) return withClients('unknown', '任务不存在', 0)
  if (!code) code = String(job.printerCode || '').trim()

  const st = Number(job.status)
  if (st === STATUS.PRINTING) {
    return withClients('dispatched', '任务处于打印中（例如已下发至外部集成），请等待核销', 0)
  }
  if (st === STATUS.DONE) {
    return withClients('done', '已完成', 0)
  }
  if (st === STATUS.FAILED) {
    return withClients(
      'failed',
      job.errorMessage ? String(job.errorMessage).slice(0, 200) : '打印失败',
      0,
    )
  }
  if (st !== STATUS.PENDING) return withClients('unknown', '', 0)

  return withClients(
    'no_print_client',
    '任务已入队。请使用 FlowCube 桌面端，在「打印机管理」通过「从本机添加」绑定标签机并绑定用途后，再执行打印；桌面端将按打印机名称本机出纸并核销队列。',
    0,
  )
}

async function pushToClients(_printerCode, _job) {
  return
}

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

function startPrintJobSweeper() {
  if (process.env.DISABLE_PRINT_JOB_SWEEPER === '1') return
  const raw = Number(process.env.PRINT_JOB_SWEEP_MS)
  const ms = raw === 0 ? 0 : Number.isFinite(raw) && raw > 0 ? raw : 60_000
  if (ms <= 0) return
  const tick = () => {
    expireStaleJobs().catch(() => {})
  }
  tick()
  setInterval(tick, ms)
}

module.exports = {
  claimClientJobs,
  getDispatchHintForJob,
  pushToClients,
  expireStaleJobs,
  startPrintJobSweeper,
}
