const crypto = require('node:crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertBoundWarehouseInScope } = require('../../utils/warehouseScope')
const { beginOperationRequest, completeOperationRequest, stableStringify } = require('../../utils/operationRequest')
const { assertPrintBudget } = require('./print-budget')
const { findByIdWithExecutor } = require('./print-jobs.query')

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function assertRawJob(job, actor, uniqueKey, scopeWarehouseIds) {
  assertBoundWarehouseInScope(scopeWarehouseIds, job.warehouseId, '打印任务')
  if (job.createdBy !== actor || job.jobUniqueKey !== uniqueKey || job.refType !== null || job.refId !== null) {
    throw new AppError('原打印请求与任务身份不一致，请核对原操作', 409, 'IDEMPOTENCY_CONFLICT')
  }
}

/** Only the authenticated raw controller supplies rawRequest; domain queue keys stay unchanged. */
async function createRawRecord({ rawRequest, createdBy, scopeWarehouseIds = null, ...input }) {
  const actor = Number(createdBy)
  if (!Number.isSafeInteger(actor) || actor <= 0) throw new AppError('无法确认打印请求人', 401, 'PRINT_REQUEST_ACTOR_REQUIRED')
  const warehouseId = input.warehouseId != null && input.warehouseId !== '' && Number.isFinite(Number(input.warehouseId)) ? Number(input.warehouseId) : null
  assertBoundWarehouseInScope(scopeWarehouseIds, warehouseId, '打印任务')
  // Keep the existing expansion budget before hashing or acquiring a transaction.
  assertPrintBudget(input.content, input.copies ?? 1)
  const clientKey = String(rawRequest.requestKey || input.jobUniqueKey || '').trim()
  if (clientKey.length > 160) throw new AppError('打印请求键长度不能超过 160', 400, 'PRINT_JOB_UNIQUE_KEY_TOO_LONG')
  const payloadHash = digest(stableStringify(rawRequest.payload))
  const keyHash = clientKey ? digest(clientKey) : crypto.randomBytes(32).toString('hex')
  const namespace = `raw:${actor}:${keyHash}:`
  const uniqueKey = namespace + payloadHash
  const requestKey = 'raw:' + keyHash // operation_requests is VARCHAR(80); original key identity is preserved by SHA256.
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // The actor/key receipt serializes first submits before looking up print
    // history. A prefix range lock here would hold gaps while another submit
    // waits on this receipt, causing an insert/receipt lock cycle.
    const operation = clientKey ? await beginOperationRequest(conn, { requestKey, action: 'print.raw.create', userId: actor }) : { enabled: false }
    // Also bind surviving print history after operation receipt TTL cleanup. Never
    // infer a legacy business job from the client key, and never return its body.
    let prior = null
    if (clientKey) {
      const [[row]] = await conn.query(
        'SELECT id FROM print_jobs WHERE job_unique_key LIKE ? AND created_by=? ORDER BY id DESC LIMIT 1',
        [namespace + '%', actor],
      )
      if (row) {
        prior = await findByIdWithExecutor(conn, Number(row.id))
        assertRawJob(prior, actor, uniqueKey, scopeWarehouseIds)
      }
    }
    let job
    if (operation.replay) {
      const receipt = operation.responseData
      const id = Number(receipt?.jobId)
      if (!Number.isSafeInteger(id) || id <= 0 || receipt?.payloadHash !== payloadHash || receipt?.jobUniqueKey !== uniqueKey) {
        throw new AppError('该请求键已有不同打印正文，请核对原操作', 409, 'IDEMPOTENCY_CONFLICT')
      }
      job = await findByIdWithExecutor(conn, id)
      assertRawJob(job, actor, uniqueKey, scopeWarehouseIds)
    } else {
      // Server-only dispatch/reference fields are not raw API parameters.
      const { printerId, templateId, title, contentType, content, copies, priority, jobType } = input
      job = prior || await require('./print-jobs.command').createWithinTransaction(conn, {
        printerId, templateId, title, contentType, content, copies, priority, jobType,
        warehouseId, createdBy: actor, scopeWarehouseIds, jobUniqueKey: uniqueKey,
      })
      assertRawJob(job, actor, uniqueKey, scopeWarehouseIds)
      await completeOperationRequest(conn, operation, {
        data: { jobId: job.id, jobUniqueKey: uniqueKey, payloadHash },
        message: '创建成功', resourceType: 'print_job', resourceId: job.id,
      })
    }
    await conn.commit()
    return job
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

module.exports = { createRawRecord }
