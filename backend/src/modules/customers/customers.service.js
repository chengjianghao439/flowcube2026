const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

const fmt = r => ({ id:r.id, code:r.code, name:r.name, contact:r.contact, phone:r.phone, email:r.email, address:r.address, remark:r.remark, isActive:!!r.is_active, priceListId:r.price_list_id||null, priceListName:r.price_list_name||null, createdAt:r.created_at })

async function findAll({ page=1, pageSize=20, keyword='' }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const [rows] = await pool.query(`SELECT * FROM sale_customers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?`,[like,like,pageSize,offset])
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_customers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ?)`,[like,like])
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}
async function findAllActive() {
  const [rows] = await pool.query('SELECT id,code,name FROM sale_customers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC')
  return rows
}
async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM sale_customers WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('客户不存在',404)
  return fmt(rows[0])
}
async function create({ name,contact,phone,email,address,remark }) {
  const code = await generateMasterCode(pool, 'CUS', 'sale_customers')
  const [r] = await pool.query('INSERT INTO sale_customers (code,name,contact,phone,email,address,remark) VALUES (?,?,?,?,?,?,?)',[code,name,contact||null,phone||null,email||null,address||null,remark||null])
  return { id:r.insertId, code }
}
async function update(id,{name,contact,phone,email,address,remark,isActive}) {
  await findById(id)
  await pool.query('UPDATE sale_customers SET name=?,contact=?,phone=?,email=?,address=?,remark=?,is_active=? WHERE id=? AND deleted_at IS NULL',[name,contact||null,phone||null,email||null,address||null,remark||null,isActive?1:0,id])
}
async function softDelete(id) {
  await findById(id)
  await pool.query('UPDATE sale_customers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL',[id])
}
module.exports = { findAll, findAllActive, findById, create, update, softDelete }
