const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getRequestId } = require('../../utils/requestContext')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('./payment-events.service')
const { SETTLEMENT_SCOPE_COLUMN, isValidSettlementType } = require('../../constants/settlementType')

/** 状态文案按应付/应收分开：应付说「付」，应收说「收」，前端两个页面直接用不必再改写 */
const STATUS_NAME = {
  1: { 1: '未付', 2: '部分付', 3: '已付清' },
  2: { 1: '未收', 2: '部分收', 3: '已收清' },
}

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
    statusName: (STATUS_NAME[row.type] || STATUS_NAME[1])[row.status],
    confirmStatus: row.confirm_status != null ? Number(row.confirm_status) : 1,
    confirmedByName: row.confirmed_by_name || null,
    confirmedAt: row.confirmed_at || null,
    dueDate: row.due_date,
    remark: row.remark,
    createdAt: row.created_at,
  }
}

/** 把 '1,3,4' / ['1','3'] / 1 统一成合法的结算方式数组；无有效值返回 null（= 不过滤） */
function normalizeSettlementList(input) {
  if (input == null || input === '') return null
  const raw = Array.isArray(input) ? input : String(input).split(',')
  const list = raw.map(Number).filter(isValidSettlementType)
  return list.length ? list : null
}

/**
 * @param settlementTypes 只看这些结算方式的账款（回溯往来方主数据判定）。
 *        账款页传即时结算三种，对账页传月结，不传则不限。
 * @param keyword         按单号或往来方名称模糊查
 */
async function findAll({ page = 1, pageSize = 20, type = '', status = '', settlementTypes = null, keyword = '' } = {}) {
  const normalizedPage = Number(page) || 1
  const normalizedPageSize = Number(pageSize) || 20
  const offset = (normalizedPage - 1) * normalizedPageSize
  const conds = []
  const params = []

  if (type) {
    conds.push('pr.type=?')
    params.push(Number(type))
  }
  if (status) {
    conds.push('pr.status=?')
    params.push(Number(status))
  }
  const trimmedKeyword = String(keyword || '').trim()
  if (trimmedKeyword) {
    conds.push('(pr.order_no LIKE ? OR pr.party_name LIKE ?)')
    params.push(`%${trimmedKeyword}%`, `%${trimmedKeyword}%`)
  }

  // 读账款自带的结算方式快照，不回溯往来方主数据——改客户类型不影响历史账款归属。
  // query 传进来可能是 '1,3,4' 或数组，统一归一并丢掉非法值。
  const scopeList = normalizeSettlementList(settlementTypes)
  if (scopeList) {
    conds.push(`${SETTLEMENT_SCOPE_COLUMN} IN (${scopeList.map(() => '?').join(',')})`)
    params.push(...scopeList)
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT pr.* FROM payment_records pr ${where} ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`,
    [...params, normalizedPageSize, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM payment_records pr ${where}`, params)
  const [[summary]] = await pool.query(
    `SELECT COALESCE(SUM(pr.total_amount),0) AS totalAmount,
            COALESCE(SUM(pr.paid_amount),0) AS paidAmount,
            COALESCE(SUM(pr.balance),0) AS balance
     FROM payment_records pr ${where}`,
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
    // 手工创建的账款由录入人负责金额，视为已确认（confirm_status=1），
    // 待确认闸门只针对采购上架自动结算的应付（见 inbound-tasks.settle.js）。
    const [result] = await conn.query(
      `INSERT INTO payment_records (type,order_no,party_name,total_amount,balance,confirm_status,due_date,remark)
       VALUES (?,?,?,?,?,1,?,?)`,
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
    // 应付确认闸门：自动结算的应付须财务确认后才允许登记付款（分权：仓库结算、财务确认、出纳付款）
    if (Number(record.type) === 1 && Number(record.confirm_status) !== 1) {
      throw new AppError('该应付账款尚未财务确认，请先在往来页确认结算金额后再登记付款', 409)
    }

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

/** 财务确认应付结算金额：确认后才允许登记付款；金额被重算改变会自动打回待确认 */
async function confirmRecord(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[record]] = await conn.query('SELECT * FROM payment_records WHERE id=? FOR UPDATE', [id])
    if (!record) throw new AppError('账款记录不存在', 404)
    if (Number(record.type) !== 1) throw new AppError('只有应付账款需要财务确认', 400)
    if (Number(record.confirm_status) === 1) throw new AppError('该应付账款已确认', 409)
    await conn.query(
      `UPDATE payment_records
       SET confirm_status=1, confirmed_by=?, confirmed_by_name=?, confirmed_at=NOW()
       WHERE id=?`,
      [operator.operatorId ?? null, operator.operatorName ?? null, id],
    )
    await recordPaymentEvent(conn, {
      paymentRecordId: id,
      orderNo: record.order_no,
      eventType: PAYMENT_EVENT.CREATED,
      title: '应付结算已财务确认',
      description: `确认金额 ¥${Number(record.total_amount).toFixed(2)}，可登记付款`,
      operatorId: operator.operatorId,
      operatorName: operator.operatorName,
      requestId: getRequestId(),
      payload: { totalAmount: Number(record.total_amount) },
    })
    await conn.commit()
    return { id: Number(id), confirmStatus: 1 }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/**
 * 应付结算明细对照（财务确认页用）：与 recomputePurchasePayable 完全同口径——
 * 按收货订单×商品分行展示 实际上架量×采购单价，外加已执行采购退货的冲减行。
 */
async function settlementDetail(id) {
  const [[record]] = await pool.query('SELECT * FROM payment_records WHERE id=?', [id])
  if (!record) throw new AppError('账款记录不存在', 404)
  if (Number(record.type) !== 1) throw new AppError('只有应付账款有结算明细', 400)
  const poId = Number(record.order_id)
  if (!poId) return { record: mapPaymentRecord(record), lines: [], returns: [] }

  const [lines] = await pool.query(
    `SELECT it.task_no, iti.product_name, iti.article_number, iti.putaway_qty,
            poi.unit_price, iti.putaway_qty * poi.unit_price AS amount
       FROM inbound_tasks it
       JOIN inbound_task_items iti ON iti.task_id = it.id
       JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
      WHERE iti.purchase_order_id = ? AND it.deleted_at IS NULL
        AND it.status <> 5 AND it.audit_status = 1 AND iti.putaway_qty > 0
      ORDER BY it.id, iti.id`,
    [poId],
  )
  const [returns] = await pool.query(
    `SELECT return_no, total_amount FROM purchase_returns
      WHERE purchase_order_id = ? AND deleted_at IS NULL AND status = 3`,
    [poId],
  )
  return {
    record: mapPaymentRecord(record),
    lines: lines.map(r => ({
      taskNo: r.task_no,
      productName: r.product_name,
      articleNumber: r.article_number || null,
      putawayQty: Number(r.putaway_qty),
      unitPrice: Number(r.unit_price),
      amount: Number(r.amount),
    })),
    returns: returns.map(r => ({ returnNo: r.return_no, amount: -Number(r.total_amount) })),
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
  confirmRecord,
  settlementDetail,
  findEntries,
}
