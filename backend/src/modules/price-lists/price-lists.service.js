const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { appendChangeAudit, assertChangeRequest, bindChangeRequest, normalizeReason } = require('../document-activity/document-change-audit')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { priceLevelLabel } = require('../../utils/priceLevels')
const { assertSqlIdentifier } = require('../../utils/sqlIdentifier')

const findAll = async () => {
  const [rows] = await pool.query(
    'SELECT id,name,remark,is_active,created_at FROM price_lists WHERE deleted_at IS NULL ORDER BY created_at DESC')
  return rows.map(r => ({ id: r.id, name: r.name, remark: r.remark, isActive: r.is_active, createdAt: r.created_at }))
}

const findById = async (id) => {
  const [[row]] = await pool.query('SELECT id,name,created_at FROM price_lists WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('价格表不存在', 404)
  return { id:row.id,name:row.name,createdAt:row.created_at }
}

const findItems = async (listId) => {
  const [rows] = await pool.query(
    'SELECT id,list_id,product_id,product_code,product_name,unit,sale_price FROM price_list_items WHERE list_id=? ORDER BY product_code',
    [listId])
  return rows.map(r => ({ id: r.id, productId: r.product_id, productCode: r.product_code, productName: r.product_name, unit: r.unit, salePrice: Number(r.sale_price) }))
}

const findCustomerPrice = async (customerId, productId) => {
  const [[cust]] = await pool.query(
    'SELECT price_level, price_list_id, price_list_name FROM sale_customers WHERE id=?',
    [customerId],
  )
  // 客户绑定了价格表（price_lists 落地，2026-08-22）：优先查价格表明细，未覆盖再回退等级价
  if (cust?.price_list_id) {
    const [[item]] = await pool.query(
      'SELECT sale_price FROM price_list_items WHERE list_id=? AND product_id=?',
      [cust.price_list_id, productId],
    )
    if (item && item.sale_price != null) {
      return {
        salePrice: Number(item.sale_price),
        priceLevel: null,
        priceLevelName: cust.price_list_name || '价格表',
        source: 'price_list',
        priceListId: Number(cust.price_list_id),
      }
    }
  }
  const level = String(cust?.price_level || 'A').toUpperCase()
  const fieldMap = { A: 'sale_price_a', B: 'sale_price_b', C: 'sale_price_c', D: 'sale_price_d' }
  const field = fieldMap[level] || fieldMap.A
  assertSqlIdentifier(field, 'field')
  const [[item]] = await pool.query(
    `SELECT ${field} AS sale_price FROM product_items WHERE id=? AND deleted_at IS NULL`,
    [productId])
  return item ? { salePrice: Number(item.sale_price || 0), priceLevel: level, priceLevelName: priceLevelLabel(level), source: 'price_level' } : null
}

const create = async (name, remark) => {
  const [r] = await pool.query('INSERT INTO price_lists (name,remark) VALUES (?,?)', [name, remark || null])
  return { id: r.insertId }
}

const updateItems = async (listId, items, { operator = null, changeReason = null, requestKey = null } = {}) => {
  normalizeReason(changeReason)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[list]] = await conn.query('SELECT id,name FROM price_lists WHERE id=? AND deleted_at IS NULL FOR UPDATE', [listId])
    if (!list) throw new AppError('价格表不存在', 404)
    const action = `price-list.items.${Number(listId)}`
    const requestFingerprint = await assertChangeRequest(conn, { requestKey, action, userId: operator?.userId, payload: { items, changeReason } })
    const requestState = await beginOperationRequest(conn, { requestKey, action, userId: operator?.userId })
    await bindChangeRequest(conn, requestState, requestFingerprint)
    if (requestState.replay) { if (operator) operator.changeAuditHandled = true; await conn.rollback(); return requestState.responseData }
    const [before] = await conn.query('SELECT * FROM price_list_items WHERE list_id=? ORDER BY id FOR UPDATE', [listId])
    const validItems = items.filter(item => item.productId && item.salePrice)
    await conn.query('DELETE FROM price_list_items WHERE list_id=?', [listId])
    if (validItems.length) await conn.query(
      'INSERT INTO price_list_items (list_id,product_id,product_code,product_name,unit,sale_price) VALUES ?',
      [validItems.map(item => [listId, item.productId, item.productCode || '', item.productName || '', item.unit || '', item.salePrice])],
    )
    // Read MySQL's final DECIMAL values rather than rounding submitted prices in a second implementation.
    const [after] = await conn.query('SELECT * FROM price_list_items WHERE list_id=? ORDER BY id', [listId])
    await appendChangeAudit(conn, { documentType: 'price-list', documentId: listId, title: '修改价格表明细', operator, reason: changeReason, before, after, requestState, context: { phase: 'price_list_update', requestFingerprint } })
    await completeOperationRequest(conn, requestState, { data: null, message: '价格表已更新', resourceType: 'price_list', resourceId: listId })
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

module.exports = { findById, findAll, findItems, findCustomerPrice, create, updateItems, update, remove, bindCustomer }
