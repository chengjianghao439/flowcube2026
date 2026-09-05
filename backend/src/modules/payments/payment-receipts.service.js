const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { getRequestId } = require('../../utils/requestContext')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('./payment-events.service')
const statementSvc = require('./reconciliation-statements.service')
const accountSvc = require('../finance/finance-accounts.service')
const { normalizePagination } = require('../../utils/pagination')

/**
 * 收付款单（汇款）与核销。
 *
 * 一笔汇款可以冲抵多笔账款：先落一张 payment_receipts 记录「钱进来了」，再按 allocations
 * 把这笔钱分配到各笔 payment_records 上，每条分配生成一行 payment_entries（带 receipt_id）。
 * 「按单登记」只是 allocations 长度为 1 的特例，两者共用同一套逻辑，不做成两条代码路径。
 *
 * 允许部分核销：分配合计可以小于汇款额，剩余留在 receipt.balance 上供下次继续核销
 * （这也就是预收/预付款）；单笔分配额也可以小于该账款余额，账款留「部分付」。
 */

const RECEIPT_STATUS = { PENDING: 1, PARTIAL: 2, SETTLED: 3 }

function fmtReceipt(row) {
  return {
    id: Number(row.id),
    receiptNo: row.receipt_no,
    type: Number(row.type),
    typeName: Number(row.type) === 1 ? '付款单' : '收款单',
    partyName: row.party_name,
    amount: Number(row.amount),
    settledAmount: Number(row.settled_amount),
    balance: Number(row.balance),
    status: Number(row.status),
    statusName: { 1: '待核销', 2: '部分核销', 3: '已核销' }[Number(row.status)],
    paymentDate: row.payment_date,
    method: row.method,
    accountId: row.account_id != null ? Number(row.account_id) : null,
    accountName: row.account_name || null,
    remark: row.remark,
    operatorName: row.operator_name,
    createdAt: row.created_at,
  }
}

/**
 * 把「核销对账单 N 元」展开成「核销其下各笔账款」。
 *
 * 按账款创建时间从早到晚依次填满（先清老账），最后一笔可能是部分核销。
 * 对账单必须是已确认状态——草稿单还能改明细，此时核销会让钱对不上账。
 */
async function expandStatementAllocation(conn, statementId, amount, receipt) {
  const [[st]] = await conn.query(
    'SELECT * FROM reconciliation_statements WHERE id=? AND deleted_at IS NULL FOR UPDATE',
    [statementId],
  )
  if (!st) throw new AppError(`对账单 ${statementId} 不存在`, 404)
  if (Number(st.type) !== Number(receipt.type)) throw new AppError(`${st.statement_no} 与本单类型不符`, 400)
  if (st.party_name !== receipt.party_name) {
    throw new AppError(`${st.statement_no} 属于「${st.party_name}」，与本单往来方「${receipt.party_name}」不一致`, 400)
  }
  if (Number(st.status) === statementSvc.ST.DRAFT) {
    throw new AppError(`${st.statement_no} 还是草稿，请先确认后再核销`, 409)
  }
  if (Number(st.balance) <= 1e-6) throw new AppError(`${st.statement_no} 已核销完毕`, 400)
  if (amount > Number(st.balance) + 1e-6) {
    throw new AppError(`核销 ¥${amount.toFixed(2)} 超出 ${st.statement_no} 未核销余额 ¥${Number(st.balance).toFixed(2)}`, 400)
  }

  const [items] = await conn.query(
    `SELECT r.id, r.balance
       FROM reconciliation_statement_items i
       JOIN payment_records r ON r.id = i.record_id
      WHERE i.statement_id = ? AND r.status <> 3
      ORDER BY r.created_at ASC, r.id ASC`,
    [statementId],
  )
  const parts = []
  let left = amount
  for (const it of items) {
    if (left <= 1e-6) break
    const take = Math.min(left, Number(it.balance))
    if (take > 1e-6) {
      // 精度对齐账款列 DECIMAL(14,4)：舍到 2 位会让 ¥12.3456 这类 3-4 位小数账款的分配额
      // 大于其余额而在 applyAllocations 处被拒，或残留分厘无法结清（unit_price 可含 4 位小数）。
      parts.push({ recordId: Number(it.id), amount: Number(take.toFixed(4)), statementId: Number(statementId) })
      left -= take
    }
  }
  if (left > 1e-6) {
    throw new AppError(`${st.statement_no} 下属账款可核销额不足，尚余 ¥${left.toFixed(2)} 无法分配`, 400)
  }
  return parts
}

