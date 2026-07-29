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
async function assertReturnPaymentHeadroom(conn, { recordType, orderId = null, orderNo = null, amount }) {
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
    throw new AppError(
      `该账款已登记金额 ¥${currentPaid.toFixed(2)}，预计退货 ¥${Number(amount || 0).toFixed(2)} 后将形成负余额；请先处理退款/退款凭证后再确认退货`,
      409,
    )
  }
}

module.exports = { genNo, adjustPaymentRecordForReturn, assertReturnPaymentHeadroom }
