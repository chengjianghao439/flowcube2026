const { cashCents, storedCashCents, cashNumber } = require('../../utils/cashMoney')
/**
 * 已收款退货退款单（P2-6）：专用红冲退款链路。
 *
 * 背景：销售退货在「已登记收款 > 退货冲减后账款总额」时被 returns.helpers 的负余额
 * 守卫硬拦截（提示「请先处理退款」），此前系统没有退款功能，已收款的退货直接卡死。
 * 本模块提供退款单：把多收的钱退还给客户，退款完成后退货链路即可通过。
 *
 * 状态机（documentStatusRules.refundOrder）：1草稿 → 2已确认 → 3已完成 / 4已取消。
 *
 * 执行退款语义（execute，事务内）：
 *   1. 锁退款单 + 锁关联 payment_records（FOR UPDATE）
 *   2. 校验退款金额 ≤ 已收金额（paid_amount）
 *   3. paid_amount -= 退款额，balance += 退款额，重算 status
 *   4. 写负向 payment_entries（退款留痕，与收款登记对称）
 *   5. 资金账户 OUT（BIZ_TYPE.REFUND）——钱出去与单据状态同生共死（同报销付款）
 *   6. 退款单 → 已完成
 * 幂等：执行走 compareAndSetStatus（2→3），重复执行 409。
 *
 * 负余额口径：退款金额上限是「已收金额」，不是账款总额——把已收的多退部分退回即可，
 * 不允许把尚未收到的钱也退掉（那会造成账款倒挂）。
 */

const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { getRequestId } = require('../../utils/requestContext')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('../payments/payment-events.service')
const statementSvc = require('../payments/reconciliation-statements.service')
const accountSvc = require('../finance/finance-accounts.service')
const { normalizePagination } = require('../../utils/pagination')
const { saleDocumentScopeFilter, assertSaleDocumentInScope } = require('../../utils/saleDocumentScope')
const { assertFinancePeriodOpen, recordBackfillApplication, APPLICATION_NO_SQL } = require('../accounting/finance-period.guard')
const { lockAccountingCompanyShared } = require('../accounting/accounting.period-lock')

const STATUS = { 1: '草稿', 2: '已确认', 3: '已完成', 4: '已取消' }
const genNo = conn => generateDailyCode(conn, 'RF', 'refund_orders', 'refund_no')

/**
 * 日期归一成 'YYYY-MM-DD'。
 * mysql2 读回的 DATE 是 Date（进 JSON 会变成带时区的 ISO 串），同字段在不同驱动/配置下
 * 也可能是字符串——快照要跨「申请」与「批准执行」两次请求做等值核对，两边形态必须一致。
 */
function ymdOf(v) {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 10)
  return beijingTodayYmd(new Date(v))
}

