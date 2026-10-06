const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertBoundWarehouseInScope, scopeFilter } = require('../../utils/warehouseScope')
const crypto = require('crypto')
const { requireClientIdentity, hashCredential, SAFE_CLIENT_ID } = require('./print-client-auth')

const TYPE_NAME = { 1: '标签打印机', 2: '面单打印机', 3: 'A4打印机' }

function fmt(row) {
  return {
    id:          row.id,
    name:        row.name,
    code:        row.code,
    type:        row.type,
    warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
    typeName:    TYPE_NAME[row.type] || '其他',
    description: row.description,
    status:      row.status,
    source:      row.source,
    clientId:    row.client_id,
    clientAliasName: row.client_alias_name,
    clientHostname: row.client_hostname,
    clientDisplayName: row.client_alias_name || row.client_hostname || row.client_id || null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

async function findAll({ type, scopeWarehouseIds = null } = {}) {
  const conds = ['1=1']
  const params = []
  if (type) {
    conds.push('p.type=?')
    params.push(type)
  }
  const scope = scopeFilter(scopeWarehouseIds, 'p.warehouse_id')
  params.push(...scope.params)
  const where = 'WHERE ' + conds.join(' AND ') + scope.sql
  const [rows] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     ${where} ORDER BY p.type, p.id`,
    params,
  )
  return rows.map(fmt)
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id=?`,
    [id],
  )
  if (!row) throw new AppError('打印机不存在', 404)
  assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, '打印机')
  return fmt(row)
}

function normalizePrinterName(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
}

/** printers.code 表级全局唯一。 */
async function allocateUniqueCodeGlobally(baseCode) {
  const b = String(baseCode || '').trim().slice(0, 50)
  if (!b) throw new AppError('编码不能为空', 400)
  let candidate = b
  let n = 2
  while (true) {
    const [[exists]] = await pool.query('SELECT id FROM printers WHERE code=? LIMIT 1', [candidate])
    if (!exists) return candidate
    const suffix = `_${n}`
    candidate = (b.slice(0, Math.max(0, 50 - suffix.length)) + suffix).slice(0, 50)
    n += 1
    if (n > 502) throw new AppError('无法生成唯一打印机编码', 500)
  }
}

async function create({
  name,
  code,
  type,
  description,
  warehouseId,
  source,
  clientId,
}, scopeWarehouseIds = null) {
  const nameNorm = normalizePrinterName(name)
  if (!nameNorm) throw new AppError('名称不能为空', 400)
  if (!code) throw new AppError('编码不能为空', 400)
  if (!type) throw new AppError('类型不能为空', 400)
  const wh =
    warehouseId != null && warehouseId !== '' && Number.isFinite(Number(warehouseId))
      ? Number(warehouseId)
      : null
  assertBoundWarehouseInScope(scopeWarehouseIds, wh, '打印机')
  // 兜底 'manual' 而非 null：printers.source 在历史库中为 NOT NULL DEFAULT 'manual'，
  // 显式传 NULL 不会回落到列默认值，会直接报错 —— 桌面端「从本机添加」不传 source，正会踩到。
  const src =
    source === 'local_desktop' || source === 'client' || source === 'manual' ? source : 'manual'
  const clientIdVal = clientId != null ? String(clientId).trim().slice(0, 200) || null : null
  if (clientIdVal) await assertClientForPrinter(clientIdVal, wh, scopeWarehouseIds)
  const finalCode = await allocateUniqueCodeGlobally(code)
  const [r] = await pool.query(
    'INSERT INTO printers (name, code, type, warehouse_id, description, source, client_id) VALUES (?,?,?,?,?,?,?)',
    [nameNorm, finalCode, type, wh, description || null, src, clientIdVal],
  )
  return findById(r.insertId, scopeWarehouseIds)
}

async function assertClientForPrinter(clientId, warehouseId, scopeWarehouseIds, exec = pool) {
  const [[client]] = await exec.query('SELECT client_id, warehouse_id, credential_hash, revoked_at FROM print_clients WHERE client_id=?', [clientId])
  if (!client?.credential_hash || client.revoked_at) throw new AppError('工作站尚未注册或已撤销，请先由管理员注册本机', 400, 'PRINT_CLIENT_NOT_REGISTERED')
  assertBoundWarehouseInScope(scopeWarehouseIds, client.warehouse_id, '打印工作站')
  if (client.warehouse_id != null && Number(client.warehouse_id) !== Number(warehouseId)) throw new AppError('打印机与注册工作站的仓库不一致', 403, 'PRINT_CLIENT_WAREHOUSE_MISMATCH')
}

