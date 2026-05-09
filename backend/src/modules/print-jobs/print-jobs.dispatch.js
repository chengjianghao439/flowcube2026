const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { listJobsByIds, findById } = require('./print-jobs.query')
const { STATUS, EXPIRE_MESSAGE, ttlMinutes } = require('./print-jobs.status')

// 打印调度当前为客户端轮询模式：桌面客户端通过 claimClientJobs() 领取 PENDING 任务。
// 本模块不提供实时推送通道，避免创建/重试路径误以为存在 push dispatch。
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
  const withClients = (code, message, onlineClients = 0, extra = {}) => ({
    code,
    message,
    onlineClients,
    sseClients: onlineClients,
    ...extra,
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

  const [[printer]] = await pool.query(
    `SELECT
        p.id,
        p.code,
        p.name,
        p.client_id,
        pc.status AS client_status,
        pc.last_seen,
        TIMESTAMPDIFF(SECOND, pc.last_seen, NOW()) AS seconds_since_seen
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id = ?`,
    [job.printerId],
  )
  const secondsSinceSeen = Number(printer?.seconds_since_seen)
  const clientOnline =
    Number(printer?.client_status) === 1
    && Number.isFinite(secondsSinceSeen)
    && secondsSinceSeen >= 0
    && secondsSinceSeen <= 30
  const base = {
    printerId: job.printerId,
    printerCode: printer?.code ?? job.printerCode ?? null,
    printerName: printer?.name ?? job.printerName ?? null,
    clientId: printer?.client_id ?? null,
    clientOnline,
    clientLastSeen: printer?.last_seen ?? null,
  }
  if (!printer?.client_id) {
    return withClients(
      'client_not_bound',
      '任务已入队，但绑定打印机尚未关联桌面客户端。请在连接该打印机的 极序 Flow 桌面端「从本机添加」打印机后继续派发。',
      0,
      base,
    )
  }
  if (!clientOnline) {
    return withClients(
      'client_offline',
      '任务已入队，绑定打印机的桌面客户端当前离线。请启动连接该打印机的 极序 Flow 桌面端，客户端上线后会继续领取待派发任务。',
      0,
      base,
    )
  }
  return withClients(
    'waiting_client',
    '任务已入队，正在等待绑定打印机的桌面客户端领取。',
    1,
    base,
  )
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
    expireStaleJobs().catch((e) => {
      logger.error(
        '打印任务过期扫描失败，队列可能存在卡住的 pending/printing 任务',
        e instanceof Error ? e : new Error(String(e)),
        { degradation: 'print_job_sweeper_failed' },
        'PrintJobs',
      )
    })
  }
  tick()
  setInterval(tick, ms)
}

module.exports = {
  claimClientJobs,
  getDispatchHintForJob,
  expireStaleJobs,
  startPrintJobSweeper,
}
