const { pool } = require('../config/db')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const { hashToken, normalizeScopes } = require('../modules/pda/pda.sessions.service')

function getRouteMeta(req) {
  return {
    method: req.method,
    route: req.originalUrl || req.url,
    userId: req.user?.userId ?? null,
  }
}

function setSessionHint(res) {
  if (!res.headersSent) {
    res.setHeader('X-PDA-Session-Required-Soon', 'true')
  }
}

function logPdaSessionObservation(req, status, extra = {}) {
  const meta = {
    ...getRouteMeta(req),
    hasPdaSession: !!String(req.headers['x-pda-session'] || '').trim(),
    sessionValid: status === 'valid',
    deviceCode: req.pda?.deviceCode ?? null,
    ...extra,
  }
  const msg = 'PDA device session optional check'
  if (status === 'valid') logger.info(msg, meta, 'PDASession')
  else logger.warn(msg, meta, 'PDASession')
}

async function loadPdaSession(token) {
  const tokenHash = hashToken(token)
  const [[row]] = await pool.query(
    `SELECT
        s.id AS session_id,
        s.device_id,
        s.user_id,
        s.scopes,
        s.warehouse_id AS session_warehouse_id,
        s.expires_at,
        s.revoked_at,
        d.device_code,
        d.warehouse_id AS device_warehouse_id,
        d.status AS device_status
     FROM pda_device_sessions s
     INNER JOIN pda_devices d ON d.id = s.device_id
     WHERE s.session_token_hash = ?
     LIMIT 1`,
    [tokenHash],
  )
  return row || null
}

function buildPdaContext(row) {
  return {
    deviceId: Number(row.device_id),
    deviceCode: row.device_code,
    warehouseId: row.session_warehouse_id ?? row.device_warehouse_id ?? null,
    scopes: normalizeScopes(row.scopes),
    sessionId: Number(row.session_id),
  }
}

function pdaSessionOptional() {
  return async (req, res, next) => {
    const token = String(req.headers['x-pda-session'] || '').trim()
    req.pda = null
    if (!token) {
      setSessionHint(res)
      logPdaSessionObservation(req, 'missing', { reason: 'missing_session' })
      return next()
    }

    try {
      const row = await loadPdaSession(token)
      if (!row) {
        setSessionHint(res)
        logPdaSessionObservation(req, 'invalid', { reason: 'session_not_found' })
        return next()
      }
      if (row.revoked_at) {
        setSessionHint(res)
        logPdaSessionObservation(req, 'invalid', { reason: 'session_revoked', sessionId: row.session_id })
        return next()
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        setSessionHint(res)
        logPdaSessionObservation(req, 'invalid', { reason: 'session_expired', sessionId: row.session_id })
        return next()
      }
      if (String(row.device_status) !== 'active') {
        setSessionHint(res)
        logPdaSessionObservation(req, 'invalid', {
          reason: 'device_not_active',
          sessionId: row.session_id,
          deviceCode: row.device_code,
          deviceStatus: row.device_status,
        })
        return next()
      }

      req.pda = buildPdaContext(row)
      try {
        await pool.query(
          `UPDATE pda_device_sessions
           SET last_seen_at = NOW()
           WHERE id = ?`,
          [req.pda.sessionId],
        )
        await pool.query('UPDATE pda_devices SET last_seen_at = NOW() WHERE id = ?', [req.pda.deviceId])
      } catch (seenError) {
        logger.warn(
          'PDA device session last_seen update failed; request allowed for phase 1',
          {
            ...getRouteMeta(req),
            sessionId: req.pda.sessionId,
            deviceCode: req.pda.deviceCode,
            error: seenError?.message || String(seenError),
          },
          'PDASession',
        )
      }
      logPdaSessionObservation(req, 'valid')
      return next()
    } catch (error) {
      setSessionHint(res)
      logger.warn(
        'PDA device session optional check failed; request allowed for phase 1',
        {
          ...getRouteMeta(req),
          hasPdaSession: true,
          sessionValid: false,
          error: error?.message || String(error),
        },
        'PDASession',
      )
      return next()
    }
  }
}

function pdaSessionRequired() {
  return async (req, res, next) => {
    await pdaSessionOptional()(req, res, (error) => {
      if (error) return next(error)
      if (!req.pda) return next(new AppError('需要有效 PDA 设备会话', 403, 'PDA_SESSION_REQUIRED'))
      return next()
    })
  }
}

function requirePdaScope(scope) {
  return (req, _res, next) => {
    if (!req.pda) return next(new AppError('需要有效 PDA 设备会话', 403, 'PDA_SESSION_REQUIRED'))
    if (!req.pda.scopes.includes(scope)) {
      return next(new AppError('PDA 设备会话缺少操作范围', 403, 'PDA_SCOPE_DENIED', { scope }))
    }
    next()
  }
}

module.exports = {
  pdaSessionOptional,
  pdaSessionRequired,
  requirePdaScope,
}
