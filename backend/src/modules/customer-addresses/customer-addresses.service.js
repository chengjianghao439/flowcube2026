const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

// 每客户常用地址软上限，防止无节制堆积
const MAX_ADDRESSES_PER_CUSTOMER = 30

const fmt = r => ({
  id: r.id,
  customerId: r.customer_id,
  receiverName: r.receiver_name,
  receiverPhone: r.receiver_phone,
  receiverAddress: r.receiver_address,
  isDefault: !!r.is_default,
  createdAt: r.created_at,
})

async function assertCustomerExists(customerId) {
  const [rows] = await pool.query('SELECT id FROM sale_customers WHERE id=? AND deleted_at IS NULL', [customerId])
  if (!rows[0]) throw new AppError('客户不存在', 404)
}

async function findByCustomer(customerId) {
  await assertCustomerExists(customerId)
  const [rows] = await pool.query(
    'SELECT * FROM sale_customer_addresses WHERE customer_id=? AND deleted_at IS NULL ORDER BY is_default DESC, sort_order ASC, created_at DESC',
    [customerId],
  )
  return rows.map(fmt)
}

// 取单条并校验存在（写操作前用），返回原始行
async function findRowOr404(id) {
  const [rows] = await pool.query('SELECT * FROM sale_customer_addresses WHERE id=? AND deleted_at IS NULL', [id])
  if (!rows[0]) throw new AppError('地址不存在', 404)
  return rows[0]
}

async function create({ customerId, receiverName, receiverPhone, receiverAddress, isDefault }) {
  await assertCustomerExists(customerId)
  const [[{ cnt }]] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM sale_customer_addresses WHERE customer_id=? AND deleted_at IS NULL',
    [customerId],
  )
  if (cnt >= MAX_ADDRESSES_PER_CUSTOMER) throw new AppError('常用地址过多，请先删除部分', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (isDefault) {
      await conn.query('UPDATE sale_customer_addresses SET is_default=0 WHERE customer_id=? AND deleted_at IS NULL', [customerId])
    }
    const [r] = await conn.query(
      'INSERT INTO sale_customer_addresses (customer_id, receiver_name, receiver_phone, receiver_address, is_default) VALUES (?,?,?,?,?)',
      [customerId, receiverName || null, receiverPhone || null, receiverAddress, isDefault ? 1 : 0],
    )
    await conn.commit()
    return { id: r.insertId }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function update(id, { receiverName, receiverPhone, receiverAddress, isDefault }) {
  const row = await findRowOr404(id)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 锁住该地址行，避免与并发的设默认/删除交叉
    await conn.query('SELECT id FROM sale_customer_addresses WHERE id=? FOR UPDATE', [id])
    if (isDefault) {
      await conn.query('UPDATE sale_customer_addresses SET is_default=0 WHERE customer_id=? AND deleted_at IS NULL', [row.customer_id])
    }
    await conn.query(
      'UPDATE sale_customer_addresses SET receiver_name=?, receiver_phone=?, receiver_address=?, is_default=? WHERE id=? AND deleted_at IS NULL',
      [receiverName || null, receiverPhone || null, receiverAddress, isDefault ? 1 : 0, id],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function setDefault(id) {
  const row = await findRowOr404(id)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('UPDATE sale_customer_addresses SET is_default=0 WHERE customer_id=? AND deleted_at IS NULL', [row.customer_id])
    await conn.query('UPDATE sale_customer_addresses SET is_default=1 WHERE id=? AND deleted_at IS NULL', [id])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function softDelete(id) {
  await findRowOr404(id)
  await pool.query('UPDATE sale_customer_addresses SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id])
}

module.exports = { findByCustomer, create, update, setDefault, softDelete }
