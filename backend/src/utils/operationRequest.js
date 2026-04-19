const { pool } = require('../config/db')
const AppError = require('./AppError')

const STATUS = {
  PENDING: 0,
  SUCCESS: 1,
  FAILED: 2,
}

function normalizeRequestKey(value) {
  const key = value != null ? String(value).trim() : ''
  return key || null
}

function parseResponseJson(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function getOperationRequest({ requestKey, action, userId, conn = pool, forUpdate = false }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return null
  const uid = userId != null ? Number(userId) : null
  const lockSql = forUpdate ? ' FOR UPDATE' : ''
  const [[row]] = await conn.query(
    `SELECT *
     FROM operation_requests
     WHERE request_key = ? AND action = ? AND user_id <=> ?${lockSql}`,
    [key, String(action), uid],
  )
  if (!row) return null
  return {
    ...row,
    responseData: parseResponseJson(row.response_json),
  }
}

async function beginOperationRequest(conn, { requestKey, action, userId }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return { enabled: false }
  const uid = userId != null ? Number(userId) : null
  const normalizedAction = String(action)

  try {
    const [r] = await conn.query(
      `INSERT INTO operation_requests (request_key, action, user_id, status)
       VALUES (?, ?, ?, ?)`,
      [key, normalizedAction, uid, STATUS.PENDING],
    )
    return {
      enabled: true,
      id: Number(r.insertId),
      requestKey: key,
      action: normalizedAction,
      userId: uid,
      replay: false,
      pending: false,
    }
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error
    const existing = await getOperationRequest({
      requestKey: key,
      action: normalizedAction,
      userId: uid,
      conn,
      forUpdate: true,
    })
    if (!existing) {
      throw new AppError('请求结果暂不可确认，请稍后重试', 409)
    }
    if (Number(existing.status) === STATUS.SUCCESS) {
      return {
        enabled: true,
        id: Number(existing.id),
        requestKey: key,
        action: normalizedAction,
        userId: uid,
        replay: true,
        pending: false,
        responseData: existing.responseData,
        responseMessage: existing.response_message || null,
      }
    }
    if (Number(existing.status) === STATUS.PENDING) {
      throw new AppError('上次提交结果仍待确认，请刷新或稍后查询结果', 409)
    }
    throw new AppError(existing.error_message || '上次提交失败，请重新操作', 409)
  }
}

async function completeOperationRequest(conn, requestState, {
  data = null,
  message = null,
  resourceType = null,
  resourceId = null,
} = {}) {
  if (!requestState?.enabled || !requestState.id) return
  await conn.query(
    `UPDATE operation_requests
     SET status = ?, response_json = ?, response_message = ?, error_message = NULL,
         resource_type = ?, resource_id = ?
     WHERE id = ?`,
    [
      STATUS.SUCCESS,
      JSON.stringify(data ?? null),
      message || null,
      resourceType || null,
      resourceId != null ? Number(resourceId) : null,
      Number(requestState.id),
    ],
  )
}

async function failOperationRequest({ requestKey, action, userId, errorMessage, conn = pool }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return
  const uid = userId != null ? Number(userId) : null
  await conn.query(
    `UPDATE operation_requests
     SET status = ?, error_message = ?
     WHERE request_key = ? AND action = ? AND user_id <=> ? AND status <> ?`,
    [STATUS.FAILED, String(errorMessage || '请求失败').slice(0, 500), key, String(action), uid, STATUS.SUCCESS],
  )
}

async function getOperationRequestStatus({ requestKey, action, userId }) {
  const row = await getOperationRequest({ requestKey, action, userId })
  if (!row) {
    return { status: 'not_found', data: null, message: '未找到该请求记录' }
  }
  if (Number(row.status) === STATUS.SUCCESS) {
    return {
      status: 'success',
      data: row.responseData,
      message: row.response_message || '操作已确认成功',
      resourceType: row.resource_type || null,
      resourceId: row.resource_id != null ? Number(row.resource_id) : null,
    }
  }
  if (Number(row.status) === STATUS.FAILED) {
    return {
      status: 'failed',
      data: null,
      message: row.error_message || '操作失败',
    }
  }
  return {
    status: 'pending',
    data: null,
    message: '结果待确认，请稍后重试查询',
  }
}

module.exports = {
  STATUS,
  beginOperationRequest,
  completeOperationRequest,
  failOperationRequest,
  getOperationRequestStatus,
}