/** 汇款单余额变动后重算状态：未动过=待核销，动过但没用完=部分核销，用完=已核销 */
function resolveReceiptStatus(amount, settled) {
  if (settled <= 0) return RECEIPT_STATUS.PENDING
  if (settled >= amount) return RECEIPT_STATUS.SETTLED
  return RECEIPT_STATUS.PARTIAL
}

/**
 * 把一笔汇款分配核销到若干账款。调用方已开启事务并锁好 receipt 行。
 *
 * 加锁顺序：账款按 id 升序逐行 FOR UPDATE，与 payments.service.recordPayment 的单行锁
 * 共存时不会形成环路（见 CLAUDE.md 第 11 节「加锁顺序统一」）。
 */
async function applyAllocations(conn, receipt, allocations, operator) {
  // 统一加锁顺序 statement→record，且 statement 之间也按 id 全局升序：先把本次会触及的所有对账单行
  // （显式核销的 + 直核账款所属的）去重、升序、一次性 FOR UPDATE，再展开、再按 record id 升序锁账款。
  // 原实现里显式对账单在 expandStatementAllocation 内按 allocations 数组顺序逐个加锁、extra 对账单
  // 又在展开后另行升序加锁，两段合起来并非全局有序——两个请求传入的对账单顺序相反（或与 recordPayment
  // 的 ORDER BY statement_id 交错）时会 ABBA 死锁。全局升序预锁后，expandStatementAllocation 内部的
  // FOR UPDATE 成同事务重入，顺序由此处统一掌控；也保证结尾 refreshSettlement 聚合时 statement 已锁。
  const explicitStatementIds = allocations.filter(a => a.statementId).map(a => Number(a.statementId))
  const directRecordIds = [...new Set(
    allocations.filter(a => !a.statementId && a.recordId).map(a => Number(a.recordId)),
  )]
  const extraStatementIds = []
  if (directRecordIds.length) {
    const [extra] = await conn.query(
      'SELECT DISTINCT statement_id FROM reconciliation_statement_items WHERE record_id IN (?)',
      [directRecordIds],
    )
    extra.forEach(s => extraStatementIds.push(Number(s.statement_id)))
  }
  const touchedStatements = [...new Set([...explicitStatementIds, ...extraStatementIds])].sort((a, b) => a - b)
  for (const sid of touchedStatements) {
    await conn.query('SELECT id FROM reconciliation_statements WHERE id=? FOR UPDATE', [sid])
  }

  // 展开对账单类分配成账款级分配：核销的钱最终必须落到 payment_records 上，账款余额才是唯一事实源，
  // 对账单的 settled_amount 只是它们的汇总投影。上面已按序预锁 statement，此处展开时不再新增锁序风险。
  const flattened = []
  for (const a of allocations) {
    if (a.statementId) {
      flattened.push(...await expandStatementAllocation(conn, Number(a.statementId), Number(a.amount), receipt))
    } else {
      flattened.push({ recordId: Number(a.recordId), amount: Number(a.amount), statementId: null })
    }
  }
  const sorted = flattened.sort((a, b) => a.recordId - b.recordId)

  let allocatedTotal = 0
  const applied = []

  for (const alloc of sorted) {
    if (!Number.isFinite(alloc.amount) || alloc.amount <= 0) {
      throw new AppError('核销金额必须大于 0', 400)
    }
    const [[record]] = await conn.query('SELECT * FROM payment_records WHERE id=? FOR UPDATE', [alloc.recordId])
    if (!record) throw new AppError(`账款记录 ${alloc.recordId} 不存在`, 404)
    if (Number(record.type) !== Number(receipt.type)) {
      throw new AppError(`${record.order_no} 与本${receipt.type === 1 ? '付款' : '收款'}单类型不符`, 400)
    }
    if (record.party_name !== receipt.party_name) {
      throw new AppError(`${record.order_no} 属于「${record.party_name}」，与本单往来方「${receipt.party_name}」不一致`, 400)
    }
    if (Number(record.status) === 3) {
      throw new AppError(`${record.order_no} 已结清，无需再核销`, 400)
    }
    // 应付确认闸门与单笔登记保持一致：未经财务确认的应付不允许出款
    if (Number(record.type) === 1 && Number(record.confirm_status) !== 1) {
      throw new AppError(`${record.order_no} 尚未财务确认，请先确认结算金额`, 409)
    }
    const recordBalance = Number(record.balance)
    if (alloc.amount > recordBalance + 1e-6) {
      throw new AppError(`${record.order_no} 核销 ¥${alloc.amount.toFixed(2)} 超出其余额 ¥${recordBalance.toFixed(2)}`, 400)
    }

    const newPaid = Number(record.paid_amount) + alloc.amount
    const newBalance = Number(record.total_amount) - newPaid
    const newStatus = newBalance <= 1e-6 ? 3 : 2
    await conn.query(
      'UPDATE payment_records SET paid_amount=?,balance=?,status=? WHERE id=?',
      [newPaid, Math.max(0, newBalance), newStatus, alloc.recordId],
    )
    await conn.query(
      `INSERT INTO payment_entries (record_id,receipt_id,statement_id,amount,payment_date,method,remark,operator_id,operator_name)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        alloc.recordId, receipt.id, alloc.statementId || null, alloc.amount, receipt.payment_date,
        receipt.method || null, `核销自 ${receipt.receipt_no}`,
        operator.operatorId, operator.operatorName,
      ],
    )
    await recordPaymentEvent(conn, {
      paymentRecordId: alloc.recordId,
      orderNo: record.order_no,
      eventType: PAYMENT_EVENT.PAYMENT_RECORDED,
      title: '核销登记',
      description: `由${receipt.type === 1 ? '付款' : '收款'}单 ${receipt.receipt_no} 核销 ¥${alloc.amount.toFixed(2)}${newStatus === 3 ? '，账款已结清' : ''}`,
      operatorId: operator.operatorId,
      operatorName: operator.operatorName,
      requestId: getRequestId(),
      payload: { receiptId: receipt.id, receiptNo: receipt.receipt_no, amount: alloc.amount, balanceAfter: Math.max(0, newBalance) },
    })

    allocatedTotal += alloc.amount
    applied.push({ recordId: alloc.recordId, orderNo: record.order_no, amount: alloc.amount, settled: newStatus === 3 })
  }

  const newSettled = Number(receipt.settled_amount) + allocatedTotal
  if (newSettled > Number(receipt.amount) + 1e-6) {
    throw new AppError(
      `核销合计 ¥${newSettled.toFixed(2)} 超出汇款金额 ¥${Number(receipt.amount).toFixed(2)}`,
      400,
    )
  }
  const newReceiptBalance = Number(receipt.amount) - newSettled
  await conn.query(
    'UPDATE payment_receipts SET settled_amount=?,balance=?,status=? WHERE id=?',
    [newSettled, Math.max(0, newReceiptBalance), resolveReceiptStatus(Number(receipt.amount), newSettled), receipt.id],
  )

  // 账款动过之后重算对账单汇总（投影，不独立累加，避免两处漂移）。
  // touchedStatements 含显式核销的对账单与直核账款所属的对账单，两类的 statement 行都已在
  // 记录循环之前 FOR UPDATE 锁住，聚合重算不会与并发直付/核销相互丢失更新。
  for (const sid of touchedStatements) {
    await statementSvc.refreshSettlement(conn, sid)
  }

  return { allocatedTotal, applied, receiptBalance: Math.max(0, newReceiptBalance) }
}

/**
 * 新建收付款单，并可同时核销若干账款（allocations 可为空 = 先挂账，之后再核销）。
 * 接 requestKey 幂等：核销直接改钱，连点两次或断网重试都不能重复扣。
 */
async function create({ type, partyName, amount, paymentDate, method, accountId, remark, allocations = [] }, operator, requestKey) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const reqState = await beginOperationRequest(conn, {
      requestKey,
      action: 'payment.receipt.create',
      userId: operator.operatorId,
    })
    if (reqState.replay) {
      // 重放命中已成功的请求：直接返回原响应，绝不重复核销
      await conn.commit()
      return reqState.responseData ?? { replayed: true }
    }

    const total = Number(amount)
    if (!Number.isFinite(total) || total <= 0) throw new AppError('汇款金额必须大于 0', 400)

    const prefix = Number(type) === 1 ? 'PY' : 'RC'
    const receiptNo = await generateDailyCode(conn, prefix, 'payment_receipts', 'receipt_no')
    const [r] = await conn.query(
      `INSERT INTO payment_receipts
         (receipt_no,type,party_name,amount,settled_amount,balance,status,payment_date,method,account_id,remark,operator_id,operator_name)
       VALUES (?,?,?,?,0,?,1,?,?,?,?,?,?)`,
      [receiptNo, Number(type), partyName, total, total, paymentDate, method || null, accountId || null,
       remark || null, operator.operatorId, operator.operatorName],
    )

    // 资金流水与收付款单同事务：钱记在哪个账户上必须和这笔业务同生共死。
    // 应收(type=2)是钱进来，应付(type=1)是钱出去。
    if (accountId) {
      await accountSvc.recordTransaction(conn, {
        accountId,
        direction: Number(type) === 2 ? accountSvc.DIRECTION.IN : accountSvc.DIRECTION.OUT,
        amount: total,
        bizType: Number(type) === 2 ? accountSvc.BIZ_TYPE.RECEIPT : accountSvc.BIZ_TYPE.PAYMENT,
        bizId: r.insertId,
        bizNo: receiptNo,
        partyName,
        happenedAt: paymentDate,
        remark: remark || null,
      }, operator)
    }
    const receipt = {
      id: r.insertId, receipt_no: receiptNo, type: Number(type), party_name: partyName,
      amount: total, settled_amount: 0, payment_date: paymentDate, method: method || null,
    }

    let result = { allocatedTotal: 0, applied: [], receiptBalance: total }
    if (allocations.length) result = await applyAllocations(conn, receipt, allocations, operator)

    const data = {
      id: r.insertId,
      receiptNo,
      amount: total,
      settledAmount: result.allocatedTotal,
      balance: result.receiptBalance,
      applied: result.applied,
    }
    await completeOperationRequest(conn, reqState, { data, resourceType: 'payment_receipt', resourceId: r.insertId })
    await conn.commit()
    return data
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 用某张收付款单的剩余余额继续核销（预收款后续冲抵订单走这里） */
async function settle(receiptId, { allocations = [] }, operator, requestKey) {
  if (!allocations.length) throw new AppError('请至少选择一笔账款进行核销', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const reqState = await beginOperationRequest(conn, {
      requestKey,
      action: 'payment.receipt.settle',
      userId: operator.operatorId,
    })
    if (reqState.replay) {
      // 重放命中已成功的请求：直接返回原响应，绝不重复核销
      await conn.commit()
      return reqState.responseData ?? { replayed: true }
    }

    const [[receipt]] = await conn.query(
      'SELECT * FROM payment_receipts WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [receiptId],
    )
    if (!receipt) throw new AppError('收付款单不存在', 404)
    if (Number(receipt.status) === RECEIPT_STATUS.SETTLED) throw new AppError('该单已核销完毕', 400)

    const result = await applyAllocations(conn, receipt, allocations, operator)
    const data = {
      id: Number(receiptId),
      receiptNo: receipt.receipt_no,
      settledAmount: Number(receipt.settled_amount) + result.allocatedTotal,
      balance: result.receiptBalance,
      applied: result.applied,
    }
    await completeOperationRequest(conn, reqState, { data, resourceType: 'payment_receipt', resourceId: Number(receiptId) })
    await conn.commit()
    return data
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function findAll({
  page = 1, pageSize = 20, type = '', status = '', keyword = '',
  receiptNo = '', partyName = '',
  startDate = '', endDate = '', minAmount = '', maxAmount = '',
} = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  // 列名一律带 r. 前缀：主查询要 JOIN 账户表取名称，不加前缀会有歧义
  const conds = ['r.deleted_at IS NULL']
  const params = []
  if (type) { conds.push('r.type=?'); params.push(Number(type)) }
  if (status) { conds.push('r.status=?'); params.push(Number(status)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(r.receipt_no LIKE ? OR r.party_name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`) }
  const no = String(receiptNo || '').trim()
  if (no) { conds.push('r.receipt_no LIKE ?'); params.push(`%${no}%`) }
  const party = String(partyName || '').trim()
  if (party) { conds.push('r.party_name LIKE ?'); params.push(`%${party}%`) }
  if (startDate) { conds.push('r.payment_date>=?'); params.push(startDate) }
  if (endDate)   { conds.push('r.payment_date<=?'); params.push(endDate) }
  if (minAmount !== '' && minAmount != null) { conds.push('r.amount>=?'); params.push(Number(minAmount)) }
  if (maxAmount !== '' && maxAmount != null) { conds.push('r.amount<=?'); params.push(Number(maxAmount)) }
  const where = `WHERE ${conds.join(' AND ')}`

  const [rows] = await pool.query(
    `SELECT r.*, a.name AS account_name
       FROM payment_receipts r
       LEFT JOIN finance_accounts a ON a.id = r.account_id
       ${where}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM payment_receipts r ${where}`, params)
  const [[summary]] = await pool.query(
    `SELECT COALESCE(SUM(r.amount),0) AS amount,
            COALESCE(SUM(r.settled_amount),0) AS settledAmount,
            COALESCE(SUM(r.balance),0) AS balance
     FROM payment_receipts r ${where}`,
    params,
  )
  return {
    list: rows.map(fmtReceipt),
    summary: { amount: Number(summary.amount), settledAmount: Number(summary.settledAmount), balance: Number(summary.balance) },
    pagination: { page: p, pageSize: ps, total },
  }
}

/** 收付款单详情：含核销到哪些账款 */
async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT r.*, a.name AS account_name FROM payment_receipts r
       LEFT JOIN finance_accounts a ON a.id = r.account_id
      WHERE r.id=? AND r.deleted_at IS NULL`, [id])
  if (!row) throw new AppError('收付款单不存在', 404)
  const [entries] = await pool.query(
    `SELECT e.id, e.amount, e.payment_date, e.created_at,
            r.id AS record_id, r.order_no, r.total_amount, r.paid_amount, r.balance, r.status
       FROM payment_entries e
       JOIN payment_records r ON r.id = e.record_id
      WHERE e.receipt_id = ?
      ORDER BY e.id ASC`,
    [id],
  )
  return {
    ...fmtReceipt(row),
    settlements: entries.map(e => ({
      entryId: Number(e.id),
      recordId: Number(e.record_id),
      orderNo: e.order_no,
      amount: Number(e.amount),
      orderTotal: Number(e.total_amount),
      orderPaid: Number(e.paid_amount),
      orderBalance: Number(e.balance),
      orderStatus: Number(e.status),
      createdAt: e.created_at,
    })),
  }
}

module.exports = { create, settle, findAll, findById, RECEIPT_STATUS }