async function update(id, input, scopeWarehouseIds = null) {
  if (input.status !== undefined && ![0, 1].includes(Number(input.status))) throw new AppError('打印机状态只能是 0(停用) 或 1(启用)', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM printers WHERE id=? FOR UPDATE', [id])
    if (!row) throw new AppError('打印机不存在', 404)
    assertBoundWarehouseInScope(scopeWarehouseIds, row.warehouse_id, '打印机')
    const wh = input.warehouseId === undefined ? row.warehouse_id : input.warehouseId == null || input.warehouseId === '' ? null : Number(input.warehouseId)
    if (wh != null && (!Number.isSafeInteger(wh) || wh <= 0)) throw new AppError('仓库编号无效', 400)
    assertBoundWarehouseInScope(scopeWarehouseIds, wh, '打印机')
    const name = input.name === undefined ? row.name : normalizePrinterName(input.name)
    if (!name) throw new AppError('名称不能为空', 400)
    const clientId = input.clientId === undefined ? row.client_id : String(input.clientId || '').trim() || null
    // Status/description edits must still work for retired or legacy stations. Only a
    // new association (including moving its warehouse) needs a live credential.
    if (clientId && (clientId !== row.client_id || Number(wh) !== Number(row.warehouse_id))) await assertClientForPrinter(clientId, wh, scopeWarehouseIds, conn)
    await conn.query('UPDATE printers SET name=?, code=?, type=?, description=?, status=?, client_id=?, warehouse_id=? WHERE id=?', [
      name, input.code ?? row.code, input.type ?? row.type,
      input.description === undefined ? row.description : input.description || null,
      input.status === undefined ? row.status : Number(input.status), clientId, wh, id,
    ])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  return findById(id, scopeWarehouseIds)
}

/**
 * 删除打印机时必须一并清理其用途绑定。
 * printer_bindings 无外键约束，残留的悬空绑定会让打印路由整体失效
 * （候选集非空但全部不可用 → 跳过 fallback 链 → 兜底到全库第一台打印机）。
 */
async function remove(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[printer]] = await conn.query('SELECT id, warehouse_id FROM printers WHERE id=? FOR UPDATE', [id])
    if (!printer) throw new AppError('打印机不存在', 404)
    assertBoundWarehouseInScope(scopeWarehouseIds, printer.warehouse_id, '打印机')
    await conn.query('DELETE FROM printer_bindings WHERE printer_id=?', [id])
    await conn.query('DELETE FROM printers WHERE id=?', [id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function registrationWarehouses(scopeWarehouseIds = null) {
  const scope = scopeFilter(scopeWarehouseIds, 'id')
  const [rows] = await pool.query(`SELECT id, name FROM inventory_warehouses WHERE is_active=1 AND deleted_at IS NULL ${scope.sql} ORDER BY id`, scope.params)
  return rows.map(r => ({ id: Number(r.id), name: r.name }))
}

/** Only a manager may provision a new random desktop identity; never overwrite another registration. */
async function registerClient({ clientId, hostname, warehouseId }, scopeWarehouseIds = null) {
  if (!SAFE_CLIENT_ID.test(clientId || '') || !String(hostname || '').trim()) throw new AppError('工作站资料无效', 400)
  const wh = warehouseId == null ? null : Number(warehouseId)
  if (wh != null && (!Number.isSafeInteger(wh) || wh <= 0)) throw new AppError('仓库编号无效', 400)
  assertBoundWarehouseInScope(scopeWarehouseIds, wh, '打印工作站')
  if (wh != null) {
    const [[warehouse]] = await pool.query('SELECT id FROM inventory_warehouses WHERE id=? AND is_active=1 AND deleted_at IS NULL', [wh])
    if (!warehouse) throw new AppError('仓库不存在或已停用', 400)
  }
  const credential = crypto.randomBytes(32).toString('hex')
  try {
    await pool.query('INSERT INTO print_clients (client_id, hostname, warehouse_id, credential_hash, revoked_at, status) VALUES (?, ?, ?, ?, NULL, 0)', [clientId, String(hostname).trim().slice(0, 200), wh, hashCredential(credential)])
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError('工作站已注册，不能覆盖。丢失凭据时请撤销旧工作站后注册新的本机身份', 409, 'PRINT_CLIENT_ALREADY_REGISTERED')
    throw e
  }
  return { clientId, credential, warehouseId: wh }
}

async function assertManagedClient(clientId, scopeWarehouseIds = null, exec = pool, locked = false) {
  const [[client]] = await exec.query(`SELECT client_id, warehouse_id FROM print_clients WHERE client_id=?${locked ? ' FOR UPDATE' : ''}`, [clientId])
  if (!client) throw new AppError('客户端不存在', 404)
  assertBoundWarehouseInScope(scopeWarehouseIds, client.warehouse_id, '打印工作站')
  const [printers] = await exec.query('SELECT warehouse_id FROM printers WHERE client_id=?', [clientId])
  for (const printer of printers) assertBoundWarehouseInScope(scopeWarehouseIds, printer.warehouse_id, '打印机')
  return client
}

async function revokeClient(clientId, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertManagedClient(clientId, scopeWarehouseIds, conn, true)
    await conn.query('UPDATE print_clients SET revoked_at=NOW(), credential_hash=NULL, status=0 WHERE client_id=?', [clientId])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  return { clientId, revoked: true }
}

/** Authenticated heartbeat updates only this registered client; printer associations are manager-owned. */
async function heartbeatClient({ identity, hostname, ip, scopeWarehouseIds = null }) {
  const { clientId, credentialHash } = requireClientIdentity(identity)
  await pool.query('UPDATE print_clients SET hostname=?, ip_address=?, last_seen=NOW(), status=1 WHERE client_id=? AND credential_hash=? AND revoked_at IS NULL', [String(hostname || '').trim().slice(0, 200), ip || null, clientId, credentialHash])
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const [printers] = await pool.query(`SELECT id, name, code FROM printers WHERE client_id=? AND status=1 ${scope.sql} ORDER BY id`, [clientId, ...scope.params])
  return { clientId, printers }
}

async function markOfflineClients() {
  await pool.query('UPDATE print_clients SET status=0 WHERE status=1 AND last_seen < DATE_SUB(NOW(), INTERVAL 30 SECOND)')
}

async function listClients(scopeWarehouseIds, onlineOnly) {
  const scope = scopeFilter(scopeWarehouseIds, 'pc.warehouse_id')
  const [clients] = await pool.query(`SELECT pc.client_id, pc.hostname, pc.alias_name, pc.ip_address, pc.last_seen, pc.status, pc.warehouse_id, pc.revoked_at FROM print_clients pc WHERE 1=1 ${onlineOnly ? "AND pc.revoked_at IS NULL AND pc.last_seen >= DATE_SUB(NOW(), INTERVAL 30 SECOND)" : ''} ${scope.sql} ORDER BY pc.last_seen DESC`, scope.params)
  if (!clients.length) return []
  const printerScope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const [printers] = await pool.query(`SELECT client_id, name, code FROM printers WHERE client_id IN (?) AND status=1 ${printerScope.sql} ORDER BY id`, [clients.map(c => c.client_id), ...printerScope.params])
  return clients.map(c => ({ ...c, clientId: c.client_id, hostname: c.hostname, aliasName: c.alias_name, displayName: c.alias_name || c.hostname, printers: printers.filter(p => p.client_id === c.client_id).map(({ name, code }) => ({ name, code })), registeredAt: c.last_seen, lastSeen: new Date(c.last_seen).getTime() }))
}
const listOnlineClients = (scopeWarehouseIds = null) => listClients(scopeWarehouseIds, true)
const listAllClients = (scopeWarehouseIds = null) => listClients(scopeWarehouseIds, false)

async function updateClientAlias(clientId, aliasName, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await assertManagedClient(clientId, scopeWarehouseIds, conn, true)
    await conn.query('UPDATE print_clients SET alias_name=? WHERE client_id=?', [String(aliasName || '').trim().slice(0, 100) || null, clientId])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  return { clientId, aliasName: aliasName || null }
}

module.exports = { findAll, findById, create, update, remove, heartbeatClient, markOfflineClients, listOnlineClients, listAllClients, updateClientAlias, registerClient, revokeClient, registrationWarehouses }
