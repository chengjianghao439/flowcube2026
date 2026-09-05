const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getRequestId } = require('../../utils/requestContext')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('./payment-events.service')
const statementSvc = require('./reconciliation-statements.service')
const accountSvc = require('../finance/finance-accounts.service')
const { SETTLEMENT_SCOPE_COLUMN, isValidSettlementType } = require('../../constants/settlementType')
const { normalizePagination } = require('../../utils/pagination')

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
async function findAll({
  page = 1, pageSize = 20, type = '', status = '', settlementTypes = null, keyword = '',
  orderNo = '', partyName = '',
  confirmStatus = '', startDate = '', endDate = '', dueStart = '', dueEnd = '',
  minAmount = '', maxAmount = '',
} = {}) {
  const { page: normalizedPage, pageSize: normalizedPageSize, offset } = normalizePagination({ page, pageSize })
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
  // keyword 是跨两列的模糊搜索（旧调用方仍在用）；orderNo/partyName 是查询弹窗拆开后的独立条件
  const trimmedKeyword = String(keyword || '').trim()
  if (trimmedKeyword) {
    conds.push('(pr.order_no LIKE ? OR pr.party_name LIKE ?)')
    params.push(`%${trimmedKeyword}%`, `%${trimmedKeyword}%`)
  }
  const trimmedOrderNo = String(orderNo || '').trim()
  if (trimmedOrderNo) { conds.push('pr.order_no LIKE ?'); params.push(`%${trimmedOrderNo}%`) }
  const trimmedParty = String(partyName || '').trim()
  if (trimmedParty) { conds.push('pr.party_name LIKE ?'); params.push(`%${trimmedParty}%`) }
  // 查询弹窗的高级条件：确认状态、创建日期区间、到期日区间、金额区间
  if (confirmStatus !== '' && confirmStatus != null) {
    conds.push('pr.confirm_status=?'); params.push(Number(confirmStatus))
  }
  // 半开区间（对齐 sale/purchase 的写法）：DATE(col) 包裹会废掉 created_at 索引（审计 2026-08-30）
  if (startDate) { conds.push('pr.created_at>=?'); params.push(`${startDate} 00:00:00`) }
  if (endDate)   { conds.push('pr.created_at<DATE_ADD(?, INTERVAL 1 DAY)'); params.push(endDate) }
  if (dueStart)  { conds.push('pr.due_date>=?'); params.push(dueStart) }
  if (dueEnd)    { conds.push('pr.due_date<=?'); params.push(dueEnd) }
  if (minAmount !== '' && minAmount != null) { conds.push('pr.total_amount>=?'); params.push(Number(minAmount)) }
  if (maxAmount !== '' && maxAmount != null) { conds.push('pr.total_amount<=?'); params.push(Number(maxAmount)) }

  // 读账款自带的结算方式快照，不回溯往来方主数据——改客户类型不影响历史账款归属。
  // query 传进来可能是 '1,3,4' 或数组，统一归一并丢掉非法值。
  const scopeList = normalizeSettlementList(settlementTypes)
  if (scopeList) {
    conds.push(`${SETTLEMENT_SCOPE_COLUMN} IN (${scopeList.map(() => '?').join(',')})`)
    params.push(...scopeList)
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT pr.* FROM payment_records pr ${where} ORDER BY pr.created_at DESC, pr.id DESC LIMIT ? OFFSET ?`,
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

async function createManual({ type, orderNo, partyName, totalAmount, dueDate, remark }, operator, requestKey) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 幂等（2026-08-21 审计高危修复）：手工建账款是全财务域唯一无防护的改钱路径——
    // order_id 恒 NULL 使 UNIQUE(type, order_id) 失效（多个 NULL 不冲突），连点两次
    // 会落两条同金额账款各自可核销翻倍。这里与 recordPayment 对齐接 requestKey。
    // 缺 X-Request-Key 时 beginOperationRequest 返回 enabled:false 直接放行，不影响老客户端。
    const reqState = await beginOperationRequest(conn, {
      requestKey,
      action: 'payment.record.create',
      userId: operator?.operatorId ?? null,
    })
    if (reqState.replay) {
      await conn.commit()
      return reqState.responseData ?? { id: null, replayed: true }
    }

    // 手工创建的账款由录入人负责金额，视为已确认（confirm_status=1），
    // 待确认闸门只针对采购上架自动结算的应付（见 inbound-tasks.settle.js）。
    // order_id 必须显式写 NULL：它是 UNIQUE(type, order_id) 的一半，手工账款没有关联单据，
    // 只有 NULL 才能容纳多条（多个 NULL 不互相冲突）。省略该列会在 STRICT 模式下直接报
    // 「doesn't have a default value」——见迁移 145。
    const [result] = await conn.query(
      `INSERT INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,confirm_status,due_date,remark)
       VALUES (?,NULL,?,?,?,?,1,?,?)`,
      [type, orderNo, partyName, totalAmount, totalAmount, dueDate || null, remark || null],
    )
    const created = { id: result.insertId }
    await recordPaymentEvent(conn, {
      paymentRecordId: result.insertId,
      orderNo,
      eventType: PAYMENT_EVENT.CREATED,
      title: '账款记录已创建',
      description: `${type === 1 ? '应付' : '应收'}账款已创建`,
      operatorId: operator?.operatorId ?? null,
      operatorName: operator?.operatorName ?? null,
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
    await completeOperationRequest(conn, reqState, { data: created })
    await conn.commit()
    return created
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function recordPayment(id, { amount, paymentDate, method, remark, accountId }, operator, requestKey) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 幂等：直接登记付款/收款也是「改钱」，连点两次/断网重试不能重复登记（与收付款核销一致）。
    // 缺 X-Request-Key 时 beginOperationRequest 返回 enabled:false 直接放行，不影响老客户端。
    const reqState = await beginOperationRequest(conn, {
      requestKey,
      action: 'payment.record.pay',
      userId: operator.operatorId,
    })
    if (reqState.replay) {
      await conn.commit()
      return reqState.responseData ?? { replayed: true }
    }

    // 若指定资金账户：先锁账户行，保持与 receipts 核销路径「账户 → 对账单 → 账款」一致的加锁
    // 顺序，避免与并发核销(receipts.create 先 recordTransaction 锁账户、再核销锁对账单/账款)
    // 形成 account↔record 反向环死锁。后面的 recordTransaction 对同一账户行是同事务重入。
    if (accountId) {
      await conn.query('SELECT id FROM finance_accounts WHERE id=? FOR UPDATE', [accountId])
    }

    // 统一加锁顺序 statement→record：先锁该账款所属对账单行（若有，升序），再锁账款行。
    // ① 与核销路径（expandStatementAllocation 先锁 statement 再锁 record）方向一致，避免环形等待死锁；
    // ② 结尾 refreshSettlement 依赖的 statement 行必须在聚合重算前锁住，否则并发直付会丢失更新、
    //    把 settled_amount 算少（对照 finance-accounts.recordTransaction 先锁账户行再 refreshBalance 的正范式）。
    const [stmtRows] = await conn.query(
      'SELECT DISTINCT statement_id FROM reconciliation_statement_items WHERE record_id = ? ORDER BY statement_id',
      [id],
    )
    for (const s of stmtRows) {
      await conn.query('SELECT id FROM reconciliation_statements WHERE id=? FOR UPDATE', [s.statement_id])
    }

    const [[record]] = await conn.query('SELECT * FROM payment_records WHERE id=? FOR UPDATE', [id])
    if (!record) throw new AppError('账款记录不存在', 404)
    if (record.status === 3) throw new AppError('该账款已付清', 400)
    // 应付确认闸门：自动结算的应付须财务确认后才允许登记付款（分权：仓库结算、财务确认、出纳付款）
    if (Number(record.type) === 1 && Number(record.confirm_status) !== 1) {
      throw new AppError('该应付账款尚未财务确认，请先在往来页确认结算金额后再登记付款', 409)
    }

    const newPaid = Number(record.paid_amount) + amount
    // 浮点容差与核销路径一致（DECIMAL→JS float 累加可能出现 100.00000001，严格 > 会误拒合法全额付款）
    if (newPaid > Number(record.total_amount) + 1e-6) {
      throw new AppError(`付款金额超出余额 ¥${Number(record.balance).toFixed(2)}`, 400)
    }

    const newBalance = Math.max(0, Number(record.total_amount) - newPaid)
    const newStatus = newBalance <= 1e-6 ? 3 : 2
    await conn.query(
      'UPDATE payment_records SET paid_amount=?,balance=?,status=? WHERE id=?',
      [newPaid, newBalance, newStatus, id],
    )
    const [entryResult] = await conn.query(
      `INSERT INTO payment_entries (record_id,amount,payment_date,method,account_id,remark,operator_id,operator_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, amount, paymentDate, method || null, accountId || null, remark || null, operator.operatorId, operator.operatorName],
    )
    // 资金账户流水与账款登记同事务：钱记在哪个账户上必须与业务同生共死（与 receipts 路径对称）。
    // 应收(type=2)钱进来 → IN/RECEIPT；应付(type=1)钱出去 → OUT/PAYMENT。未选账户不传时跳过
    // （routes 里 accountId optional，兼容旧客户端；新前端弹窗必填）。
    if (accountId) {
      await accountSvc.recordTransaction(conn, {
        accountId,
        direction: Number(record.type) === 2 ? accountSvc.DIRECTION.IN : accountSvc.DIRECTION.OUT,
        amount,
        bizType: Number(record.type) === 2 ? accountSvc.BIZ_TYPE.RECEIPT : accountSvc.BIZ_TYPE.PAYMENT,
        bizId: entryResult.insertId,
        bizNo: record.order_no,
        partyName: record.party_name,
        happenedAt: paymentDate,
        remark: remark || null,
      }, operator)
    }
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
    // 纵深防御：若该账款属于某对账单，付款后同事务刷新对账单汇总投影。正常 UI 里月结账款只经
    // 对账单分配核销（必刷新），但 /payments/:id/pay 直付账款是另一条入口，不刷会让对账单
    // settled_amount/状态漂移（存疑修复 2026-07-28）。statement 行已在上面按序锁住。
    for (const s of stmtRows) {
      await statementSvc.refreshSettlement(conn, s.statement_id)
    }

    const result = { newPaid, newBalance, status: newStatus }
    await completeOperationRequest(conn, reqState, {
      data: result, resourceType: 'payment_record', resourceId: Number(id),
    })
    await conn.commit()
    return result
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
