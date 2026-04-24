const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getRequestId } = require('../../utils/requestContext')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('./payment-events.service')

function mapPaymentRecord(row) {
  return {
    id: row.id,
    type: row.type,
    typeName: row.type === 1 ? '应付' : '应收',
    orderNo: row.order_no,
    partyName: row.party_name,
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    balance: Number(row.balance),
    status: row.status,
    statusName: { 1: '未付', 2: '部分付', 3: '已付清' }[row.status],
    dueDate: row.due_date,
    remark: row.remark,
    createdAt: row.created_at,
  }
}

async function findAll({ page = 1, pageSize = 20, type = '', status = '' } = {}) {
  const normalizedPage = Number(page) || 1
  const normalizedPageSize = Number(pageSize) || 20
  const offset = (normalizedPage - 1) * normalizedPageSize
  const conds = []
  const params = []

  if (type) {
    conds.push('type=?')
    params.push(Number(type))
  }
  if (status) {
    conds.push('status=?')
    params.push(Number(status))
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT * FROM payment_records ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, normalizedPageSize, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM payment_records ${where}`, params)
  const [[summary]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS totalAmount,
            COALESCE(SUM(paid_amount),0) AS paidAmount,
            COALESCE(SUM(balance),0) AS balance
     FROM payment_records ${where}`,
    params,
  )

  return {
    list: rows.map(mapPaymentRecord),
    pagination: { page: normalizedPage, pageSize: normalizedPageSize, total },
    summary: {
      totalAmount: Number(summary.totalAmount),
      paidAmount: Number(summary.paidAmount),
      balance: Number(summary.balance),
    },
  }
}

async function createManual({ type, orderNo, partyName, totalAmount, dueDate, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result] = await conn.query(
      `INSERT INTO payment_records (type,order_no,party_name,total_amount,balance,due_date,remark)
       VALUES (?,?,?,?,?,?,?)`,
      [type, orderNo, partyName, totalAmount, totalAmount, dueDate || null, remark || null],
    )
    await recordPaymentEvent(conn, {
      paymentRecordId: result.insertId,
      orderNo,
      eventType: PAYMENT_EVENT.CREATED,
      title: '账款记录已创建',
      description: `${type === 1 ? '应付' : '应收'}账款已创建`,
      operatorId: operator.operatorId,
      operatorName: operator.operatorName,
      requestId: getRequestId(),
      payload: {
        type,
        partyName,
        totalAmount,
        balance: totalAmount,
        dueDate: dueDate || null,
        remark: remark || null,
      },
    })
    await conn.commit()
    return { id: result.insertId }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function recordPayment(id, { amount, paymentDate, method, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[record]] = await conn.query('SELECT * FROM payment_records WHERE id=? FOR UPDATE', [id])
    if (!record) throw new AppError('账款记录不存在', 404)
    if (record.status === 3) throw new AppError('该账款已付清', 400)

    const newPaid = Number(record.paid_amount) + amount
    if (newPaid > Number(record.total_amount)) {
      throw new AppError(`付款金额超出余额 ¥${Number(record.balance).toFixed(2)}`, 400)
    }

    const newBalance = Number(record.total_amount) - newPaid
    const newStatus = newBalance <= 0 ? 3 : 2
    await conn.query(
      'UPDATE payment_records SET paid_amount=?,balance=?,status=? WHERE id=?',
      [newPaid, newBalance, newStatus, id],
    )
    const [entryResult] = await conn.query(
      `INSERT INTO payment_entries (record_id,amount,payment_date,method,remark,operator_id,operator_name)
       VALUES (?,?,?,?,?,?,?)`,
      [id, amount, paymentDate, method || null, remark || null, operator.operatorId, operator.operatorName],
    )
    await recordPaymentEvent(conn, {
      paymentRecordId: id,
      orderNo: record.order_no,
      eventType: PAYMENT_EVENT.PAYMENT_RECORDED,
      title: '账款登记成功',
      description: newStatus === 3 ? '账款已付清' : '账款部分结清',
      operatorId: operator.operatorId,
      operatorName: operator.operatorName,
      requestId: getRequestId(),
      payload: {
        entryId: entryResult.insertId,
        amount,
        paymentDate,
        method: method || null,
        remark: remark || null,
        newPaid,
        newBalance,
        status: newStatus,
      },
    })
    await conn.commit()
    return { newPaid, newBalance, status: newStatus }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function findEntries(recordId) {
  const [rows] = await pool.query(
    'SELECT * FROM payment_entries WHERE record_id=? ORDER BY created_at ASC',
    [recordId],
  )
  return rows.map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    paymentDate: row.payment_date,
    method: row.method,
    remark: row.remark,
    operatorName: row.operator_name,
    createdAt: row.created_at,
  }))
}

module.exports = {
  findAll,
  createManual,
  recordPayment,
  findEntries,
}
