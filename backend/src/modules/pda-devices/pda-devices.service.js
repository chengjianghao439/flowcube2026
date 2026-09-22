const { normalizePagination } = require('../../utils/pagination')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { scopeFilter, assertBoundWarehouseInScope } = require('../../utils/warehouseScope')

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
  // 北京时间的 YYMMDD（按业务日期分天，不依赖进程 TZ）
  const ymd = beijingTodayYmd().replace(/-/g, '').slice(2)
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
  const finiteInt = (value, fallback) => Number.isSafeInteger(Math.trunc(Number(value))) ? Math.trunc(Number(value)) : fallback
  const normalized = normalizePagination({ page: finiteInt(page, 1), pageSize: finiteInt(pageSize, 20) })
  page = normalized.page
  pageSize = normalized.pageSize
  const { offset } = normalized
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

async function findById(id, scopeWarehouseIds = null, db = pool) {
  const [[row]] = await db.query(
    `SELECT d.*, w.name AS warehouse_name,
            (SELECT COUNT(*) FROM pda_device_sessions s
              WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
       FROM pda_devices d
       LEFT JOIN inventory_warehouses w ON w.id = d.warehouse_id
      WHERE d.id = ?`,
    [id],
  )
  if (!row) throw new AppError('PDA 设备不存在', 404)
  assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, 'PDA 设备')
  return fmt(row)
}

async function assertWarehouseExists(warehouseId, conn = pool) {
  if (warehouseId == null) return
  const [[wh]] = await conn.query(
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
  assertBoundWarehouseInScope(scopeWarehouseIds, whId, 'PDA 设备')
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
  // 单事务 + 行锁（2026-09-18 审计 P2）：原先是「无锁读 current → autocommit UPDATE 设备 →
  // 再 autocommit 吊销会话」。两条 write 各自提交，中间失败就只改了仓库、没吊销旧会话；
  // 更糟的是**重试时 current.warehouseId 已被改成新仓**，判断「是否换仓」恒为 false，
  // 吊销被整段跳过——旧票据里缓存的 session_warehouse_id 仍是旧仓，在心跳续期下长期存活。
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 注意：pda_devices **没有 deleted_at 列**（与其它主数据表不同），这里不要照抄 deleted_at 过滤
    const [[row]] = await conn.query(
      'SELECT id, device_name, warehouse_id FROM pda_devices WHERE id = ? FOR UPDATE',
      [id],
    )
    if (!row) throw new AppError('PDA 设备不存在', 404)
    assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, 'PDA 设备')

    const name = deviceName !== undefined ? String(deviceName || '').trim() : row.device_name
    if (!name) throw new AppError('设备名称不能为空', 400)
    const whId = warehouseId !== undefined
      ? (warehouseId != null ? Number(warehouseId) : null)
      : (row.warehouse_id != null ? Number(row.warehouse_id) : null)
    // 改绑仓库同样受限：不能把设备挪到自己管不着的仓
    assertBoundWarehouseInScope(scopeWarehouseIds, whId, 'PDA 设备')
    await assertWarehouseExists(whId, conn)

    await conn.query(
      'UPDATE pda_devices SET device_name = ?, warehouse_id = ? WHERE id = ?',
      [name, whId, id],
    )
    // 换了仓库，旧票据里缓存的 warehouse_id 就是错的，必须让设备重新建会话。
    // 判据取**加锁读到的**原仓库，与 UPDATE 在同一事务，重试也不会误判。
    if (Number(whId || 0) !== Number(row.warehouse_id || 0)) {
      await revokeSessions(id, '设备改绑仓库', conn)
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return findById(id, scopeWarehouseIds)
}

/** 吊销该设备当前全部有效会话：票据立刻失效，下次请求就会被挡下。
 *  conn 缺省走 pool；调用方已在事务里时必须传同一 conn，否则吊销会脱离事务。 */
async function revokeSessions(deviceId, _reason = null, conn = pool) {
  const [r] = await conn.query(
    'UPDATE pda_device_sessions SET revoked_at = NOW() WHERE device_id = ? AND revoked_at IS NULL',
    [deviceId],
  )
  return Number(r.affectedRows || 0)
}

/**
 * 停用/启用设备。停用会连带吊销所有票据。
 *
 * 注意别把吊票据当成唯一防线（这里原来的注释是这么写的，与实现不符）：
 * `middleware/pdaSession` 的 loadPdaSession 会 JOIN pda_devices 取 status，
 * 每次请求都校验 `device_status !== 'active'` 就拒绝，所以**设备一停用即刻失效**，
 * 不依赖这里的吊销是否成功。吊票据是额外清理（让票据行本身也不可复用），
 * 因此它失败不会留下安全缺口。
 */
async function setStatus(id, status, scopeWarehouseIds = null) {
  if (!STATUS.includes(status)) throw new AppError('设备状态无效', 400)
  await findById(id, scopeWarehouseIds)   // 存在性 + 仓库范围
  // 状态与「吊销会话」必须同事务（2026-09-18 审计 [34]）：原先是两条 autocommit 语句，
  // 状态已改成 disabled 而吊销失败时旧票据仍然可用，设备照样能作业——安全闸门形同虚设。
  // 与 [10] 的「改绑仓 + 吊销」是同一种错法，修法也一致：单事务 + 行锁 + 复用同一 conn。
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [locked] = await conn.query('SELECT id, warehouse_id FROM pda_devices WHERE id = ? FOR UPDATE', [id])
    // 行锁即存在性校验（findById 之后被删掉时这里就是空集）。
    // 这里**不能**改成校验 UPDATE 的 affectedRows：mysql2 没开 CLIENT_FOUND_ROWS，
    // 把状态设成与当前相同的值（重复点「停用」）affectedRows 就是 0，会被误判成 404。
    if (!locked.length) throw new AppError('PDA 设备不存在', 404)
    assertBoundWarehouseInScope(scopeWarehouseIds, locked[0].warehouse_id, 'PDA 设备')
    await conn.query('UPDATE pda_devices SET status = ? WHERE id = ?', [status, id])
    let revoked = 0
    // 非 active 一律吊销（不管状态值有没有变化）：接口说「已停用」，就不允许还存在可用票据
    if (status !== 'active') revoked = await revokeSessions(id, `设备状态改为 ${status}`, conn)
    await conn.commit()
    return { ...await findById(id, scopeWarehouseIds), revokedSessions: revoked }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 重置密钥：旧密钥立即作废，同时吊销全部票据，现场必须拿新二维码重新绑定 */
async function resetSecret(id, scopeWarehouseIds = null) {
  const secret = generateSecret()
  const hash = await bcrypt.hash(secret, 10)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT id, warehouse_id FROM pda_devices WHERE id=? FOR UPDATE', [id])
    if (!row) throw new AppError('PDA 设备不存在', 404)
    assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, 'PDA 设备')
    await conn.query('UPDATE pda_devices SET secret_hash=? WHERE id=?', [hash, id])
    const revoked = await revokeSessions(id, '重置密钥', conn)
    const device = await findById(id, scopeWarehouseIds, conn)
    await conn.commit()
    return { ...device, deviceSecret: secret, revokedSessions: revoked }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
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
