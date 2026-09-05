const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { getCustomerCreditUsed } = require('../../utils/creditExposure')
const { normalizePagination } = require('../../utils/pagination')
const {
  SETTLEMENT_TYPE_NAME,
  normalizeSettlementType,
  normalizeTermsDays,
} = require('../../constants/settlementType')

async function ensureCustomerNameUnique(name, currentId = null) {
  const normalized = String(name || '').trim()
  if (!normalized) throw new AppError('客户名称不能为空', 400)
  const [rows] = currentId
    ? await pool.query('SELECT id FROM sale_customers WHERE name=? AND deleted_at IS NULL AND id<>? LIMIT 1', [normalized, currentId])
    : await pool.query('SELECT id FROM sale_customers WHERE name=? AND deleted_at IS NULL LIMIT 1', [normalized])
  if (rows[0]) throw new AppError('客户名称已存在，请勿重复', 400)
  return normalized
}

const fmt = r => ({
  id:r.id,
  code:r.code,
  name:r.name,
  contact:r.contact,
  phone:r.phone,
  email:r.email,
  address:r.address,
  remark:r.remark,
  isActive:!!r.is_active,
  priceLevel:r.price_level || 'A',
  priceLevelName:`价格${r.price_level || 'A'}`,
  settlementType:normalizeSettlementType(r.settlement_type),
  settlementTypeName:SETTLEMENT_TYPE_NAME[normalizeSettlementType(r.settlement_type)],
  paymentTermsDays:r.payment_terms_days != null ? Number(r.payment_terms_days) : 30,
  creditLimit:r.credit_limit != null ? Number(r.credit_limit) : null,
  createdAt:r.created_at,
})

async function assertCustomerDeletable(id) {
  const checks = [
    'SELECT 1 FROM sale_orders WHERE customer_id=? LIMIT 1',
    'SELECT 1 FROM sale_returns WHERE customer_id=? LIMIT 1',
    'SELECT 1 FROM warehouse_tasks WHERE customer_id=? LIMIT 1',
  ]
  for (const sql of checks) {
    const [rows] = await pool.query(sql, [id])
    if (rows[0]) {
      throw new AppError('客户已被业务单据或任务引用，禁止删除；请改为停用', 409)
    }
  }
}

async function findAll({ page=1, pageSize=20, keyword='' }) {
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like=`%${keyword}%`
  const [rows] = await pool.query(`SELECT * FROM sale_customers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,[like,like,ps,offset])
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_customers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)`,[like,like])
  return { list:rows.map(fmt), pagination:{page,pageSize:ps,total} }
}
async function findAllActive() {
  const [rows] = await pool.query('SELECT id,code,name,price_level FROM sale_customers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC')
  return rows
}
async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM sale_customers WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('客户不存在',404)
  return fmt(rows[0])
}
async function create({ name,contact,phone,email,address,remark,settlementType,paymentTermsDays,creditLimit }) {
  const normalizedName = await ensureCustomerNameUnique(name)
  const code = await generateMasterCode(pool, 'CUS', 'sale_customers')
  // 账期只有月结才有意义，normalizeTermsDays 会把其余结算方式强制归零
  const settle = normalizeSettlementType(settlementType)
  const terms = normalizeTermsDays(settle, paymentTermsDays)
  const limit = creditLimit === null || creditLimit === undefined || creditLimit === '' ? null : Math.max(0, Number(creditLimit))
  const [r] = await pool.query('INSERT INTO sale_customers (code,name,contact,phone,email,address,remark,price_level,settlement_type,payment_terms_days,credit_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[code,normalizedName,contact||null,phone||null,email||null,address||null,remark||null,'A',settle,terms,limit])
  return { id:r.insertId, code }
}
async function update(id,{name,contact,phone,email,address,remark,isActive,settlementType,paymentTermsDays,creditLimit}, operator) {
  const before = await findById(id)
  const normalizedName = await ensureCustomerNameUnique(name, id)
  const settle = normalizeSettlementType(settlementType)
  const terms = normalizeTermsDays(settle, paymentTermsDays)
  // creditLimit 未传时保持原值；传 null/'' 表示关闭信控；数字表示启用（0 合法=现款现货）
  const newLimit = creditLimit === undefined ? before.creditLimit
    : (creditLimit === null || creditLimit === '' ? null : Math.max(0, Number(creditLimit)))
  await pool.query('UPDATE sale_customers SET name=?,contact=?,phone=?,email=?,address=?,remark=?,is_active=?,settlement_type=?,payment_terms_days=?,credit_limit=? WHERE id=? AND deleted_at IS NULL',[normalizedName,contact||null,phone||null,email||null,address||null,remark||null,isActive?1:0,settle,terms,newLimit,id])
  // 授信额度变化留痕（审计）
  const changed = (before.creditLimit == null) !== (newLimit == null)
    || (before.creditLimit != null && newLimit != null && Number(before.creditLimit) !== Number(newLimit))
  if (changed) {
    await pool.query('INSERT INTO sale_customer_credit_logs (customer_id,old_limit,new_limit,operator_id,operator_name) VALUES (?,?,?,?,?)',
      [id, before.creditLimit, newLimit, operator?.operatorId ?? operator?.userId ?? null, operator?.operatorName ?? operator?.realName ?? null])
  }
}
async function softDelete(id) {
  await findById(id)
  await assertCustomerDeletable(id)
  await pool.query('UPDATE sale_customers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[id])
}
/** 客户用信情况：额度 / 已用授信 / 可用 / 用信率（%）。creditLimit=null 表示未启用信控 */
async function getCustomerCredit(id) {
  const [[c]] = await pool.query('SELECT credit_limit FROM sale_customers WHERE id=? AND deleted_at IS NULL', [id])
  if (!c) throw new AppError('客户不存在', 404)
  const creditLimit = c.credit_limit != null ? Number(c.credit_limit) : null
  const used = await getCustomerCreditUsed(pool, id)
  return {
    creditLimit,
    used,
    available: creditLimit != null ? Math.max(0, creditLimit - used) : null,
    usageRate: creditLimit != null && creditLimit > 0 ? Math.round((used / creditLimit) * 1000) / 10 : null,
  }
}

module.exports = { findAll, findAllActive, findById, create, update, softDelete, getCustomerCredit }
