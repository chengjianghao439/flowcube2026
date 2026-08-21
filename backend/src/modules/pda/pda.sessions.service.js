const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const DEFAULT_PDA_SCOPES = Object.freeze([
  'pda:pick',
  'pda:sort',
  'pda:check',
  'pda:pack',
  'pda:ship',
  'pda:receive',
  'pda:putaway',
  'pda:container',
])

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function sessionTtlHours() {
  const raw = Number(process.env.PDA_SESSION_TTL_HOURS)
  // 2026-08-21 审计修复：默认 30 天 → 7 天。设备凭据明文存 localStorage 是
  // 现场可用性的权衡，缩短票据有效期 + 心跳续期可大幅缩小设备丢失后的冒用窗口。
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 7
}

function normalizeScopes(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
    } catch {
      return []
    }
  }
  return []
}

async function compareDeviceSecret(secret, secretHash) {
  const rawSecret = String(secret || '')
  const stored = String(secretHash || '')
  if (!rawSecret || !stored) return false
  try {
    if (await bcrypt.compare(rawSecret, stored)) return true
  } catch {
    // 兼容非 bcrypt 历史导入，继续尝试 sha256 等值比较。
  }
  return hashToken(rawSecret) === stored
}

async function createSession({ deviceCode, deviceSecret, userId }) {
  const code = String(deviceCode || '').trim()
  const secret = String(deviceSecret || '')
  if (!code) throw new AppError('device_code 必填', 400, 'PDA_DEVICE_CODE_REQUIRED')
  if (!secret) throw new AppError('device_secret 必填', 400, 'PDA_DEVICE_SECRET_REQUIRED')

  const [[device]] = await pool.query(
    `SELECT id, device_code, warehouse_id, status, secret_hash
     FROM pda_devices
     WHERE device_code = ?`,
    [code],
  )
  if (!device) throw new AppError('PDA 设备不存在或未登记', 404, 'PDA_DEVICE_NOT_FOUND')
  if (String(device.status) !== 'active') {
    throw new AppError('PDA 设备未启用', 403, 'PDA_DEVICE_NOT_ACTIVE')
  }
  if (!await compareDeviceSecret(secret, device.secret_hash)) {
    throw new AppError('PDA 设备密钥错误', 401, 'PDA_DEVICE_SECRET_INVALID')
  }

  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const ttlHours = sessionTtlHours()
  const scopes = [...DEFAULT_PDA_SCOPES]

  const [result] = await pool.query(
    `INSERT INTO pda_device_sessions
       (device_id, user_id, session_token_hash, scopes, warehouse_id, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), NOW())`,
    [
      device.id,
      userId,
      tokenHash,
      JSON.stringify(scopes),
      device.warehouse_id ?? null,
      ttlHours,
    ],
  )
  await pool.query('UPDATE pda_devices SET last_seen_at = NOW() WHERE id = ?', [device.id])

  const [[session]] = await pool.query(
    'SELECT expires_at FROM pda_device_sessions WHERE id = ?',
    [result.insertId],
  )

  return {
    sessionToken: token,
    scopes,
    expiresAt: session?.expires_at || null,
    warehouseId: device.warehouse_id ?? null,
  }
}

/**
 * 心跳续期（2026-08-21 审计修复）：用现有会话票据换一张新票据，延长有效期并
 * 更新 last_seen_at。让「设备身份」在活跃使用时持续有效，同时支持把 TTL 收短
 * （默认 30 天 → 7 天，见 sessionTtlHours），设备丢失后凭据失效窗口大幅缩短。
 */
async function renewSession({ sessionToken }) {
  const token = String(sessionToken || '')
  if (!token) throw new AppError('缺少设备会话票据', 400, 'PDA_SESSION_REQUIRED')
  const tokenHash = hashToken(token)
  const [[row]] = await pool.query(
    `SELECT s.id AS session_id, s.device_id, s.user_id, s.scopes,
            s.warehouse_id AS session_warehouse_id, s.expires_at, s.revoked_at,
            d.warehouse_id AS device_warehouse_id, d.status AS device_status
       FROM pda_device_sessions s
       INNER JOIN pda_devices d ON d.id = s.device_id
      WHERE s.session_token_hash = ?
      LIMIT 1`,
    [tokenHash],
  )
  if (!row) throw new AppError('设备会话不存在或已失效', 401, 'PDA_SESSION_INVALID')
  if (row.revoked_at) throw new AppError('设备会话已吊销', 401, 'PDA_SESSION_REVOKED')
  if (String(row.device_status) !== 'active') throw new AppError('PDA 设备未启用', 403, 'PDA_DEVICE_NOT_ACTIVE')
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError('设备会话已过期，请重新登录', 401, 'PDA_SESSION_EXPIRED')
  }

  const newToken = crypto.randomBytes(32).toString('hex')
  const newHash = hashToken(newToken)
  const ttlHours = sessionTtlHours()
  await pool.query(
    `UPDATE pda_device_sessions
        SET session_token_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR), last_seen_at = NOW()
      WHERE id = ?`,
    [newHash, ttlHours, row.session_id],
  )
  await pool.query('UPDATE pda_devices SET last_seen_at = NOW() WHERE id = ?', [row.device_id])

  return {
    sessionToken: newToken,
    scopes: normalizeScopes(row.scopes),
    expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000).toISOString(),
    warehouseId: row.session_warehouse_id ?? row.device_warehouse_id ?? null,
  }
}

module.exports = {
  DEFAULT_PDA_SCOPES,
  createSession,
  renewSession,
  hashToken,
  normalizeScopes,
}
