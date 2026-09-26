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
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')
const { assertFinancePeriodOpen, tryRecordBackfillApplication } = require('../accounting/finance-period.guard')

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

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, startDate = null, endDate = null, scopeWarehouseIds = null } = {}) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['ro.deleted_at IS NULL']
  const params = []
  if (keyword) { conds.push('(ro.refund_no LIKE ? OR ro.sale_order_no LIKE ? OR ro.customer_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  if (status) { conds.push('ro.status = ?'); params.push(Number(status)) }
  if (startDate) { conds.push('ro.created_at >= ?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('ro.created_at <= ?'); params.push(`${endDate} 23:59:59`) }
  // 限仓用户只能看到本仓销售单对应的退款单
  const scope = scopeFilter(scopeWarehouseIds, 'so.warehouse_id')
  if (scope.sql) { conds.push(scope.sql); params.push(...scope.params) }
  const where = conds.join(' AND ')
  const joins = 'LEFT JOIN sale_orders so ON so.id = ro.sale_order_id'
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM refund_orders ro ${joins} WHERE ${where}`, params)
  const [rows] = await pool.query(
    `SELECT ro.* FROM refund_orders ro ${joins} WHERE ${where} ORDER BY ro.created_at DESC, ro.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total: Number(total) } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query('SELECT * FROM refund_orders WHERE id = ? AND deleted_at IS NULL', [Number(id)])
  if (!row) throw new AppError('退款单不存在', 404)
  // 读路径越权防护：按关联销售单仓库校验（超管/不限仓放行）
  if (Array.isArray(scopeWarehouseIds)) {
    const [[sale]] = await pool.query('SELECT warehouse_id FROM sale_orders WHERE id = ?', [row.sale_order_id])
    assertInScope(scopeWarehouseIds, sale?.warehouse_id ?? null, '退款单')
  }
  return fmt(row)
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
  const amount = Number(d.amount)
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
      `SELECT so.id AS sale_order_id, so.order_no, so.warehouse_id, so.customer_name, pr.id AS payment_record_id, pr.paid_amount
         FROM sale_orders so
         LEFT JOIN payment_records pr ON pr.type = 2 AND pr.order_id = so.id
        WHERE ${cond} AND so.deleted_at IS NULL`,
      [condParam],
    )
    if (!sale) throw new AppError('关联销售单不存在', 404)
    // 跨仓校验：只允许给本仓销售单建退款
    assertInScope(scopeWarehouseIds, sale.warehouse_id, '销售单')
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
 * 锁单后按关联销售单仓库做范围校验（submit/execute/cancel 共用）。
 * 超管/不限仓（scopeWarehouseIds 非数组）直接放行。
 */
async function assertRefundInScope(conn, scopeWarehouseIds, refundId) {
  if (!Array.isArray(scopeWarehouseIds)) return
  const [[refund]] = await conn.query('SELECT sale_order_id FROM refund_orders WHERE id=?', [refundId])
  if (!refund?.sale_order_id) throw new AppError('退款单未关联销售单，无法校验仓库范围', 403, 'WAREHOUSE_SCOPE_DENIED')
  const [[sale]] = await conn.query('SELECT warehouse_id FROM sale_orders WHERE id=?', [refund.sale_order_id])
  assertInScope(scopeWarehouseIds, sale?.warehouse_id ?? null, '退款单')
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
async function execute(id, operator, scopeWarehouseIds = null, requestKey = null, { backfill = null, conn: sharedConn = null, expectedRefund = null } = {}) {
  // 跨期补录的**申请**分支（2026-09-26 一致性审查 · 任务 7）：只落待审批申请单，业务数据一行不写。
  // 放在业务事务**之前**——申请单必须独立提交，业务回滚不能把它一起抹掉。
  // 仓库范围与状态照常校验：申请的是「执行这笔退款」，越权的、状态不对的单子连申请都不该建。
  if (backfill?.mode === 'apply') {
    const [[target]] = await pool.query(
      'SELECT refund_no, refund_date, amount, account_id, status, payment_record_id, sale_order_no, customer_name'
      + ' FROM refund_orders WHERE id = ?',
      [id],
    )
    if (!target) throw new AppError('退款单不存在', 404)
    await assertRefundInScope(pool, scopeWarehouseIds, id)
    assertStatusAction('refundOrder', 'execute', target.status)
    // 没有退款账户就不写资金流水，也就没有凭证来源：批准执行后只会留下一个永远补不出凭证的
    // 差异。预先拒绝，让申请人先指定退款账户。
    if (!target.account_id) {
      throw new AppError(
        '这张退款单没有指定退款账户，不会产生资金流水，跨期补录也就生成不了调整凭证。'
        + '请先指定退款账户再申请补录。',
        400, 'FINANCE_BACKFILL_NO_FUND_ACCOUNT',
      )
    }
    // 申请期的**只读**可执行性预检：退款真正的约束是「退款额不能超过该账款此刻的已收金额」
    // （执行侧校验见下面 REFUND_EXCEED_PAID）。审批期间这笔收款可能又被别的退款冲掉一部分，
    // 那时执行会失败、停在「已批准 · 待执行」——所以这里只做尽力而为的预检，真正的兜底是
    // 作废/退回重提（finance-backfills.service.cancel），不是假装这里能保证。
    if (!target.payment_record_id) {
      throw new AppError(
        `退款单 ${target.refund_no} 未关联账款记录，无法执行退款，也不能申请补录`,
        400, 'FINANCE_BACKFILL_NOT_APPLICABLE',
      )
    }
    const [[linkedRecord]] = await pool.query(
      'SELECT order_no, paid_amount FROM payment_records WHERE id = ?',
      [target.payment_record_id],
    )
    if (!linkedRecord) {
      throw new AppError(`退款单 ${target.refund_no} 关联的账款记录已不存在，无法申请补录`, 409, 'FINANCE_BACKFILL_NOT_APPLICABLE')
    }
    if (Number(target.amount) > Number(linkedRecord.paid_amount) + 1e-6) {
      throw new AppError(
        `退款金额 ¥${Number(target.amount).toFixed(2)} 超过账款 ${linkedRecord.order_no} 当前已收金额 ¥${Number(linkedRecord.paid_amount).toFixed(2)}，无法申请补录`,
        409, 'FINANCE_BACKFILL_NOT_APPLICABLE',
      )
    }
    const applied = await tryRecordBackfillApplication({
      businessDate: target.refund_date || beijingTodayYmd(),
      bizType: 'refund',
      bizId: Number(id),
      bizNo: target.refund_no,
      amount: Number(target.amount),
      reason: backfill.reason,
      requestKey,
      applicantId: backfill.applicantId,
      applicantName: backfill.applicantName,
      // 快照 = 批准后重放这次调用所需的入参（形状见 finance-backfills.replay）。
      // warehouseIds 也要存：执行时以申请人的仓库范围重新校验，不能因为走了审批就跳过范围。
      //
      // body 存的是「审批人当时批的那笔退款长什么样」：出款账户、金额、退款日期、客户与原单。
      // 少了它，审批人只看得见一个退款单号，钱从哪个账户出去、退给谁全靠自己去别处翻；
      // 同时它也是执行时的核对基准（execute 的 FINANCE_BACKFILL_SOURCE_DRIFT），
      // 免得单据在申请之后被改动、批的和执行的却是两笔。
      requestSnapshot: {
        kind: 'refund',
        orderId: Number(id),
        warehouseIds: Array.isArray(scopeWarehouseIds) ? scopeWarehouseIds : null,
        body: {
          accountId: target.account_id != null ? Number(target.account_id) : null,
          amount: Number(target.amount),
          refundDate: ymdOf(target.refund_date),
          saleOrderNo: target.sale_order_no ?? null,
          customerName: target.customer_name ?? null,
        },
      },
      // 指纹不含日期：refund_date 由 DB 返回 Date 或字符串两种形态，掺进去会让同一次重放的
      // 指纹不稳定（误报「键被复用」）。金额与单据 id 已足以识别「这是不是同一笔业务」。
      fingerprintPayload: { refundOrderId: Number(id), amount: Number(target.amount) },
    })
    if (applied) return { backfillApplication: applied }
  }

  // sharedConn：补录执行要在一个事务里做完「重放业务 + 回填申请单执行痕迹」（同 recordPayment）。
  const own = !sharedConn
  const conn = sharedConn || await pool.getConnection()
  try {
    if (own) await conn.beginTransaction()
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
    const row = await lockStatusRow(conn, {
      table: 'refund_orders', id,
      columns: 'id, refund_no, sale_order_id, sale_order_no, customer_name, amount, status, payment_record_id, account_id, refund_date',
      entityName: '退款单',
    })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    const rule = assertStatusAction('refundOrder', 'execute', row.status)

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

    const amount = Number(row.amount)
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
    const paid = Number(record.paid_amount)
    if (amount > paid + 1e-6) {
      throw new AppError(`退款金额 ¥${amount.toFixed(2)} 超过该账款已收金额 ¥${paid.toFixed(2)}，无法退款`, 409, 'REFUND_EXCEED_PAID')
    }

    // 冲减已收：paid_amount 减回，balance 增大，status 重算
    const newPaid = Number((paid - amount).toFixed(4))
    const newBalance = Number((Number(record.total_amount) - newPaid).toFixed(4))
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
      await statementSvc.refreshSettlement(conn, s.statement_id)
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
