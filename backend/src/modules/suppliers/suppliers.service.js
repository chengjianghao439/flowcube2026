const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { normalizePagination } = require('../../utils/pagination')
const {
  SETTLEMENT_TYPE_NAME,
  normalizeSettlementType,
  normalizeTermsDays,
} = require('../../constants/settlementType')

async function ensureSupplierNameUnique(name, currentId = null) {
  const normalized = String(name || '').trim()
  if (!normalized) throw new AppError('供应商名称不能为空', 400)
  const [rows] = currentId
    ? await pool.query('SELECT id FROM supply_suppliers WHERE name=? AND deleted_at IS NULL AND id<>? LIMIT 1', [normalized, currentId])
    : await pool.query('SELECT id FROM supply_suppliers WHERE name=? AND deleted_at IS NULL LIMIT 1', [normalized])
  if (rows[0]) throw new AppError('供应商名称已存在，请勿重复', 400)
  return normalized
}

function fmt(row) {
  return {
    id: row.id, code: row.code, name: row.name,
    contact: row.contact, phone: row.phone, email: row.email,
    address: row.address, remark: row.remark,
    settlementType: normalizeSettlementType(row.settlement_type),
    settlementTypeName: SETTLEMENT_TYPE_NAME[normalizeSettlementType(row.settlement_type)],
    paymentTermsDays: row.payment_terms_days != null ? Number(row.payment_terms_days) : 30,
    leadTimeDays: row.lead_time_days != null ? Number(row.lead_time_days) : 0,
    isActive: !!row.is_active, createdAt: row.created_at,
  }
}

async function assertSupplierDeletable(id) {
  const checks = [
    'SELECT 1 FROM purchase_orders WHERE supplier_id=? LIMIT 1',
    'SELECT 1 FROM purchase_returns WHERE supplier_id=? LIMIT 1',
    'SELECT 1 FROM inventory_logs WHERE supplier_id=? LIMIT 1',
  ]
  for (const sql of checks) {
    const [rows] = await pool.query(sql, [id])
    if (rows[0]) {
      throw new AppError('供应商已被业务单据或库存流水引用，禁止删除；请改为停用', 409)
    }
  }
}

async function findAll({ page = 1, pageSize = 20, keyword = '' }) {
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like = `%${keyword}%`
  const [rows] = await pool.query(
    `SELECT * FROM supply_suppliers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [like, like, ps, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM supply_suppliers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)`,
    [like, like],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    'SELECT id, code, name FROM supply_suppliers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC',
  )
  return rows
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM supply_suppliers WHERE id=? AND deleted_at IS NULL', [id],
  )
  if (!rows[0]) throw new AppError('供应商不存在', 404)
  return fmt(rows[0])
}

async function create({ name, contact, phone, email, address, remark, settlementType, paymentTermsDays, leadTimeDays }) {
  const normalizedName = await ensureSupplierNameUnique(name)
  const code = await generateMasterCode(pool, 'SUP', 'supply_suppliers')
  // 账期只有月结才有意义，normalizeTermsDays 会把其余结算方式强制归零
  const settle = normalizeSettlementType(settlementType)
  const terms = normalizeTermsDays(settle, paymentTermsDays)
  const [r] = await pool.query(
    `INSERT INTO supply_suppliers (code,name,contact,phone,email,address,remark,settlement_type,payment_terms_days,lead_time_days) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [code, normalizedName, contact||null, phone||null, email||null, address||null, remark||null, settle, terms, Math.max(0, Number(leadTimeDays) || 0)],
  )
  return { id: r.insertId, code }
}

async function update(id, { name, contact, phone, email, address, remark, isActive, settlementType, paymentTermsDays, leadTimeDays }) {
  await findById(id)
  const normalizedName = await ensureSupplierNameUnique(name, id)
  const settle = normalizeSettlementType(settlementType)
  const terms = normalizeTermsDays(settle, paymentTermsDays)
  await pool.query(
    `UPDATE supply_suppliers SET name=?,contact=?,phone=?,email=?,address=?,remark=?,is_active=?,settlement_type=?,payment_terms_days=?,lead_time_days=? WHERE id=? AND deleted_at IS NULL`,
    [normalizedName, contact||null, phone||null, email||null, address||null, remark||null, isActive?1:0, settle, terms, Math.max(0, Number(leadTimeDays) || 0), id],
  )
}

async function softDelete(id) {
  await findById(id)
  await assertSupplierDeletable(id)
  await pool.query('UPDATE supply_suppliers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id])
}

module.exports = { findAll, findAllActive, findById, create, update, softDelete }
