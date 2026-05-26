const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { priceLevelLabel } = require('../../utils/priceLevels')

const findAll = async () => {
  const [rows] = await pool.query(
    'SELECT id,name,remark,is_active,created_at FROM price_lists WHERE deleted_at IS NULL ORDER BY created_at DESC')
  return rows.map(r => ({ id: r.id, name: r.name, remark: r.remark, isActive: r.is_active, createdAt: r.created_at }))
}

const findItems = async (listId) => {
  const [rows] = await pool.query(
    'SELECT id,list_id,product_id,product_code,product_name,unit,sale_price FROM price_list_items WHERE list_id=? ORDER BY product_code',
    [listId])
  return rows.map(r => ({ id: r.id, productId: r.product_id, productCode: r.product_code, productName: r.product_name, unit: r.unit, salePrice: Number(r.sale_price) }))
}

const findCustomerPrice = async (customerId, productId) => {
  const [[cust]] = await pool.query('SELECT price_level FROM sale_customers WHERE id=?', [customerId])
  const level = String(cust?.price_level || 'A').toUpperCase()
  const fieldMap = { A: 'sale_price_a', B: 'sale_price_b', C: 'sale_price_c', D: 'sale_price_d' }
  const field = fieldMap[level] || fieldMap.A
  const [[item]] = await pool.query(
    `SELECT ${field} AS sale_price FROM product_items WHERE id=? AND deleted_at IS NULL`,
    [productId])
  return item ? { salePrice: Number(item.sale_price || 0), priceLevel: level, priceLevelName: priceLevelLabel(level) } : null
}

const create = async (name, remark) => {
  const [r] = await pool.query('INSERT INTO price_lists (name,remark) VALUES (?,?)', [name, remark || null])
  return { id: r.insertId }
}

const updateItems = async (listId, items) => {
  const [[list]] = await pool.query('SELECT id FROM price_lists WHERE id=? AND deleted_at IS NULL', [listId])
  if (!list) throw new AppError('价格表不存在', 404)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM price_list_items WHERE list_id=?', [listId])
    const validItems = items.filter(item => item.productId && item.salePrice)
    if (validItems.length) {
      const placeholders = validItems.map(() => '(?,?,?,?,?,?)').join(',')
      const params = validItems.flatMap(item => [
        listId, item.productId, item.productCode || '', item.productName || '', item.unit || '', item.salePrice
      ])
      await conn.query(
        `INSERT INTO price_list_items (list_id,product_id,product_code,product_name,unit,sale_price) VALUES ${placeholders}`,
        params,
      )
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

const update = async (id, fields) => {
  const sets = []; const params = []
  if (fields.name !== undefined) { sets.push('name=?'); params.push(fields.name) }
  if (fields.remark !== undefined) { sets.push('remark=?'); params.push(fields.remark) }
  if (fields.isActive !== undefined) { sets.push('is_active=?'); params.push(fields.isActive ? 1 : 0) }
  if (sets.length) await pool.query(`UPDATE price_lists SET ${sets.join(',')} WHERE id=?`, [...params, id])
}

const remove = async (id) => {
  await pool.query('UPDATE price_lists SET deleted_at=NOW() WHERE id=?', [id])
}

const bindCustomer = async (customerId, priceLevel) => {
  const normalized = String(priceLevel || 'A').toUpperCase()
  if (!['A', 'B', 'C', 'D'].includes(normalized)) throw new AppError('价格等级无效', 400)
  await pool.query(
    'UPDATE sale_customers SET price_level=?, price_list_id=NULL, price_list_name=NULL WHERE id=?',
    [normalized, customerId])
}

module.exports = { findAll, findItems, findCustomerPrice, create, updateItems, update, remove, bindCustomer }
