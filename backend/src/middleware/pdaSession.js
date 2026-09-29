const { pool } = require('../config/db')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const { hashToken, normalizeScopes } = require('../modules/pda/pda.sessions.service')

/**
 * PDA 设备会话校验（强制）。
 *
 * 每台 PDA 必须先在 ERP「系统 → PDA 设备」登记、再扫码绑定，之后所有作业请求都要带
 * 有效的 X-PDA-Session 票据。没票据、票据过期、票据被吊销、设备被停用，一律 403。
 *
 * 校验通过后把设备身份挂到 req.pda，业务层据此做跨仓拦截：
 * 绑了 A 仓的机器扫 B 仓的单据会被直接拒绝（见 inbound-tasks 的 pdaWarehouseId 校验）。
 *
 * 历史：这里曾经有一个观察模式（无票据放行）和 env.PDA_SESSION_REQUIRED 开关，
 * 用于让存量 PDA 平滑过渡。系统尚未投产、不存在存量设备，因此直接写死为强制，
 * 少一个开关就少一处「以为开了其实没开」的隐患。
 */

function getRouteMeta(req) {
  return {
    method: req.method,
    route: req.originalUrl || req.url,
    userId: req.user?.userId ?? null,
  }
}

function denySession(req, next, reason, message) {
  logger.warn(
    'PDA device session denied',
    {
      ...getRouteMeta(req),
      hasPdaSession: !!String(req.headers['x-pda-session'] || '').trim(),
      reason,
    },
    'PDASession',
  )
  return next(new AppError(message, 403, 'PDA_SESSION_REQUIRED'))
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
    userId: Number(row.user_id),
    deviceId: Number(row.device_id),
    deviceCode: row.device_code,
    warehouseId: row.session_warehouse_id ?? row.device_warehouse_id ?? null,
    scopes: normalizeScopes(row.scopes),
    sessionId: Number(row.session_id),
  }
}

function pdaSessionRequired() {
  return async (req, res, next) => {
    const token = String(req.headers['x-pda-session'] || '').trim()
    req.pda = null
    if (!token) {
      return denySession(req, next, 'missing_session', '该 PDA 未绑定设备，请先在「设备绑定」中扫码绑定后再作业')
    }

    let row
    try {
      row = await loadPdaSession(token)
    } catch (error) {
      // 查询本身失败（数据库抖动等）不能当成「票据有效」放行——设备身份是访问控制的一环，
      // 查不到就必须拒绝，让现场重试，而不是放一个身份不明的请求进业务层
      logger.error(
        'PDA device session lookup failed',
        { ...getRouteMeta(req), error: error?.message || String(error) },
        'PDASession',
      )
      return next(new AppError('设备登录状态校验失败，请重新登录', 503, 'PDA_SESSION_CHECK_FAILED'))
    }

    if (!row) {
      return denySession(req, next, 'session_not_found', '设备会话无效，请重新登录以重建设备会话')
    }
    if (!Number.isSafeInteger(Number(req.user?.userId)) || Number(req.user.userId) <= 0 ||
        Number(row.user_id) !== Number(req.user.userId)) {
      return denySession(req, next, 'user_mismatch', '设备登录信息与当前账号不一致，请重新登录')
    }
    if (row.revoked_at) {
      return denySession(req, next, 'session_revoked', '该设备会话已被管理员吊销，请联系管理员')
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return denySession(req, next, 'session_expired', '设备会话已过期，请重新登录以重建设备会话')
    }
    if (String(row.device_status) !== 'active') {
      return denySession(req, next, 'device_not_active', '该 PDA 设备已被停用，请联系管理员')
    }

    if (Number(row.session_warehouse_id || 0) !== Number(row.device_warehouse_id || 0)) {
      return denySession(req, next, 'warehouse_changed', '该设备仓库已变更，请重新绑定')
    }

    req.pda = buildPdaContext(row)
    try {
      await pool.query('UPDATE pda_device_sessions SET last_seen_at = NOW() WHERE id = ?', [req.pda.sessionId])
      await pool.query('UPDATE pda_devices SET last_seen_at = NOW() WHERE id = ?', [req.pda.deviceId])
    } catch (seenError) {
      // last_seen 只是「最后在线」展示用，写失败不影响这次作业的合法性，记日志即可
      logger.warn(
        'PDA device last_seen update failed',
        { ...getRouteMeta(req), sessionId: req.pda.sessionId, error: seenError?.message || String(seenError) },
        'PDASession',
      )
    }
    logger.info(
      'PDA device session accepted',
      { ...getRouteMeta(req), deviceCode: req.pda.deviceCode, warehouseId: req.pda.warehouseId },
      'PDASession',
    )
    return next()
  }
}

/**
 * 可选 PDA 设备会话（2026-09-29 · 塑料盒作业流新入口）。
 *
 * 新入口（放货 / 还原整件）**同时服务 PC 与 PDA**，不能像收货/上架那样强制 `pdaOnly`；
 * 但只要请求**带了** `X-PDA-Session`，就必须按 PDA 口径完整校验设备（有效、未吊销、
 * 未过期、设备未停用、未换仓、与当前账号一致），并把**设备仓**交给业务层与目标仓比对。
 * 无票据时按 PC 路径（权限 + 仓库数据范围）。
 *
 * **不能**因为「历史 inventory 接口没挂设备校验」就认为新入口无需校验：设备仓不匹配
 * 会让现场拿着 A 仓的 PDA 操作 B 仓的盒。
 */
function pdaSessionOptional() {
  // 复用既有闸，避免在这里复制出第二套会话校验
  const required = pdaSessionRequired()
  return (req, res, next) => {
    const hasPdaMarker = String(req.headers['x-client'] || '').toLowerCase() === 'pda'
    const hasSessionToken = String(req.headers['x-pda-session'] || '').trim().length > 0
    // **任一** PDA 标记成立就按 PDA 口径走完整校验：带 X-Client: pda 却缺票必须被拒，
    // 不能因为「没票就当 PC」把设备身份放行。只有两者都没有才是纯 PC 路径。
    if (hasPdaMarker || hasSessionToken) return required(req, res, next)
    req.pda = null
    return next()
  }
}

module.exports = {
  pdaSessionRequired,
  pdaSessionOptional,
}
