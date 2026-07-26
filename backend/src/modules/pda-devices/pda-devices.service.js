const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')

const STATUS = Object.freeze(['active', 'disabled', 'retired'])

/**
 * 生成设备密钥：32 字节随机 → 64 位十六进制。
 * 明文只在「新建」和「重置密钥」的响应里返回一次，库里只留 bcrypt 哈希，
 * 事后任何接口都查不回来——丢了只能重置，不能找回。
 */
function generateSecret() {
  return crypto.randomBytes(32).toString('hex')
}

/** 设备码：PDA-YYMMDD-XXXX，肉眼可读、便于现场对号，唯一性由数据库唯一键兜底 */
async function generateDeviceCode(conn = pool) {
  const now = new Date()
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
    const code = `PDA-${ymd}-${suffix}`
    const [[exists]] = await conn.query('SELECT id FROM pda_devices WHERE device_code = ?', [code])
    if (!exists) return code
  }
  throw new AppError('设备码生成失败，请重试', 500)
}

const fmt = row => ({
  id: Number(row.id),
  deviceCode: row.device_code,
  deviceName: row.device_name || null,
  warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
  warehouseName: row.warehouse_name || null,
  status: row.status,
  lastSeenAt: row.last_seen_at || null,
  activeSessions: Number(row.active_sessions || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, warehouseId = null, scopeWarehouseIds = null }) {
  const offset = (page - 1) * pageSize
  const params = []
  let where = '1=1'
  if (keyword) {
    where += ' AND (d.device_code LIKE ? OR d.device_name LIKE ?)'
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (status) { where += ' AND d.status = ?'; params.push(status) }
  if (warehouseId) { where += ' AND d.warehouse_id = ?'; params.push(warehouseId) }
  // 未绑仓库的设备（warehouse_id IS NULL）对受限用户不可见：它能在任何仓作业，
  // 只应由不限仓的管理员处置
  const scope = scopeFilter(scopeWarehouseIds, 'd.warehouse_id')
  if (scope.sql) { where += scope.sql; params.push(...scope.params) }

  const [rows] = await pool.query(
    `SELECT d.*, w.name AS warehouse_name,
            (SELECT COUNT(*) FROM pda_device_sessions s
              WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
       FROM pda_devices d
       LEFT JOIN inventory_warehouses w ON w.id = d.warehouse_id
      WHERE ${where}
      ORDER BY d.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM pda_devices d WHERE ${where}`,
    params,
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query(
    `SELECT d.*, w.name AS warehouse_name,
            (SELECT COUNT(*) FROM pda_device_sessions s
              WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
       FROM pda_devices d
       LEFT JOIN inventory_warehouses w ON w.id = d.warehouse_id
      WHERE d.id = ?`,
    [id],
  )
  if (!row) throw new AppError('PDA 设备不存在', 404)
  assertInScope(scopeWarehouseIds, row.warehouse_id, 'PDA 设备')
  return fmt(row)
}

async function assertWarehouseExists(warehouseId) {
  if (warehouseId == null) return
  const [[wh]] = await pool.query(
    'SELECT id FROM inventory_warehouses WHERE id = ? AND deleted_at IS NULL',
    [warehouseId],
  )
  if (!wh) throw new AppError('所选仓库不存在', 400)
}

/**
 * 登记一台新设备。返回值里带 secret 明文——这是它唯一一次出现的地方，
 * 前端负责展示成二维码让现场扫，关掉就再也拿不到了。
 */
async function create({ deviceName, warehouseId = null, scopeWarehouseIds = null }) {
  const name = String(deviceName || '').trim()
  if (!name) throw new AppError('设备名称不能为空', 400)
  const whId = warehouseId != null ? Number(warehouseId) : null
  assertInScope(scopeWarehouseIds, whId, 'PDA 设备')
  await assertWarehouseExists(whId)

  const deviceCode = await generateDeviceCode()
  const secret = generateSecret()
  const [r] = await pool.query(
    `INSERT INTO pda_devices (device_code, device_name, warehouse_id, status, secret_hash)
     VALUES (?, ?, ?, 'active', ?)`,
    [deviceCode, name, whId, bcrypt.hashSync(secret, 10)],
  )
  return { ...await findById(r.insertId), deviceSecret: secret }
}

async function update(id, { deviceName, warehouseId, scopeWarehouseIds = null }) {
  const current = await findById(id, scopeWarehouseIds)
  const name = deviceName !== undefined ? String(deviceName || '').trim() : current.deviceName
  if (!name) throw new AppError('设备名称不能为空', 400)
  const whId = warehouseId !== undefined ? (warehouseId != null ? Number(warehouseId) : null) : current.warehouseId
  // 改绑仓库同样受限：不能把设备挪到自己管不着的仓
  assertInScope(scopeWarehouseIds, whId, 'PDA 设备')
  await assertWarehouseExists(whId)

  await pool.query(
    'UPDATE pda_devices SET device_name = ?, warehouse_id = ? WHERE id = ?',
    [name, whId, id],
  )
  // 换了仓库，旧票据里缓存的 warehouse_id 就是错的，必须让设备重新建会话
  if (Number(whId || 0) !== Number(current.warehouseId || 0)) {
    await revokeSessions(id, '设备改绑仓库')
  }
  return findById(id, scopeWarehouseIds)
}

/** 吊销该设备当前全部有效会话：票据立刻失效，下次请求就会被挡下 */
async function revokeSessions(deviceId, _reason = null) {
  const [r] = await pool.query(
    'UPDATE pda_device_sessions SET revoked_at = NOW() WHERE device_id = ? AND revoked_at IS NULL',
    [deviceId],
  )
  return Number(r.affectedRows || 0)
}

/**
 * 停用/启用设备。停用会连带吊销所有票据——设备丢失时这是唯一的止血手段，
 * 只改 status 不吊票据的话，那台机器手里的票据还能继续用到过期（默认 30 天）。
 */
async function setStatus(id, status, scopeWarehouseIds = null) {
  if (!STATUS.includes(status)) throw new AppError('设备状态无效', 400)
  await findById(id, scopeWarehouseIds)
  await pool.query('UPDATE pda_devices SET status = ? WHERE id = ?', [status, id])
  let revoked = 0
  if (status !== 'active') revoked = await revokeSessions(id, `设备状态改为 ${status}`)
  return { ...await findById(id, scopeWarehouseIds), revokedSessions: revoked }
}

/** 重置密钥：旧密钥立即作废，同时吊销全部票据，现场必须拿新二维码重新绑定 */
async function resetSecret(id, scopeWarehouseIds = null) {
  await findById(id, scopeWarehouseIds)
  const secret = generateSecret()
  await pool.query('UPDATE pda_devices SET secret_hash = ? WHERE id = ?', [bcrypt.hashSync(secret, 10), id])
  const revoked = await revokeSessions(id, '重置密钥')
  return { ...await findById(id, scopeWarehouseIds), deviceSecret: secret, revokedSessions: revoked }
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  setStatus,
  resetSecret,
  revokeSessions,
}