const fmt = r => ({
  id: r.id,
  refundNo: r.refund_no,
  saleOrderId: r.sale_order_id,
  saleOrderNo: r.sale_order_no,
  customerName: r.customer_name,
  amount: Number(r.amount),
  status: r.status,
  statusName: STATUS[r.status] || '未知',
  paymentRecordId: r.payment_record_id,
  accountId: r.account_id,
  refundDate: r.refund_date,
  remark: r.remark,
  operatorId: r.operator_id,
  operatorName: r.operator_name,
  confirmedByName: r.confirmed_by_name,
  confirmedAt: r.confirmed_at,
  refundedAt: r.refunded_at,
  createdAt: r.created_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '', saleOrderNo = '', status = null, startDate = null, endDate = null, scopeWarehouseIds = null } = {}) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['ro.deleted_at IS NULL']
  const params = []
  if (keyword) { conds.push('(ro.refund_no LIKE ? OR ro.sale_order_no LIKE ? OR ro.customer_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  if (saleOrderNo) { conds.push('ro.sale_order_no = ?'); params.push(saleOrderNo) }
  if (status) { conds.push('ro.status = ?'); params.push(Number(status)) }
  if (startDate) { conds.push('ro.created_at >= ?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('ro.created_at <= ?'); params.push(`${endDate} 23:59:59`) }
  // 列表与COUNT均先核关联SO头仓及全部保存明细仓，再分页。
  const scope = saleDocumentScopeFilter(scopeWarehouseIds, 'ro.sale_order_id')
  params.push(...scope.params)
  const where = conds.join(' AND ') + scope.sql
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM refund_orders ro WHERE ${where}`, params)
  const [rows] = await pool.query(
    `SELECT ro.* FROM refund_orders ro WHERE ${where} ORDER BY ro.created_at DESC, ro.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total: Number(total) } }
}

async function readRefund(db, id, scopeWarehouseIds, trace) {
  const [[row]] = await db.query('SELECT * FROM refund_orders WHERE id = ? AND deleted_at IS NULL', [Number(id)])
  if (!row) throw new AppError('退款单不存在', 404)
  await assertSaleDocumentInScope(db, scopeWarehouseIds, row.sale_order_id, { entityName: '退款单' })
  const data = fmt(row)
  if (!trace) return data
  const [warehouses] = await db.query(
    `SELECT warehouse_id FROM sale_orders WHERE id=?
     UNION SELECT COALESCE(i.warehouse_id, s.warehouse_id) FROM sale_order_items i
       JOIN sale_orders s ON s.id=i.order_id WHERE i.order_id=?`, [row.sale_order_id, row.sale_order_id],
  )
  const [funds] = await db.query(
    'SELECT id,amount,account_id,direction,biz_no,happened_at,voucher_date_override,backfill_id FROM finance_account_transactions WHERE biz_type=? AND biz_id=? ORDER BY id',
    [accountSvc.BIZ_TYPE.REFUND, id],
  )
  const matching = funds.filter(fund => Number(fund.direction) === accountSvc.DIRECTION.OUT && fund.biz_no === row.refund_no
    && Number(fund.account_id) === Number(row.account_id))
  const effectiveDate = ymdOf(row.refund_date) || beijingTodayYmd()
  const businessPeriod = effectiveDate.replaceAll('-', '').slice(0, 6)
  const [[period]] = await db.query('SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [businessPeriod])
  return { ...data, trace: {
    warehouseIds: warehouses.map(item => Number(item.warehouse_id)),
    effectiveDate, businessPeriod, periodClosed: Number(period?.status) === 2,
    outgoing: matching.map(fund => Number(fund.amount)), fundConflict: matching.length !== funds.length,
    fundTransactions: matching.map(fund => ({
      id: Number(fund.id), businessDate: ymdOf(fund.happened_at),
      postingDate: ymdOf(fund.voucher_date_override || fund.happened_at),
      backfillId: fund.backfill_id == null ? null : Number(fund.backfill_id),
    })),
  } }
}

async function findById(id, scopeWarehouseIds = null, { trace = false } = {}) {
  if (!trace) return readRefund(pool, id, scopeWarehouseIds, false)
  const conn = await pool.getConnection()
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const result = await readRefund(conn, id, scopeWarehouseIds, true)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/**
 * 新建退款单（草稿）。
 * @param {object} d - { saleOrderId?, saleOrderNo?, amount, accountId, refundDate, remark }
 *   saleOrderId 与 saleOrderNo 二选一（前端弱关联输入单号，后端按单号反查）。
 * 金额校验：≤ 该销售单已收金额（paid_amount，FOR UPDATE 读，避免并发下超退）。
 */
async function create(d, operator, scopeWarehouseIds = null) {
  const saleOrderId = Number(d.saleOrderId)
  const saleOrderNo = String(d.saleOrderNo ?? '').trim()
  const amount = cashNumber(cashCents(d.amount, { label: '实际退款金额' }))
  if (!(Number.isInteger(saleOrderId) && saleOrderId > 0) && !saleOrderNo) {
    throw new AppError('请选择关联销售单', 400)
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('退款金额必须大于 0', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 反查销售单并取账款已收金额（payment_records 无 deleted_at）。有 id 用 id，否则按单号
    const cond = Number.isInteger(saleOrderId) && saleOrderId > 0 ? 'so.id = ?' : 'so.order_no = ?'
    const condParam = Number.isInteger(saleOrderId) && saleOrderId > 0 ? saleOrderId : saleOrderNo
    const [[sale]] = await conn.query(
      `SELECT so.id AS sale_order_id, so.order_no, so.warehouse_id, so.customer_name, pr.id AS payment_record_id, pr.total_amount, pr.paid_amount, pr.balance
         FROM sale_orders so
         LEFT JOIN payment_records pr ON pr.type = 2 AND pr.order_id = so.id
        WHERE ${cond} AND so.deleted_at IS NULL`,
      [condParam],
    )
    if (!sale) throw new AppError('关联销售单不存在', 404)
    await assertSaleDocumentInScope(conn, scopeWarehouseIds, sale.sale_order_id, { entityName: '退款单', currentRead: true })
    if (sale.payment_record_id) for (const field of ['total_amount', 'paid_amount', 'balance']) storedCashCents(sale[field], `原账款${field}`)
    const paid = Number(sale.paid_amount || 0)
    if (amount > paid + 1e-6) {
      throw new AppError(`退款金额 ¥${amount.toFixed(2)} 超过该销售单已收金额 ¥${paid.toFixed(2)}`, 400, 'REFUND_EXCEED_PAID')
    }

    const refundNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO refund_orders
         (refund_no, sale_order_id, sale_order_no, customer_name, amount, status,
          payment_record_id, account_id, refund_date, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [refundNo, sale.sale_order_id, sale.order_no, sale.customer_name, amount,
       sale.payment_record_id || null, d.accountId || null, d.refundDate || null, d.remark || null,
       operator?.userId || null, operator?.realName || operator?.username || null],
    )
    await conn.commit()
    return { id: r.insertId, refundNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 锁单后按关联销售单头仓及全部保存明细仓做范围校验。
 * 超管/不限仓（scopeWarehouseIds 非数组）直接放行。
 */
async function assertRefundInScope(conn, scopeWarehouseIds, refundId) {
  if (!Array.isArray(scopeWarehouseIds)) return
  const [[refund]] = await conn.query('SELECT sale_order_id FROM refund_orders WHERE id=?', [refundId])
  if (!refund?.sale_order_id) throw new AppError('退款单未关联销售单，无法校验仓库范围', 403, 'WAREHOUSE_SCOPE_DENIED')
  await assertSaleDocumentInScope(conn, scopeWarehouseIds, refund.sale_order_id, { entityName: '退款单', currentRead: conn !== pool })
}

/** 确认退款：草稿 → 已确认（财务认可金额后进入可执行态） */
async function submit(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'refund_orders', id, columns: 'id, status', entityName: '退款单' })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    const rule = assertStatusAction('refundOrder', 'submit', row.status)
    await compareAndSetStatus(conn, { table: 'refund_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '退款单' })
    await conn.query(
      'UPDATE refund_orders SET confirmed_by=?, confirmed_by_name=?, confirmed_at=NOW() WHERE id=?',
      [operator?.userId || null, operator?.realName || operator?.username || null, id],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 执行退款：已确认 → 已完成。事务内做四件事（同生共死）：
 *   锁账款 → 校验 → 冲减已收 → 写退款流水 + 账户出账 → 状态推进。
 */
const REFUND_EXECUTION_COLUMNS = 'id, refund_no, sale_order_id, sale_order_no, customer_name, amount, status, payment_record_id, account_id, refund_date'

function assertRefundPreviewIdentity(row, expected) {
  if (expected && (row.refund_no !== expected.refundNo || row.sale_order_no !== expected.saleOrderNo
    || Number(row.sale_order_id) !== expected.saleOrderId || Number(row.payment_record_id) !== expected.paymentRecordId
    || Number(row.account_id) !== expected.accountId || (ymdOf(row.refund_date) || beijingTodayYmd()) !== expected.effectiveDate
    || storedCashCents(row.amount) !== BigInt(expected.amountCents))) throw refundPreviewConflict()
}

async function assertNoActiveBackfill(conn, refundId) {
  // 只做一致性读。审批及执行先锁申请行再锁退款单，不能反过来等待申请行锁。
  const [[active]] = await conn.query(
    "SELECT id FROM finance_period_backfills WHERE company_id=1 AND biz_type='refund' AND biz_id=? AND status IN (0,1) LIMIT 1",
    [refundId],
  )
  if (active) throw new AppError('原退款单已有补录申请，请财务核对并续办原申请', 409, 'FINANCE_BACKFILL_ALREADY_ACTIVE')
}

async function queueRefundBackfill(id, scopeWarehouseIds, requestKey, backfill, expectedPreview) {
  await assertRefundInScope(pool, scopeWarehouseIds, id)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'refund_orders', id, columns: REFUND_EXECUTION_COLUMNS, entityName: '退款单',
    })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    if (requestKey) {
      const [[previous]] = await conn.query(
        `SELECT id, biz_id, biz_no, applicant_id, period, business_date, reason, ${APPLICATION_NO_SQL} AS application_no
           FROM finance_period_backfills WHERE company_id=1 AND biz_type='refund' AND request_key=?`,
        [requestKey],
      )
      if (previous) {
        if (Number(previous.biz_id) !== Number(id) || previous.biz_no !== row.refund_no
          || Number(previous.applicant_id) !== Number(backfill.applicantId) || expectedPreview && previous.reason !== backfill.reason) {
          throw new AppError('请求键与原退款补录不符，请核对原任务', 409, 'FINANCE_BACKFILL_REQUEST_KEY_REUSED')
        }
        await conn.commit()
        return { id: Number(previous.id), applicationNo: previous.application_no, period: previous.period,
          businessDate: ymdOf(previous.business_date), reused: true }
      }
    }
    await assertNoActiveBackfill(conn, id)
    assertStatusAction('refundOrder', 'execute', row.status)
    assertRefundPreviewIdentity(row, expectedPreview)
    const businessDate = ymdOf(row.refund_date) || beijingTodayYmd()
    const period = businessDate.replaceAll('-', '').slice(0, 6)
    await lockAccountingCompanyShared(conn, 1)
    const [[periodRow]] = await conn.query('SELECT status FROM acct_periods WHERE company_id=1 AND period=? FOR SHARE', [period])
    if (Number(periodRow?.status) !== 2) {
      if (expectedPreview) throw new AppError('原退款业务期间已开放，请核对原单后重新选择办理方式', 409, 'FINANCE_BACKFILL_PERIOD_OPEN')
      await conn.commit()
      return null
    }
    if (!row.account_id) {
      throw new AppError('请先在原退款单指定出账账户再申请补录', 400, 'FINANCE_BACKFILL_NO_FUND_ACCOUNT')
    }
    const stmtRows = expectedPreview?.statement ? [{ statement_id: expectedPreview.statement.id }] : []
    if (stmtRows.length) {
      await conn.query('SELECT id FROM reconciliation_statements WHERE id=? FOR SHARE', [stmtRows[0].statement_id])
    }
    const [[record]] = await conn.query(
      'SELECT order_id,order_no,type,status,total_amount,paid_amount,balance FROM payment_records WHERE id=? FOR SHARE',
      [row.payment_record_id],
    )
    if (!record || record.order_no !== row.sale_order_no) {
      throw new AppError('原退款未能核实所关联的账款，无法申请补录', 409, 'FINANCE_BACKFILL_NOT_APPLICABLE')
    }
    if (storedCashCents(row.amount, '原退款金额') > storedCashCents(record.paid_amount, '原账款已收金额')) {
      throw new AppError('退款金额超过原账款当前已收金额，无法申请补录', 409, 'FINANCE_BACKFILL_NOT_APPLICABLE')
    }
    if (expectedPreview) await assertRefundPreviewLedger(conn, record, stmtRows, expectedPreview)
    const applied = await recordBackfillApplication(conn, {
      period, businessDate, bizType: 'refund', bizId: Number(id), bizNo: row.refund_no, amount: Number(row.amount),
      reason: backfill.reason, requestKey, applicantId: backfill.applicantId, applicantName: backfill.applicantName,
      requestSnapshot: {
        kind: 'refund', orderId: Number(id), warehouseIds: scopeWarehouseIds,
        body: {
          accountId: Number(row.account_id), amount: Number(row.amount), refundDate: ymdOf(row.refund_date),
          saleOrderNo: row.sale_order_no, customerName: row.customer_name ?? null,
        },
        ...(expectedPreview ? { expectedPreview } : {}),
      },
      fingerprintPayload: { refundOrderId: Number(id), amount: Number(row.amount) },
    })
    await conn.commit()
    return { ...applied, period, businessDate }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function execute(id, operator, scopeWarehouseIds = null, requestKey = null, { backfill = null, conn: sharedConn = null, expectedRefund = null, expectedPreview = null } = {}) {
  if (expectedPreview && !requestKey) throw new AppError('退款预览须使用原请求键', 400)
  if (backfill?.mode === 'apply') {
    const applied = await queueRefundBackfill(id, scopeWarehouseIds, requestKey, backfill, expectedPreview)
    if (applied) return { backfillApplication: applied }
  }

  // sharedConn：补录执行要在一个事务里做完「重放业务 + 回填申请单执行痕迹」（同 recordPayment）。
  const own = !sharedConn
  const conn = sharedConn || await pool.getConnection()
  try {
    if (own) await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'refund_orders', id,
      columns: REFUND_EXECUTION_COLUMNS,
      entityName: '退款单',
    })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    // 幂等（2026-08-22 补）：执行退款是多表写事务（冲账+流水+账户出账），连点两次/断网重试会重复退钱
    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      action: 'refund.execute',
      userId: operator?.userId ?? null,
      resourceType: 'refund_order',
      resourceId: id,
    })
    if (requestState.replay) {
      if (own) await conn.rollback()
      return requestState.responseData
    }
    const rule = assertStatusAction('refundOrder', 'execute', row.status)
    if (backfill?.mode !== 'execute') await assertNoActiveBackfill(conn, id)
    assertRefundPreviewIdentity(row, expectedPreview)

    // 补录执行：核对「审批人当时批的那笔」就是「现在要执行的这笔」。
    // 退款单本身没有编辑接口，正常流程改不动它；但 DB 直改、以后新增的编辑功能、或别的模块
    // 写这张表，都会让单据在申请与批准之间变样。那时按现行值执行，等于执行了一笔审批人
    // 从未见过的退款（钱去了另一个账户、金额也可能不同）。核对不一致就停在这里：申请单
    // 留在「已批准 · 待执行」，由人作废后按新情况重新申请，绝不静默照现行值执行。
    if (backfill?.mode === 'execute') {
      if (!expectedRefund) {
        throw new AppError(
          '这张补录申请没有留下退款的关键信息（旧版申请单），无法确认要执行的正是当初批准的那笔。'
          + '请作废这张申请单后按新情况重新申请。',
          409, 'FINANCE_BACKFILL_SOURCE_DRIFT',
        )
      }
      const wasAccount = expectedRefund.accountId != null ? Number(expectedRefund.accountId) : null
      const nowAccount = row.account_id != null ? Number(row.account_id) : null
      const wasDate = ymdOf(expectedRefund.refundDate)
      const nowDate = ymdOf(row.refund_date)
      const drift = []
      if (Number(row.amount) !== Number(expectedRefund.amount)) {
        drift.push(`金额 ¥${Number(expectedRefund.amount).toFixed(2)} → ¥${Number(row.amount).toFixed(2)}`)
      }
      if (nowAccount !== wasAccount) {
        drift.push(`退款账户 #${wasAccount ?? '未指定'} → #${nowAccount ?? '未指定'}`)
      }
      if (nowDate !== wasDate) {
        drift.push(`退款日期 ${wasDate ?? '未填'} → ${nowDate ?? '未填'}`)
      }
      if ((row.sale_order_no ?? null) !== (expectedRefund.saleOrderNo ?? null)) {
        drift.push(`原销售单 ${expectedRefund.saleOrderNo ?? '无'} → ${row.sale_order_no ?? '无'}`)
      }
      if ((row.customer_name ?? null) !== (expectedRefund.customerName ?? null)) {
        drift.push(`客户 ${expectedRefund.customerName ?? '无'} → ${row.customer_name ?? '无'}`)
      }
      if (drift.length) {
        throw new AppError(
          `退款单 ${row.refund_no} 在申请之后已被改动（${drift.join('；')}），这笔补录不能按现在的内容执行。`
          + '请作废这张申请单，按改动后的实际情况重新申请。',
          409, 'FINANCE_BACKFILL_SOURCE_DRIFT',
        )
      }
    }

    const amountCents = storedCashCents(row.amount, '原退款金额')
    const amount = cashNumber(amountCents)
    // 跨期闸门（2026-09-26 一致性审查 · 任务 7）：业务日期取退款单的 refund_date（钱实际出账
    // 的那天），未填则按今天。位置必须在下面 finance_accounts 锁之前——全局加锁顺序统一为
    // 「业务单据 → 账套锁 → 账户锁 → 对账单锁 → 账款锁」，凭证生成路径也以账套行为最外层锁。
    const bizDate = row.refund_date || beijingTodayYmd()
    // 补录执行必须有退款账户：没有账户就没有资金流水、没有凭证来源，执行完只会留下一个永远
    // 补不出调整凭证的差异（同 payment / receipt 的处理）。
    if (backfill?.mode === 'execute' && !row.account_id) {
      throw new AppError(
        '这张补录退款的退款单没有指定账户，不会产生资金流水与调整凭证，不能执行。'
        + '请驳回后重新申请并先指定退款账户。',
        409, 'FINANCE_BACKFILL_NO_FUND_ACCOUNT',
      )
    }
    // 只有 mode='execute'（执行已批准的补录）才把补录授权交给闸门；申请模式（'apply'）若期间真的
    // 已结账，早在上面就返回申请单了，走到这里说明期间未结账，闸门按未结账放行即可。
    const periodState = await assertFinancePeriodOpen(conn, bizDate, {
      bizLabel: `退款单 ${row.refund_no} 的出账`,
      backfill: backfill?.mode === 'execute' ? backfill : null,
    })

    // 锁账款记录（FOR UPDATE），校验可退金额
    if (!row.payment_record_id) {
      // 无关联账款（期初/手工）：只允许已收金额为 0 的特殊场景——实际不放行，退款必须有账款基准
      throw new AppError('该退款单未关联账款记录，无法执行退款', 400)
    }
    // 统一加锁顺序（2026-09-18 审计 P1）：finance_accounts → reconciliation_statements → payment_records。
    // 本函数原先先锁 payment_records，再经 recordTransaction 锁 finance_accounts、最后锁
    // reconciliation_statements，方向与核销/直付路径（payments.service.js:208-225、
    // payment-receipts.service.js:130-133 明文约定「账户 → 对账单 → 账款」）相反，
    // 同一条账款并发「退款 execute」与「收款登记」会形成 record↔statement/account 的 ABBA 环。
    // 这里把两把前置锁提到 record 之前；后面的 recordTransaction 对同一账户行是同事务重入，无副作用。
    if (row.account_id) {
      await conn.query('SELECT id FROM finance_accounts WHERE id=? FOR UPDATE', [row.account_id])
    }
    if (expectedPreview) {
      const [funds] = await conn.query(
        'SELECT id FROM finance_account_transactions WHERE biz_type=? AND biz_id=? FOR SHARE', [accountSvc.BIZ_TYPE.REFUND, id],
      )
      if (funds.length) throw refundPreviewConflict()
    }
    const [stmtRows] = await conn.query(
      'SELECT DISTINCT statement_id FROM reconciliation_statement_items WHERE record_id = ? ORDER BY statement_id',
      [row.payment_record_id],
    )
    for (const s of stmtRows) {
      await conn.query('SELECT id FROM reconciliation_statements WHERE id=? FOR UPDATE', [s.statement_id])
    }

    const [[record]] = await conn.query(
      'SELECT * FROM payment_records WHERE id = ? FOR UPDATE', [row.payment_record_id],
    )
    if (!record) throw new AppError('关联账款记录不存在，无法执行退款', 404)
    for (const field of ['total_amount', 'paid_amount', 'balance']) storedCashCents(record[field], `原账款${field}`)
    if (expectedPreview) await assertRefundPreviewLedger(conn, record, stmtRows, expectedPreview)
    const paid = Number(record.paid_amount)
    if (amount > paid + 1e-6) {
      throw new AppError(`退款金额 ¥${amount.toFixed(2)} 超过该账款已收金额 ¥${paid.toFixed(2)}，无法退款`, 409, 'REFUND_EXCEED_PAID')
    }

    // 冲减已收：paid_amount 减回，balance 增大，status 重算
    const newPaidCents = storedCashCents(record.paid_amount) - amountCents
    const newPaid = cashNumber(newPaidCents)
    const newBalance = cashNumber(storedCashCents(record.total_amount) - newPaidCents)
    const newStatus = newBalance <= 1e-6 ? 3 : newPaid > 0 ? 2 : 1
    await conn.query(
      'UPDATE payment_records SET paid_amount=?, balance=?, status=? WHERE id=?',
      [newPaid, Math.max(0, newBalance), newStatus, row.payment_record_id],
    )

    // 负向 payment_entries 留痕（退款金额为负，与收款登记对称可对账）
    await conn.query(
      `INSERT INTO payment_entries (record_id, amount, payment_date, method, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.payment_record_id, -amount, bizDate, 'refund',
       `退货退款 ${row.refund_no}`, operator?.userId || null, operator?.realName || operator?.username || null],
    )

    // 资金账户出账（退款）：钱出去与单据状态同生共死
    if (row.account_id) {
      await accountSvc.recordTransaction(conn, {
        accountId: row.account_id,
        direction: accountSvc.DIRECTION.OUT,
        amount,
        bizType: accountSvc.BIZ_TYPE.REFUND,
        bizId: Number(id),
        bizNo: row.refund_no,
        partyName: row.customer_name,
        happenedAt: bizDate,
        remark: `退货退款 ${row.refund_no}（销售单 ${row.sale_order_no}）`,
        // 补录执行：资金流水仍按业务日期 happenedAt 记账（银行对账依据它，不能改成今天），
        // 只有凭证归属日期改用补录当期，并把申请单挂上供自动核对反查
        voucherDateOverride: periodState.voucherDateOverride,
        backfillId: backfill?.mode === 'execute' ? backfill.approvedId : null,
      }, { operatorId: operator?.userId, operatorName: operator?.realName || operator?.username })
    }

    // 对账单投影刷新（2026-08-21 审计 E.3 修复）：退款冲减 paid_amount 后，
    // 若该账款属于某对账单，同事务刷新 settled_amount/状态——否则 unlock 用
    // 过期存储列误拒（已核销完的账款退款后永远无法解锁回草稿）。
    // 对账单行已在函数开头按统一加锁顺序锁住，这里只做聚合重算。
    for (const s of stmtRows) {
      await statementSvc.refreshSettlement(conn, s.statement_id, { cashOnly: true })
    }

    await recordPaymentEvent(conn, {
      paymentRecordId: Number(row.payment_record_id),
      orderNo: record.order_no,
      eventType: PAYMENT_EVENT.REFUND,
      title: '退货退款',
      description: `退款单 ${row.refund_no} 已退 ¥${amount.toFixed(2)}，已收 ¥${paid.toFixed(2)} → ¥${newPaid.toFixed(2)}`,
      operatorId: operator?.userId,
      operatorName: operator?.realName || operator?.username,
      requestId: getRequestId(),
      payload: { refundId: Number(id), refundNo: row.refund_no, amount, paidBefore: paid, paidAfter: newPaid },
    })

    await compareAndSetStatus(conn, { table: 'refund_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '退款单' })
    await conn.query('UPDATE refund_orders SET refunded_at=NOW() WHERE id=?', [id])

    await completeOperationRequest(conn, requestState, {
      data: { id: Number(id), refundNo: row.refund_no, amount },
      message: '退款完成',
      resourceType: 'refund_order',
      resourceId: Number(id),
    })
    if (own) await conn.commit()
    return { id: Number(id), refundNo: row.refund_no, amount }
  } catch (e) {
    if (own) await conn.rollback()
    throw e
  } finally {
    if (own) conn.release()
  }
}

function refundPreviewConflict() {
  return new AppError('原退款单、应收或对账单已变化，请重新核对', 409, 'REFUND_PREVIEW_CONFLICT')
}

async function assertRefundPreviewLedger(conn, record, stmtRows, preview) {
  const status = preview.balanceCents === 0 ? 3 : preview.paidCents > 0 ? 2 : 1
  if (Number(record.type) !== 2 || Number(record.order_id) !== preview.saleOrderId || record.order_no !== preview.saleOrderNo
    || Number(record.status) !== status || preview.totalCents !== preview.paidCents + preview.balanceCents
    || storedCashCents(record.total_amount) !== BigInt(preview.totalCents)
    || storedCashCents(record.paid_amount) !== BigInt(preview.paidCents)
    || storedCashCents(record.balance) !== BigInt(preview.balanceCents)) throw refundPreviewConflict()
  const [memberships] = await conn.query(
    'SELECT statement_id FROM reconciliation_statement_items WHERE record_id=? FOR SHARE', [preview.paymentRecordId],
  )
  const expected = preview.statement
  if (memberships.length !== (expected ? 1 : 0)) throw refundPreviewConflict()
  if (!expected) return
  if (Number(memberships[0].statement_id) !== expected.id || !stmtRows.some(row => Number(row.statement_id) === expected.id)) {
    throw refundPreviewConflict()
  }
  const [[statement]] = await conn.query(
    'SELECT statement_no,type,total_amount,settled_amount,balance,status FROM reconciliation_statements WHERE id=? AND deleted_at IS NULL FOR SHARE',
    [expected.id],
  )
  if (!statement || Number(statement.type) !== 2 || statement.statement_no !== expected.no || Number(statement.status) !== expected.status
    || storedCashCents(statement.total_amount) !== BigInt(expected.totalCents)
    || storedCashCents(statement.settled_amount) !== BigInt(expected.paidCents)
    || storedCashCents(statement.balance) !== BigInt(expected.balanceCents)) throw refundPreviewConflict()
}

/** 取消：草稿/已确认 → 已取消 */
async function cancel(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'refund_orders', id, columns: 'id, status', entityName: '退款单' })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    const rule = assertStatusAction('refundOrder', 'cancel', row.status)
    await compareAndSetStatus(conn, { table: 'refund_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '退款单' })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { findAll, findById, create, submit, execute, cancel }
