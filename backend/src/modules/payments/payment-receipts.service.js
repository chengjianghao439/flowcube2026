const { moneyUnits, moneyText, moneyNumber } = require('../../utils/decimalMoney')
const { assertAllocationParty, resolveReceiptParty } = require('./party-identity')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { getRequestId } = require('../../utils/requestContext')
const { beginCreationOperationRequest, beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('./payment-events.service')
const statementSvc = require('./reconciliation-statements.service')
const accountSvc = require('../finance/finance-accounts.service')
const { normalizePagination } = require('../../utils/pagination')
const { assertFinancePeriodOpen, tryRecordBackfillApplication } = require('../accounting/finance-period.guard')

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
    partyId: row.party_id ? Number(row.party_id) : null,
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
  if (receipt.party_id == null && st.party_name !== receipt.party_name) {
    throw new AppError(`${st.statement_no} 属于「${st.party_name}」，与本单往来方「${receipt.party_name}」不一致`, 400)
  }
  if (Number(st.status) === statementSvc.ST.DRAFT) {
    throw new AppError(`${st.statement_no} 还是草稿，请先确认后再核销`, 409)
  }
  const amountUnits = moneyUnits(amount)
  if (moneyUnits(st.balance) <= 0n) throw new AppError(`${st.statement_no} 已核销完毕`, 400)
  if (amountUnits > moneyUnits(st.balance)) {
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
  let left = amountUnits
  for (const it of items) {
    if (left <= 0n) break
    const balance = moneyUnits(it.balance)
    const take = left < balance ? left : balance
    if (take > 0n) {
      // 精度对齐账款列 DECIMAL(14,4)：舍到 2 位会让 ¥12.3456 这类 3-4 位小数账款的分配额
      // 大于其余额而在 applyAllocations 处被拒，或残留分厘无法结清（unit_price 可含 4 位小数）。
      parts.push({ recordId: Number(it.id), amount: moneyNumber(take), statementId: Number(statementId) })
      left -= take
    }
  }
  if (left > 0n) {
    throw new AppError(`${st.statement_no} 下属账款可核销额不足，尚余 ¥${moneyNumber(left).toFixed(2)} 无法分配`, 400)
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
 * 申请跨期补录前的**只读**可执行性预检（2026-09-26 一致性审查 · 任务 7）。
 *
 * 为什么必须有：审批是异步的。申请时不看这笔业务此刻做不做得成，一张明摆着核销不成的单子
 * （账款已结清、对账单还是草稿、金额超余额）也会一路走到审批，批准后执行失败停在
 * 「已批准 · 待执行」——审批人批了个注定执行不了的动作，还得人工作废。
 * 这里与下面 applyAllocations 的校验用同一套判定，但那边的判定带行锁、才是权威；
 * 这里只读不锁、**不做任何承诺**：审批期间账款被别的单子先结清仍然可能发生，那种漂移由
 * 「作废 / 重新申请」兜底（finance-backfills.service.cancel），不靠这里假装能保证。
 */
async function precheckAllocations(allocations, { type, partyId = null, partyName = null } = {}) {
  const label = Number(type) === 1 ? '付款单' : '收款单'
  for (const alloc of allocations) {
    if (alloc.statementId) {
      const [[st]] = await pool.query(
        'SELECT statement_no, type, party_name, status, balance FROM reconciliation_statements WHERE id = ? AND deleted_at IS NULL',
        [alloc.statementId],
      )
      if (!st) throw new AppError(`对账单 ${alloc.statementId} 不存在`, 404)
      if (Number(st.type) !== Number(type)) {
        throw new AppError(`${st.statement_no} 与本${label}类型不符`, 400, 'FINANCE_BACKFILL_NOT_APPLICABLE')
      }
      if (partyId == null && partyName != null && st.party_name !== partyName) {
        throw new AppError(
          `${st.statement_no} 属于「${st.party_name}」，与本单往来方「${partyName}」不一致`,
          400, 'FINANCE_BACKFILL_NOT_APPLICABLE',
        )
      }
      if (Number(st.status) === statementSvc.ST.DRAFT) {
        throw new AppError(`${st.statement_no} 还是草稿，请先确认后再申请补录核销`, 409, 'FINANCE_BACKFILL_NOT_APPLICABLE')
      }
      if (moneyUnits(st.balance) <= 0n) {
        throw new AppError(`${st.statement_no} 已核销完毕，无需再申请补录`, 400, 'FINANCE_BACKFILL_NOT_APPLICABLE')
      }
      if (moneyUnits(alloc.amount) > moneyUnits(st.balance)) {
        throw new AppError(
          `核销 ¥${Number(alloc.amount).toFixed(2)} 超出 ${st.statement_no} 未核销余额 ¥${Number(st.balance).toFixed(2)}`,
          400, 'FINANCE_BACKFILL_NOT_APPLICABLE',
        )
      }
      continue
    }
    const [[record]] = await pool.query(
      'SELECT order_no, type, party_name, status, confirm_status, balance FROM payment_records WHERE id = ?',
      [alloc.recordId],
    )
    if (!record) throw new AppError(`账款记录 ${alloc.recordId} 不存在`, 404)
    if (Number(record.type) !== Number(type)) {
      throw new AppError(`${record.order_no} 与本${label}类型不符`, 400, 'FINANCE_BACKFILL_NOT_APPLICABLE')
    }
    if (partyId == null && partyName != null && record.party_name !== partyName) {
      throw new AppError(
        `${record.order_no} 属于「${record.party_name}」，与本单往来方「${partyName}」不一致`,
        400, 'FINANCE_BACKFILL_NOT_APPLICABLE',
      )
    }
    if (Number(record.status) === 3) {
      throw new AppError(`${record.order_no} 已结清，无需再申请补录核销`, 400, 'FINANCE_BACKFILL_NOT_APPLICABLE')
    }
    if (Number(record.type) === 1 && Number(record.confirm_status) !== 1) {
      throw new AppError(`${record.order_no} 尚未财务确认，请先确认结算金额再申请补录`, 409, 'FINANCE_BACKFILL_NOT_APPLICABLE')
    }
    if (moneyUnits(alloc.amount) > moneyUnits(record.balance)) {
      throw new AppError(
        `${record.order_no} 核销 ¥${Number(alloc.amount).toFixed(2)} 超出其余额 ¥${Number(record.balance).toFixed(2)}`,
        400, 'FINANCE_BACKFILL_NOT_APPLICABLE',
      )
    }
  }
}

/**
 * 把一笔汇款分配核销到若干账款。调用方已开启事务并锁好 receipt 行。
 *
 * 加锁顺序：账款按 id 升序逐行 FOR UPDATE，与 payments.service.recordPayment 的单行锁
 * 共存时不会形成环路（见 docs/claude-md-archive-2026-09-04.md 第 11 节「加锁顺序统一」）。
 */
async function applyAllocations(conn, receipt, allocations, operator) {
  // 跨期闸门（2026-09-26 一致性审查 · 任务 7）由调用方在核销前完成：本函数被调用时，create 路径
  // 已持有 finance_accounts 锁，若在此处再取账套锁，就与直付路径（recordPayment：账套锁 → 账户锁）
  // 形成 ABBA 环。这里只做分配本身——补录留痕不在这里，申请单在执行入口就落了。
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

  let allocatedUnits = 0n
  const applied = []

  for (const alloc of sorted) {
    if (!Number.isFinite(alloc.amount) || alloc.amount <= 0) {
      throw new AppError('核销金额必须大于 0', 400)
    }
    const allocUnits = moneyUnits(alloc.amount)
    const [[record]] = await conn.query('SELECT * FROM payment_records WHERE id=? FOR UPDATE', [alloc.recordId])
    if (!record) throw new AppError(`账款记录 ${alloc.recordId} 不存在`, 404)
    if (Number(record.type) !== Number(receipt.type)) {
      throw new AppError(`${record.order_no} 与本${receipt.type === 1 ? '付款' : '收款'}单类型不符`, 400)
    }
    if (receipt.party_id == null && record.party_name !== receipt.party_name) {
      throw new AppError(`${record.order_no} 属于「${record.party_name}」，与本单往来方「${receipt.party_name}」不一致`, 400)
    }
    if (Number(record.status) === 3) {
      throw new AppError(`${record.order_no} 已结清，无需再核销`, 400)
    }
    // 应付确认闸门与单笔登记保持一致：未经财务确认的应付不允许出款
    if (Number(record.type) === 1 && Number(record.confirm_status) !== 1) {
      throw new AppError(`${record.order_no} 尚未财务确认，请先确认结算金额`, 409)
    }
    const recordBalance = moneyUnits(record.balance)
    if (allocUnits > recordBalance) {
      throw new AppError(`${record.order_no} 核销 ¥${alloc.amount.toFixed(2)} 超出其余额 ¥${moneyNumber(recordBalance).toFixed(2)}`, 400)
    }

    await assertAllocationParty(conn, record.id, receipt)
    const newPaid = moneyUnits(record.paid_amount) + allocUnits
    const newBalance = moneyUnits(record.total_amount) - newPaid
    const newStatus = newBalance <= 0n ? 3 : 2
    await conn.query(
      'UPDATE payment_records SET paid_amount=?,balance=?,status=? WHERE id=?',
      [moneyText(newPaid), moneyText(newBalance > 0n ? newBalance : 0n), newStatus, alloc.recordId],
    )
    await conn.query(
      `INSERT INTO payment_entries (record_id,receipt_id,statement_id,amount,payment_date,method,remark,operator_id,operator_name)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        alloc.recordId, receipt.id, alloc.statementId || null, moneyText(allocUnits), receipt.payment_date,
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
      payload: { receiptId: receipt.id, receiptNo: receipt.receipt_no, amount: alloc.amount, balanceAfter: moneyNumber(newBalance > 0n ? newBalance : 0n) },
    })

    allocatedUnits += allocUnits
    applied.push({ recordId: alloc.recordId, orderNo: record.order_no, amount: alloc.amount, settled: newStatus === 3 })
  }

  const newSettled = moneyUnits(receipt.settled_amount) + allocatedUnits
  if (newSettled > moneyUnits(receipt.amount)) {
    throw new AppError(
      `核销合计 ¥${moneyNumber(newSettled).toFixed(2)} 超出汇款金额 ¥${Number(receipt.amount).toFixed(2)}`,
      400,
    )
  }
  const newReceiptBalance = moneyUnits(receipt.amount) - newSettled
  await conn.query(
    'UPDATE payment_receipts SET settled_amount=?,balance=?,status=? WHERE id=?',
    [moneyText(newSettled), moneyText(newReceiptBalance), resolveReceiptStatus(moneyUnits(receipt.amount), newSettled), receipt.id],
  )

  // 账款动过之后重算对账单汇总（投影，不独立累加，避免两处漂移）。
  // touchedStatements 含显式核销的对账单与直核账款所属的对账单，两类的 statement 行都已在
  // 记录循环之前 FOR UPDATE 锁住，聚合重算不会与并发直付/核销相互丢失更新。
  for (const sid of touchedStatements) {
    await statementSvc.refreshSettlement(conn, sid)
  }

  return { allocatedTotal: moneyNumber(allocatedUnits), settledAmount: moneyNumber(newSettled), applied, receiptBalance: moneyNumber(newReceiptBalance) }
}

/**
 * 新建收付款单，并可同时核销若干账款（allocations 可为空 = 先挂账，之后再核销）。
 * 接 requestKey 幂等：核销直接改钱，连点两次或断网重试都不能重复扣。
 */
async function create({ type, partyId, partyName, amount, paymentDate, method, accountId, remark, allocations = [] }, operator, requestKey, { backfill = null, conn: sharedConn = null } = {}) {
  // 跨期补录的**申请**分支（2026-09-26 一致性审查 · 任务 7）：只落一张待审批申请单，业务数据
  // 一行不写。放在业务事务**之前**——申请单必须独立提交，业务回滚不能把它一起抹掉。
  if (backfill?.mode === 'apply') {
    // 没有资金账户就没有资金流水，也就没有凭证来源：批准执行后会留下一个永远补不出调整凭证的
    // 差异。路由层 accountId 是必填，这里是防御（旧客户端/重放数据）。
    if (!accountId) {
      throw new AppError(
        '本次登记没有指定资金账户，不会产生资金流水，跨期补录也就生成不了调整凭证。'
        + '请先选择资金账户再申请补录。',
        400, 'FINANCE_BACKFILL_NO_FUND_ACCOUNT',
      )
    }
    // 申请期的只读可执行性预检（新建单只有 allocations 有漂移风险：账款可能在审批期间被别人结清）
    if (allocations.length) await precheckAllocations(allocations, { type, partyId, partyName })
    const applied = await tryRecordBackfillApplication({
      businessDate: paymentDate,
      bizType: 'receipt',
      amount,
      reason: backfill.reason,
      requestKey,
      applicantId: backfill.applicantId,
      applicantName: backfill.applicantName,
      // 快照 = 批准后重放这次调用所需的入参（形状见 finance-backfills.replay）
      requestSnapshot: {
        kind: 'receipt',
        body: {
          type, partyId: partyId ?? null, partyName, amount, paymentDate,
          method: method || null, accountId: accountId || null, remark: remark || null, allocations,
        },
      },
      fingerprintPayload: {
        type, partyName, amount, paymentDate, method: method || null, accountId: accountId || null,
        allocations: allocations.map(a => ({
          recordId: a.recordId ?? null, statementId: a.statementId ?? null, amount: a.amount,
        })),
      },
    })
    if (applied) return { backfillApplication: applied }
  }

  // sharedConn：补录执行要在**一个事务**里做完「重放业务 + 回填申请单执行痕迹」，
  // 此时事务边界归调用方，本函数只是这条事务里的一段（详见 payments.service.recordPayment 同段注释）。
  const own = !sharedConn
  const conn = sharedConn || await pool.getConnection()
  try {
    if (own) await conn.beginTransaction()
    const reqState = await beginCreationOperationRequest(conn, {
      requestKey,
      action: 'payment.receipt.create',
      userId: operator.operatorId,
      payload: { type, partyId, partyName, amount, paymentDate, method, accountId, remark, allocations },
    })
    if (reqState.replay) {
      // 重放命中已成功的请求：直接返回原响应，绝不重复核销
      if (own) await conn.commit()
      return reqState.responseData ?? { replayed: true }
    }

    const total = moneyNumber(moneyUnits(amount))
    if (!Number.isFinite(total) || total <= 0) throw new AppError('汇款金额必须大于 0', 400)

    // 跨期闸门（2026-09-26 一致性审查 · 任务 7）：本单落库必写资金账户流水（accountId 必填），
    // 流水会生成 receipt_in / payment_out 凭证；业务日期落在已结账期间时凭证引擎会跳过它——
    // 钱进了账户、会计账上却没有。所以**无条件**过闸门，不按「本次是否核销」分叉：按
    // allocations.length 分叉会漏掉「只挂账不核销」（预收/预付）那一类，它同样写流水。
    // 业务日期取 paymentDate（钱实际发生的那天）而非今天——单子可能是上月建的、今天才提交，
    // 凭证仍按 paymentDate 落在上月。
    // 位置必须在下面 recordTransaction（取 finance_accounts 锁）之前：全局加锁顺序统一为
    // 「账套锁 → 账户锁 → 对账单锁 → 账款锁」，否则与直付路径（recordPayment 同序）成 ABBA 环。
    const periodState = await assertFinancePeriodOpen(conn, paymentDate, {
      bizLabel: '本次登记',
      backfill: backfill?.mode === 'execute' ? backfill : null,
    })

    // 补录执行必须有资金账户：没有账户就没有资金流水、没有凭证来源，执行完只会留下一个永远
    // 补不出调整凭证的差异。路由层 accountId 必填，这里是防御（旧单子/快照来自检查之前）。
    if (backfill?.mode === 'execute' && !accountId) {
      throw new AppError(
        '本次补录登记没有资金账户，不会产生资金流水与调整凭证，不能执行。请驳回后重新申请并选择资金账户。',
        409, 'FINANCE_BACKFILL_NO_FUND_ACCOUNT',
      )
    }

    const resolvedPartyId = await resolveReceiptParty(conn, { type, partyId, partyName, allocations })
    if (resolvedPartyId != null) {
      const table = Number(type) === 2 ? 'sale_customers' : 'supply_suppliers'
      const [[party]] = await conn.query(`SELECT name FROM ${table} WHERE id=?`, [resolvedPartyId])
      if (party) partyName = party.name
    }
    const prefix = Number(type) === 1 ? 'PY' : 'RC'
    const receiptNo = await generateDailyCode(conn, prefix, 'payment_receipts', 'receipt_no')
    const [r] = await conn.query(
      `INSERT INTO payment_receipts
         (receipt_no,type,party_name,amount,settled_amount,balance,status,payment_date,method,account_id,remark,operator_id,operator_name,party_id)
       VALUES (?,?,?,?,0,?,1,?,?,?,?,?,?,?)`,
      [receiptNo, Number(type), partyName, total, total, paymentDate, method || null, accountId || null,
       remark || null, operator.operatorId, operator.operatorName, resolvedPartyId],
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
        // 补录执行：资金流水仍按业务日期 happenedAt 记账（银行对账依据它，不能改成今天），
        // 只有凭证归属日期改用补录当期，并把申请单挂上供自动核对反查
        voucherDateOverride: periodState.voucherDateOverride,
        backfillId: backfill?.mode === 'execute' ? backfill.approvedId : null,
      }, operator)
    }
    const receipt = {
      id: r.insertId, receipt_no: receiptNo, type: Number(type), party_name: partyName, party_id: resolvedPartyId,
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
    if (own) await conn.commit()
    return data
  } catch (error) {
    if (own) await conn.rollback()
    throw error
  } finally {
    if (own) conn.release()
  }
}

/** 用某张收付款单的剩余余额继续核销（预收款后续冲抵订单走这里） */
async function settle(receiptId, { allocations = [] }, operator, requestKey, { backfill = null, conn: sharedConn = null } = {}) {
  if (!allocations.length) throw new AppError('请至少选择一笔账款进行核销', 400)
  // 跨期补录的**申请**分支（2026-09-26 一致性审查 · 任务 7）：只落待审批申请单，不进业务事务。
  // 金额是本次核销的合计（各分配额之和），不是整张单的余额。
  if (backfill?.mode === 'apply') {
    const [[target]] = await pool.query(
      'SELECT receipt_no, payment_date, type, party_id, party_name, amount, settled_amount, balance FROM payment_receipts WHERE id = ? AND deleted_at IS NULL',
      [receiptId],
    )
    if (!target) throw new AppError('收付款单不存在', 404)
    // 申请期的只读可执行性预检：这张单本身可能已被别人核销掉一部分，逐笔账款也可能已结清。
    // 两处都查——单子余额不够与某笔账款余额不够是两种不同的拒绝理由，合并成一句申请人看不懂。
    const allocTotalUnits = allocations.reduce((sum, a) => sum + moneyUnits(a.amount), 0n)
    if (allocTotalUnits > moneyUnits(target.balance)) {
      throw new AppError(
        `本次核销合计 ¥${moneyNumber(allocTotalUnits).toFixed(2)} 超出该单剩余可核销金额 ¥${Number(target.balance).toFixed(2)}`,
        400, 'FINANCE_BACKFILL_NOT_APPLICABLE',
      )
    }
    await precheckAllocations(allocations, {
      type: target.type, partyId: target.party_id, partyName: target.party_name,
    })
    const applied = await tryRecordBackfillApplication({
      businessDate: target.payment_date,
      bizType: 'receipt_settle',
      bizId: Number(receiptId),
      bizNo: target.receipt_no,
      amount: allocations.reduce((sum, a) => sum + Number(a.amount || 0), 0),
      reason: backfill.reason,
      requestKey,
      applicantId: backfill.applicantId,
      applicantName: backfill.applicantName,
      // 核销不产生资金流水，因此没有会计凭证要生成（凭证在收付款单登记时就已生成）——
      // 见 finance-backfills.service 的 NO_FUND_TXN_BIZ_TYPES。
      requestSnapshot: {
        kind: 'receipt_settle',
        receiptId: Number(receiptId),
        body: { allocations },
      },
      fingerprintPayload: {
        receiptId: Number(receiptId),
        allocations: allocations.map(a => ({
          recordId: a.recordId ?? null, statementId: a.statementId ?? null, amount: a.amount,
        })),
      },
    })
    if (applied) return { backfillApplication: applied }
  }

  // sharedConn：补录执行要在一个事务里做完「重放业务 + 回填申请单执行痕迹」（同 create）。
  const own = !sharedConn
  const conn = sharedConn || await pool.getConnection()
  try {
    if (own) await conn.beginTransaction()
    const reqState = await beginResourceOperationRequest(conn, {
      requestKey,
      action: 'payment.receipt.settle',
      userId: operator.operatorId,
      resourceType: 'payment_receipt',
      resourceId: receiptId,
    })
    if (reqState.replay) {
      // 重放命中已成功的请求：直接返回原响应，绝不重复核销
      if (own) await conn.commit()
      return reqState.responseData ?? { replayed: true }
    }

    // 跨期闸门（2026-09-26 一致性审查 · 任务 7）：业务日期取单子的 payment_date（钱实际发生的
    // 那天），不是今天。这里先用非锁读取日期，好让账套锁排在 receipt 行锁之前——与 create
    // 路径保持同一全局加锁顺序（账套锁 → 收付款单 → 对账单 → 账款），避免与直付路径成 ABBA 环。
    // 非锁读不会读到中途改动的值：payment_date 在单据建好之后没有更新入口。
    // 核销本身不写资金流水（钱在 create 时已进账户），所以这里只拦不留痕：已结账期间不该再改
    // 往来清账进度（会与已封存的账龄/对账口径不一致）。只有 mode='execute' 才把补录授权交给闸门。
    const [[dateRow]] = await conn.query(
      'SELECT payment_date FROM payment_receipts WHERE id=? AND deleted_at IS NULL',
      [receiptId],
    )
    if (!dateRow) throw new AppError('收付款单不存在', 404)
    await assertFinancePeriodOpen(conn, dateRow.payment_date, {
      bizLabel: '本次核销',
      backfill: backfill?.mode === 'execute' ? backfill : null,
    })

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
      settledAmount: result.settledAmount,
      balance: result.receiptBalance,
      applied: result.applied,
    }
    await completeOperationRequest(conn, reqState, { data, resourceType: 'payment_receipt', resourceId: Number(receiptId) })
    if (own) await conn.commit()
    return data
  } catch (error) {
    if (own) await conn.rollback()
    throw error
  } finally {
    if (own) conn.release()
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
