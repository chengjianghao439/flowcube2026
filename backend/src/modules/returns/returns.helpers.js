const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('../payments/payment-events.service')
const statementSvc = require('../payments/reconciliation-statements.service')
const { getRequestId } = require('../../utils/requestContext')

const genNo = (conn, prefix, table, col) => generateDailyCode(conn, prefix, table, col)

function calcPaymentStatus(totalAmount, paidAmount) {
  const total = Number(totalAmount || 0)
  const paid = Number(paidAmount || 0)
  const balance = Number((total - paid).toFixed(4))
  if (balance <= 0) return { balance, status: 3 }
  if (paid > 0) return { balance, status: 2 }
  return { balance, status: 1 }
}

async function adjustPaymentRecordForReturn(conn, {
  recordType,
  orderId = null,
  orderNo = null,
  returnNo,
  returnType,
  amount,
  operator,
}) {
  const params = [recordType]
  let where = 'type=?'
  if (orderId) {
    where += ' AND order_id=?'
    params.push(orderId)
  } else if (orderNo) {
    where += ' AND order_no=?'
    params.push(orderNo)
  } else {
    return null
  }

  const [[identity]] = await conn.query(
    `SELECT id, type, order_id, order_no FROM payment_records WHERE ${where} ORDER BY id DESC LIMIT 1`,
    params,
  )
  if (!identity) {
    // 普通销售退货可能已建立RR旧视图；空快照不能证明当前确实没有账款。
    // 这里只核当前存在性；发现新账款即回滚重核，不能在已锁账款后追锁对账单。
    const [[current]] = await conn.query(
      `SELECT id FROM payment_records WHERE ${where} ORDER BY id DESC LIMIT 1 FOR SHARE`,
      params,
    )
    if (current) throw new AppError('账款已变化，请刷新后核对退货账款', 409, 'RETURN_PAYMENT_CONTEXT_CHANGED')
    return null
  }
  const [stmtRows] = await conn.query(
    'SELECT DISTINCT statement_id FROM reconciliation_statement_items WHERE record_id = ? ORDER BY statement_id',
    [identity.id],
  )
  for (const s of stmtRows) {
    const [[statement]] = await conn.query('SELECT id FROM reconciliation_statements WHERE id=? FOR UPDATE', [s.statement_id])
    if (!statement) throw new AppError('对账关系已变化，请刷新后核对退货账款', 409, 'RETURN_PAYMENT_CONTEXT_CHANGED')
  }
  const [[record]] = await conn.query(
    `SELECT * FROM payment_records WHERE ${where} ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    params,
  )
  const [memberRows] = await conn.query(
    'SELECT statement_id FROM reconciliation_statement_items WHERE record_id = ? ORDER BY statement_id, id FOR SHARE',
    [identity.id],
  )
  const currentMembers = [...new Set(memberRows.map(row => Number(row.statement_id)))]
  if (!record || Number(record.id) !== Number(identity.id)
    || Number(record.type) !== Number(identity.type)
    || Number(record.order_id || 0) !== Number(identity.order_id || 0)
    || record.order_no !== identity.order_no
    || currentMembers.length !== stmtRows.length
    || currentMembers.some((id, index) => id !== Number(stmtRows[index].statement_id))) {
    throw new AppError('账款或对账关系已变化，请刷新后核对退货账款', 409, 'RETURN_PAYMENT_CONTEXT_CHANGED')
  }

  const currentTotal = Number(record.total_amount || 0)
  const currentPaid = Number(record.paid_amount || 0)
  const newTotal = Number((currentTotal - Number(amount || 0)).toFixed(4))
  if (newTotal < 0) {
    throw new AppError(`退货金额超出原账款总额，无法回冲`, 409)
  }
  if (currentPaid > newTotal) {
    throw new AppError(
      `当前账款已登记金额 ¥${currentPaid.toFixed(2)}，退货后将形成负余额；请先处理退款/退款凭证后再执行退货`,
      409,
    )
  }

  const { balance, status } = calcPaymentStatus(newTotal, currentPaid)
  // 退货冲减后把 confirm_status 打回待确认(0)：金额已变，须由财务重新复核后才能再付款/核销
  // （与 inbound settle 的「金额变化即打回确认」口径一致，业务决策 2026-07-28）。
  await conn.query(
    'UPDATE payment_records SET total_amount=?, balance=?, status=?, confirm_status=0 WHERE id=?',
    [newTotal, balance, status, record.id],
  )

  // 对账单投影刷新（2026-08-21 审计 E.3 修复）：退货冲减 total_amount 后，
  // 若该账款属于某对账单，同事务刷新 settled_amount/状态（对齐 recordPayment 范式）。
  for (const s of stmtRows) {
    await statementSvc.refreshSettlement(conn, s.statement_id, { currentRead: true })
  }
  await recordPaymentEvent(conn, {
    paymentRecordId: Number(record.id),
    orderNo: record.order_no,
    eventType: PAYMENT_EVENT.ADJUSTED_BY_RETURN,
    title: '退货冲减账款',
    description: `${returnType === 'purchase' ? '采购退货' : '销售退货'} ${returnNo} 已冲减账款`,
    operatorId: operator.userId,
    operatorName: operator.realName,
    requestId: getRequestId(),
    payload: {
      returnType,
      returnNo,
      adjustAmount: Number(amount || 0),
      oldTotalAmount: currentTotal,
      newTotalAmount: newTotal,
      paidAmount: currentPaid,
      newBalance: balance,
      status,
    },
  })
  return { id: Number(record.id), newTotal, newBalance: balance, status }
}

/**
 * 退货确认前的负余额预判（只读，不写、不加锁）。
 *
 * 尽早拦截「已付/已核销金额 > 退货冲减后账款总额」的退货：否则单据要走到执行末端
 * （销售侧最后一箱上架、采购侧出库）才由 adjustPaymentRecordForReturn 抛 409 回滚，
 * 此前的物理动作全部作废、单据卡在中间态。这里在 confirm 阶段先按「计划全额」预判。
 *
 * 定位为「预判提示」而非最终闸门：
 *  - 用非锁定读，不在 confirm 事务里长持 payment_records 锁；
 *  - confirm 通过后若又对该账款登记了付款，末端 adjustPaymentRecordForReturn 的 FOR UPDATE
 *    校验仍会兜底拦截（前置不能替代末端）；
 *  - 销售退货实际按合格量冲减（≤计划量），故按计划全额预判是保守的，可能拦下「若大量质检
 *    不合格其实不会负余额」的单——这与「前置拦截 + 末端兜底」的定位一致，文案用「预计」；
 *  - 账款尚未生成时（如现结应付要到收货上架完成才落库）直接放行，交由末端兜底。
 */
async function assertReturnPaymentHeadroom(conn, { recordType, orderId = null, orderNo = null, amount, purchaseReturnId = null }) {
  const params = [recordType]
  let where = 'type=?'
  if (orderId) {
    where += ' AND order_id=?'
    params.push(orderId)
  } else if (orderNo) {
    where += ' AND order_no=?'
    params.push(orderNo)
  } else {
    return
  }
  const [[record]] = await conn.query(
    `SELECT total_amount, paid_amount FROM payment_records WHERE ${where} ORDER BY id DESC LIMIT 1`,
    params,
  )
  if (!record) return
  const currentTotal = Number(record.total_amount || 0)
  const currentPaid = Number(record.paid_amount || 0)
  const newTotal = Number((currentTotal - Number(amount || 0)).toFixed(4))
  if (currentPaid > newTotal) {
    const refundSource = recordType === 1 && Number.isSafeInteger(purchaseReturnId) && purchaseReturnId > 0 && Number.isSafeInteger(orderId) && orderId > 0
      ? { purchaseReturnId, purchaseOrderId: orderId } : null
    throw new AppError(
      `该账款已登记金额 ¥${currentPaid.toFixed(2)}，预计退货 ¥${Number(amount || 0).toFixed(2)} 后将形成负余额；请先处理退款/退款凭证后再确认退货`,
      409,
      refundSource ? 'PURCHASE_RETURN_REFUND_REQUIRED' : null,
      refundSource,
    )
  }
}

module.exports = { genNo, adjustPaymentRecordForReturn, assertReturnPaymentHeadroom }
