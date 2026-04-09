const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

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
  createdAt:r.created_at,
})

async function findAll({ page=1, pageSize=20, keyword='' }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const [rows] = await pool.query(`SELECT * FROM sale_customers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?`,[like,like,pageSize,offset])
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_customers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)`,[like,like])
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
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
async function create({ name,contact,phone,email,address,remark }) {
  const normalizedName = await ensureCustomerNameUnique(name)
  const code = await generateMasterCode(pool, 'CUS', 'sale_customers')
  const [r] = await pool.query('INSERT INTO sale_customers (code,name,contact,phone,email,address,remark,price_level) VALUES (?,?,?,?,?,?,?,?)',[code,normalizedName,contact||null,phone||null,email||null,address||null,remark||null,'A'])
  return { id:r.insertId, code }
}
async function update(id,{name,contact,phone,email,address,remark,isActive}) {
  await findById(id)
  const normalizedName = await ensureCustomerNameUnique(name, id)
  await pool.query('UPDATE sale_customers SET name=?,contact=?,phone=?,email=?,address=?,remark=?,is_active=? WHERE id=? AND deleted_at IS NULL',[normalizedName,contact||null,phone||null,email||null,address||null,remark||null,isActive?1:0,id])
}
async function softDelete(id) {
  await findById(id)
  await pool.query('UPDATE sale_customers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[id])
}
module.exports = { findAll, findAllActive, findById, create, update, softDelete }
