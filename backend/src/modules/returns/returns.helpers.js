const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('../payments/payment-events.service')
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

  const [[record]] = await conn.query(
    `SELECT * FROM payment_records WHERE ${where} ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    params,
  )
  if (!record) return null

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

module.exports = { genNo, adjustPaymentRecordForReturn }
