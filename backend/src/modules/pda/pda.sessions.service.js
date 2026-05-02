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
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 30
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

module.exports = {
  DEFAULT_PDA_SCOPES,
  createSession,
  hashToken,
  normalizeScopes,
}
