const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const TYPE_NAME = { 1: '标签打印机', 2: '面单打印机', 3: 'A4打印机' }

function fmt(row) {
  return {
    id:          row.id,
    name:        row.name,
    code:        row.code,
    type:        row.type,
    tenantId:    row.tenant_id != null ? Number(row.tenant_id) : 0,
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

function normTid(tenantId) {
  const n = Number(tenantId)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

async function findAll({ type, tenantId = 0 } = {}) {
  const tid = normTid(tenantId)
  const conds = ['(p.tenant_id = ? OR p.tenant_id = 0)']
  const params = [tid]
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

async function findById(id, tenantId = 0) {
  const tid = normTid(tenantId)
  const [[row]] = await pool.query(
    `SELECT p.*, pc.alias_name AS client_alias_name, pc.hostname AS client_hostname
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id=? AND (p.tenant_id=? OR p.tenant_id=0)`,
    [id, tid],
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

/** printers.code 表级全局唯一；前端仅按当前租户列表去重，跨租户需在此再分配 */
async function allocateUniqueCodeGlobally(baseCode) {
  const b = String(baseCode || '').trim().slice(0, 50)
  if (!b) throw new AppError('编码不能为空', 400)
  let candidate = b
  let n = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [[exists]] = await pool.query('SELECT id FROM printers WHERE code=? LIMIT 1', [candidate])
    if (!exists) return candidate
    const suffix = `_${n}`
    candidate = (b.slice(0, Math.max(0, 50 - suffix.length)) + suffix).slice(0, 50)
    n += 1
    if (n > 502) throw new AppError('无法生成唯一打印机编码', 500)
  }
}

async function create({ name, code, type, description, warehouseId, source }, tenantId = 0) {
  const tid = normTid(tenantId)
  const nameNorm = normalizePrinterName(name)
  if (!nameNorm) throw new AppError('名称不能为空', 400)
  if (!code) throw new AppError('编码不能为空', 400)
  if (!type) throw new AppError('类型不能为空', 400)
  const wh =
    warehouseId != null && warehouseId !== '' && Number.isFinite(Number(warehouseId))
      ? Number(warehouseId)
      : null
  const src =
    source === 'local_desktop' || source === 'client' || source === 'manual' ? source : null
  const finalCode = await allocateUniqueCodeGlobally(code)
  const [r] = await pool.query(
    'INSERT INTO printers (name, code, type, warehouse_id, tenant_id, description, source) VALUES (?,?,?,?,?,?,?)',
    [nameNorm, finalCode, type, wh, tid, description || null, src],
  )
  return findById(r.insertId, tid)
}

async function update(id, { name, code, type, description, status, warehouseId }, tenantId = 0) {
  const tid = normTid(tenantId)
  const existing = await findById(id, tid)
  const nameVal = name !== undefined ? normalizePrinterName(name) : existing.name
  if (name !== undefined && !nameVal) throw new AppError('名称不能为空', 400)
  const wh =
    warehouseId === undefined
      ? undefined
      : warehouseId != null && warehouseId !== '' && Number.isFinite(Number(warehouseId))
        ? Number(warehouseId)
        : null
  if (wh !== undefined) {
    await pool.query(
      'UPDATE printers SET name=?, code=?, type=?, warehouse_id=?, description=?, status=? WHERE id=? AND (tenant_id=? OR tenant_id=0)',
      [nameVal, code, type, wh, description || null, status ?? 1, id, tid],
    )
  } else {
    await pool.query(
      'UPDATE printers SET name=?, code=?, type=?, description=?, status=? WHERE id=? AND (tenant_id=? OR tenant_id=0)',
      [nameVal, code, type, description || null, status ?? 1, id, tid],
    )
  }
  return findById(id, tid)
}

async function remove(id, tenantId = 0) {
  const tid = normTid(tenantId)
  await findById(id, tid)
  await pool.query('DELETE FROM printers WHERE id=? AND (tenant_id=? OR tenant_id=0)', [id, tid])
}

async function setStatus(id, status) {
  await pool.query('UPDATE printers SET status=? WHERE id=?', [status, id])
}

module.exports = { findAll, findById, create, update, remove, setStatus }
