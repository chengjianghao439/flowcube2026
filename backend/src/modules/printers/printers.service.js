const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

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

async function findAll({ type } = {}) {
  const conds = ['1=1']
  const params = []
  if (type) {
    conds.push('p.type=?')
    params.push(type)
  }
  const where = 'WHERE ' + conds.join(' AND ')
  const [rows] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     ${where} ORDER BY p.type, p.id`,
    params,
  )
  return rows.map(fmt)
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id=?`,
    [id],
  )
  if (!row) throw new AppError('打印机不存在', 404)
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
}) {
  const nameNorm = normalizePrinterName(name)
  if (!nameNorm) throw new AppError('名称不能为空', 400)
  if (!code) throw new AppError('编码不能为空', 400)
  if (!type) throw new AppError('类型不能为空', 400)
  const wh =
    warehouseId != null && warehouseId !== '' && Number.isFinite(Number(warehouseId))
      ? Number(warehouseId)
      : null
  // 兜底 'manual' 而非 null：printers.source 在历史库中为 NOT NULL DEFAULT 'manual'，
  // 显式传 NULL 不会回落到列默认值，会直接报错 —— 桌面端「从本机添加」不传 source，正会踩到。
  const src =
    source === 'local_desktop' || source === 'client' || source === 'manual' ? source : 'manual'
  const clientIdVal = clientId != null ? String(clientId).trim().slice(0, 200) || null : null
  const finalCode = await allocateUniqueCodeGlobally(code)
  const [r] = await pool.query(
    'INSERT INTO printers (name, code, type, warehouse_id, description, source, client_id) VALUES (?,?,?,?,?,?,?)',
    [nameNorm, finalCode, type, wh, description || null, src, clientIdVal],
  )
  return findById(r.insertId)
}

async function update(id, {
  name,
  code,
  type,
  description,
  status,
  warehouseId,
  clientId,
}) {
  const existing = await findById(id)
  const nameVal = name !== undefined ? normalizePrinterName(name) : existing.name
  if (name !== undefined && !nameVal) throw new AppError('名称不能为空', 400)
  const clientIdVal =
    clientId === undefined
      ? (existing.clientId || null)
      : (clientId != null ? String(clientId).trim().slice(0, 200) || null : null)
  const wh =
    warehouseId === undefined
      ? undefined
      : warehouseId != null && warehouseId !== '' && Number.isFinite(Number(warehouseId))
        ? Number(warehouseId)
        : null
  const sets = [
    'name=?',
    'code=?',
    'type=?',
    'description=?',
    'status=?',
    'client_id=?',
  ]
  const params = [nameVal, code, type, description || null, status ?? 1, clientIdVal]
  if (wh !== undefined) {
    sets.push('warehouse_id=?')
    params.push(wh)
  }
  params.push(id)
  await pool.query(
    `UPDATE printers SET ${sets.join(', ')} WHERE id=?`,
    params,
  )
  return findById(id)
}

/**
 * 删除打印机时必须一并清理其用途绑定。
 * printer_bindings 无外键约束，残留的悬空绑定会让打印路由整体失效
 * （候选集非空但全部不可用 → 跳过 fallback 链 → 兜底到全库第一台打印机）。
 */
async function remove(id) {
  await findById(id)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM printer_bindings WHERE printer_id=?', [id])
    await conn.query('DELETE FROM printers WHERE id=?', [id])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function setStatus(id, status) {
  await pool.query('UPDATE printers SET status=? WHERE id=?', [status, id])
}

// ─── 桌面客户端心跳 / 在线状态（审计 4.9：从 controller 下沉，消除直写 SQL） ─────────

/** 客户端心跳：upsert print_clients + 认领同名打印机 + 返回该客户端拥有的在线打印机 */
async function heartbeatClient({ clientId, hostname, printerNames, ip }) {
  const id = String(clientId || '').trim().slice(0, 200)
  const host = String(hostname || '').trim().slice(0, 200)
  const names = [...new Set(
    (printerNames || [])
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .map((p) => p.slice(0, 100)),
  )]

  await pool.query(
    `INSERT INTO print_clients (client_id, hostname, ip_address, last_seen, status)
     VALUES (?, ?, ?, NOW(), 1)
     ON DUPLICATE KEY UPDATE
       hostname=VALUES(hostname),
       ip_address=VALUES(ip_address),
       last_seen=NOW(),
       status=1`,
    [id, host, ip || null],
  )

  if (names.length) {
    const placeholders = names.map(() => '?').join(',')
    await pool.query(
      `UPDATE printers
       SET client_id = ?, source = CASE WHEN source IS NULL OR source = '' THEN 'local_desktop' ELSE source END
       WHERE name IN (${placeholders})
         AND (client_id IS NULL OR client_id = ?)`,
      [id, ...names, id],
    )
  }

  const [ownedPrinters] = await pool.query(
    `SELECT id, name, code
     FROM printers
     WHERE client_id = ? AND status = 1
     ORDER BY id ASC`,
    [id],
  )
  return { clientId: id, hostname: host, printers: ownedPrinters }
}

/** 把 30 秒无心跳的客户端标为离线（供在线客户端列表 / 心跳判定使用） */
async function markOfflineClients() {
  await pool.query(
    `UPDATE print_clients
     SET status=0
     WHERE status=1 AND last_seen < DATE_SUB(NOW(), INTERVAL 30 SECOND)`,
  )
}

/** 在线客户端列表（status=1 或 30 秒内有心跳），带各自在线的打印机 */
async function listOnlineClients() {
  await markOfflineClients()
  const [clients] = await pool.query(
    `SELECT client_id, hostname, alias_name, ip_address, last_seen
     FROM print_clients
     WHERE status=1 OR last_seen >= DATE_SUB(NOW(), INTERVAL 30 SECOND)
     ORDER BY last_seen DESC`,
  )
  const data = []
  for (const c of clients) {
    const [printers] = await pool.query(
      'SELECT name, code FROM printers WHERE client_id=? AND status=1 ORDER BY id ASC',
      [c.client_id],
    )
    data.push({
      clientId: c.client_id,
      hostname: c.hostname,
      aliasName: c.alias_name,
      displayName: c.alias_name || c.hostname,
      printers,
      registeredAt: c.last_seen,
      lastSeen: new Date(c.last_seen).getTime(),
    })
  }
  return data
}

/** 所有客户端（含离线，完整历史） */
async function listAllClients() {
  await markOfflineClients()
  const [rows] = await pool.query('SELECT * FROM print_clients ORDER BY last_seen DESC')
  return rows
}

/** 给客户端设置显示别名 */
async function updateClientAlias(clientId, aliasName) {
  const [r] = await pool.query(
    'UPDATE print_clients SET alias_name=? WHERE client_id=?',
    [aliasName || null, clientId],
  )
  if (r.affectedRows === 0) return null
  const [[row]] = await pool.query('SELECT * FROM print_clients WHERE client_id=?', [clientId])
  return row
}

module.exports = { findAll, findById, create, update, remove, setStatus, heartbeatClient, markOfflineClients, listOnlineClients, listAllClients, updateClientAlias }
