const { pool } = require('../../config/db')
const logger = require('../../utils/logger')
const { getRequestContext, getRequestId } = require('../../utils/requestContext')

const AUTH_AUDIT_EVENT = Object.freeze({
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  TOKEN_REFRESHED: 'token_refreshed',
  PERMISSION_DENIED: 'permission_denied',
  INACTIVE_USER_DENIED: 'inactive_user_denied',
})

async function recordAuthAudit({
  eventType,
  title,
  description = null,
  userId = null,
  username = null,
  payload = null,
}) {
  const ctx = getRequestContext() || {}
  try {
    await pool.query(
      `INSERT INTO auth_audit_logs
         (event_type, title, description, payload_json, user_id, username, request_id, method, path, ip, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        eventType,
        title,
        description,
        payload ? JSON.stringify(payload) : null,
        userId,
        username,
        getRequestId(),
        ctx.method || null,
        ctx.path || null,
        ctx.ip || null,
        ctx.userAgent || null,
      ],
    )
  } catch (error) {
    logger.error('写入鉴权审计失败', error, { eventType, userId, username }, 'AUTH_AUDIT')
  }

  logger.info(title, {
    eventType,
    userId,
    username,
    requestId: getRequestId(),
  }, 'AUTH_AUDIT')
}

module.exports = { AUTH_AUDIT_EVENT, recordAuthAudit }
