const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { generateDailyCode, generateMasterCode } = require('../../utils/codeGenerator')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertNotSelfApproval } = require('../../utils/selfApprove')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { assertFinancePeriodOpen, tryRecordBackfillApplication } = require('../accounting/finance-period.guard')
const accountSvc = require('./finance-accounts.service')

/**
 * 日常费用报销。
 *
 * 流程：草稿 → 提交 → 审批（一级）→ 付款（从资金账户出账，写账户流水）。
 * 状态流转一律走 assertStatusAction + compareAndSetStatus，与采购/销售等单据同一套机制。
 *
 * 边界：**报销不进 payment_records**——那是对供应商/客户的往来账款，报销是内部经营费用，
 * 混在一起会污染应付应收口径。两者只在 finance_account_transactions 层汇合。
 */

const STATUS = { DRAFT: 1, PENDING: 2, APPROVED: 3, PAID: 4, REJECTED: 5, CANCELLED: 6 }
const STATUS_NAME = { 1: '草稿', 2: '待审批', 3: '已批准', 4: '已付款', 5: '已驳回', 6: '已取消' }
const STATUS_TONE = { 1: 'draft', 2: 'warning', 3: 'active', 4: 'success', 5: 'danger', 6: 'draft' }

function fmtClaim(row) {
  return {
    id: Number(row.id),
    claimNo: row.claim_no,
    title: row.title,
    applicantId: Number(row.applicant_id),
    applicantName: row.applicant_name,
    totalAmount: Number(row.total_amount),
    status: Number(row.status),
    statusName: STATUS_NAME[Number(row.status)],
    statusTone: STATUS_TONE[Number(row.status)],
    itemCount: row.item_count != null ? Number(row.item_count) : undefined,
    submittedAt: row.submitted_at,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    rejectReason: row.reject_reason,
    paidAccountId: row.paid_account_id != null ? Number(row.paid_account_id) : null,
    paidAccountName: row.paid_account_name || null,
    paidAt: row.paid_at,
    paidByName: row.paid_by_name,
    remark: row.remark,
    createdAt: row.created_at,
  }
}

/** 明细金额之和写回单头。明细变动后调用，调用方已在事务内。 */
async function refreshTotal(conn, claimId) {
  const [[agg]] = await conn.query(
    'SELECT COALESCE(SUM(amount),0) AS total FROM expense_claim_items WHERE claim_id=?', [claimId],
  )
  await conn.query('UPDATE expense_claims SET total_amount=? WHERE id=?', [Number(agg.total), claimId])
  return Number(agg.total)
}

/** 明细整体替换（草稿态才允许，由调用方先校验状态） */
async function replaceItems(conn, claimId, items) {
  await conn.query('DELETE FROM expense_claim_items WHERE claim_id=?', [claimId])
  for (const it of items) {
    const amount = Number(it.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('明细金额必须大于 0', 400)
    const [[cat]] = await conn.query(
      'SELECT id,name FROM expense_categories WHERE id=? AND deleted_at IS NULL', [Number(it.categoryId)],
    )
    if (!cat) throw new AppError(`费用类别 ${it.categoryId} 不存在`, 404)
    await conn.query(
      `INSERT INTO expense_claim_items (claim_id,category_id,category_name,amount,happened_at,description)
       VALUES (?,?,?,?,?,?)`,
      [claimId, cat.id, cat.name, amount, it.happenedAt, it.description || null],
    )
  }
  return refreshTotal(conn, claimId)
}

async function create({ title, items = [], remark }, operator) {
  if (!items.length) throw new AppError('请至少填写一条费用明细', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const claimNo = await generateDailyCode(conn, 'EX', 'expense_claims', 'claim_no')
    const [r] = await conn.query(
      `INSERT INTO expense_claims (claim_no,title,applicant_id,applicant_name,status,remark)
       VALUES (?,?,?,?,1,?)`,
      [claimNo, title || null, operator.operatorId, operator.operatorName, remark || null],
    )
    const total = await replaceItems(conn, r.insertId, items)
    await conn.commit()
    return { id: r.insertId, claimNo, totalAmount: total }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function update(id, { title, items, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'expense_claims', id, columns: 'id, status, applicant_id', entityName: '费用报销单' })
    // 归属校验与 withdraw/cancel 一致：仅申请人本人（或超管）可编辑，避免持 UPDATE 权限者改他人草稿
    if (Number(operator?.roleId) !== 1 && Number(row.applicant_id) !== Number(operator?.operatorId)) {
      throw new AppError('只能编辑本人提交的报销单', 403)
    }
    assertStatusAction('expenseClaim', 'edit', row.status)
    await conn.query('UPDATE expense_claims SET title=?,remark=? WHERE id=?', [title || null, remark || null, id])
    if (Array.isArray(items)) {
      if (!items.length) throw new AppError('请至少填写一条费用明细', 400)
      await replaceItems(conn, id, items)
    }
    await conn.commit()
    return { id: Number(id) }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 状态推进的公共骨架：锁行 → 校验动作合法 → CAS 改状态 → 附加写入 */
async function transition(id, action, extraSql = null, extraParams = []) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'expense_claims', id, columns: 'id, claim_no, status, total_amount, applicant_id', entityName: '费用报销单',
    })
    const rule = assertStatusAction('expenseClaim', action, row.status)
    await compareAndSetStatus(conn, {
      table: 'expense_claims', id, fromStatus: rule.from, toStatus: rule.to, entityName: '费用报销单',
    })
    if (extraSql) await conn.query(extraSql, [...extraParams, id])
    await conn.commit()
    return { id: Number(id), status: rule.to, claimNo: row.claim_no, totalAmount: Number(row.total_amount) }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

async function submit(id, operator) {
  await assertClaimOwner(id, operator) // 仅本人（或超管）可提交，与 withdraw/cancel 一致
  const [[row]] = await pool.query('SELECT total_amount FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  if (Number(row.total_amount) <= 0) throw new AppError('报销金额为 0，请先填写费用明细', 400)
  return transition(id, 'submit', 'UPDATE expense_claims SET submitted_at=NOW() WHERE id=?')
}

// 撤回/取消都只允许申请人本人（或超管）操作——withdraw 注释写明「本人撤回」，但此前 controller
// 未传 operator、service 也未校验，任何持 FINANCE_EXPENSE_CREATE 的人都能撤/取消别人的单。
async function assertClaimOwner(id, operator) {
  const [[row]] = await pool.query('SELECT applicant_id FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  if (Number(operator?.roleId) === 1) return
  if (Number(row.applicant_id) !== Number(operator?.operatorId)) {
    throw new AppError('只能撤回/取消本人提交的报销单', 403)
  }
}

async function withdraw(id, operator) {
  await assertClaimOwner(id, operator)
  return transition(id, 'withdraw', 'UPDATE expense_claims SET submitted_at=NULL WHERE id=?')
}

/**
 * 审批通过。**审批人默认不能是申请人本人**——一级审批只有这一道内控，
 * 少了它等于自己批自己的报销。豁免按用户授予（sys_users.allow_self_approve，见 utils/selfApprove）。
 */
async function approve(id, operator) {
  const [[row]] = await pool.query('SELECT applicant_id, applicant_name FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  await assertNotSelfApproval(row.applicant_id, operator.operatorId, '不能审批自己提交的报销单，请由他人审批')
  return transition(id, 'approve',
    'UPDATE expense_claims SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=NULL WHERE id=?',
    [operator.operatorId, operator.operatorName])
}

async function reject(id, { reason }, operator) {
  const [[row]] = await pool.query('SELECT applicant_id FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  await assertNotSelfApproval(row.applicant_id, operator.operatorId, '不能驳回自己提交的报销单')
  if (!String(reason || '').trim()) throw new AppError('请填写驳回原因', 400)
  return transition(id, 'reject',
    'UPDATE expense_claims SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=? WHERE id=?',
    [operator.operatorId, operator.operatorName, String(reason).trim()])
}

async function cancel(id, operator) {
  await assertClaimOwner(id, operator)
  return transition(id, 'cancel')
}

/**
 * 付款：从指定资金账户出账，同事务写账户流水。
 * 钱出去和单据状态必须同生共死，不能只改状态不动账。
 *
 * 与收付款/退款三个入口同范式（2026-09-26 一致性审查 · 任务 7 收口）：
 *   · 业务日期落在已结账期间时，这里是三条资金入口里唯一**没有闸门**的——报销出账会写
 *     finance_account_transactions，凭证引擎对已结账期间是跳过的，钱动了会计账上却没有。
 *   · 因此同样接 **跨期补录**（先审批、后动账）与**请求键幂等**：补录执行是按 request_snapshot
 *     重放这次调用，请求键就是这笔操作的永久身份，漏了它重放会被当成一笔新的付款再付一次。
 */
async function pay(id, { accountId, happenedAt, remark }, operator, requestKey = null, { backfill = null, conn: sharedConn = null } = {}) {
  const bizDate = happenedAt || beijingTodayYmd()

  // 跨期补录的**申请**分支：只落一张待审批申请单，业务一行不写、钱不动。放在业务事务之前——
  // 申请单必须独立提交，否则「业务没写成」会把申请单一起回滚，出纳拿着单号而库里没有这张单。
  if (backfill?.mode === 'apply') {
    // 没有资金账户就不会写账户流水，也就没有凭证来源：批准执行后只会留下一个永远补不出
    // 调整凭证的差异。预先拒绝，让申请人先选账户。
    if (!accountId) {
      throw new AppError(
        '这次报销付款没有指定资金账户，不会产生资金流水，跨期补录也就生成不了调整凭证。'
        + '请先选择付款账户再申请补录。',
        400, 'FINANCE_BACKFILL_NO_FUND_ACCOUNT',
      )
    }
    // 申请期的**只读**可执行性预检：审批是异步的，若申请时不看，一张明摆着付不成的单子
    // （状态不是已批准、金额为 0）也会走完审批、停在「已批准 · 待执行」，还得人工作废。
    // 这里不加锁、不做承诺，权威判定在执行期（下面带行锁的三处校验）。
    const [[target]] = await pool.query(
      'SELECT claim_no, status, total_amount FROM expense_claims WHERE id = ? AND deleted_at IS NULL',
      [Number(id)],
    )
    if (!target) throw new AppError('费用报销单不存在', 404)
    assertStatusAction('expenseClaim', 'pay', target.status)
    const preAmount = Number(target.total_amount)
    if (preAmount <= 0) throw new AppError('报销金额为 0，无需付款', 400)

    const applied = await tryRecordBackfillApplication({
      businessDate: bizDate,
      bizType: 'expense_pay',
      bizId: Number(id),
      bizNo: target.claim_no,
      amount: preAmount,
      reason: backfill.reason,
      requestKey,
      applicantId: backfill.applicantId,
      applicantName: backfill.applicantName,
      // 快照 = 批准后重放这次调用所需的入参（形状见 finance-backfills.replay 的约定），
      // 同时也是审批人在补录审批页上核对的依据：钱从哪个账户出、业务日期是哪天。
      requestSnapshot: {
        kind: 'expense_pay',
        claimId: Number(id),
        body: { accountId: Number(accountId), happenedAt: bizDate, remark: remark || null },
      },
      // 指纹只覆盖影响金额与资金去向的字段：同一个请求键的载荷变了要报「键被复用」，
      // 而不是静默按旧单执行。
      fingerprintPayload: { claimId: Number(id), amount: preAmount, accountId: Number(accountId) },
    })
    if (applied) return { backfillApplication: applied }
  }

  // 补录执行（finance-backfills.execute）要在**一个事务**里做完「重放业务 + 回填申请单执行
  // 痕迹」，连接由调用方传入，事务的开/提交/回滚与释放都归它。
  const own = !sharedConn
  const conn = sharedConn || await pool.getConnection()
  try {
    if (own) await conn.beginTransaction()

    // 幂等：付款是改钱，连点两次/断网重试不能重复出账。资源级 action 绑本单据 id
    // （expense.pay.<id>），与收付款/退款同范式；缺请求键时 begin 返回 enabled:false 直接放行。
    const reqState = await beginResourceOperationRequest(conn, {
      requestKey, action: 'expense.pay', userId: operator.operatorId ?? null,
      resourceType: 'expense_claim', resourceId: Number(id),
    })
    if (reqState.replay) {
      if (own) await conn.commit()
      return reqState.responseData ?? { replayed: true }
    }

    // 跨期闸门：业务日期落在已结账期间时默认 409（凭证引擎会跳过已结账期间，钱动了账上却没有）。
    // 放在业务行锁**之前**，理由与 payments.recordPayment 一致：期间已封就不必再锁单据/账户，
    // 也不占着别人的锁等待；更重要的是让加锁顺序保持「账套（闸门内持锁）→ 账户」，
    // 与 recordTransaction 内部「先锁账户行再重算余额」的正范式同向，不会形成反向环。
    // 只有 mode='execute'（执行已批准的补录）才把授权交给闸门，由它放行并给出凭证归属日期。
    const periodState = await assertFinancePeriodOpen(conn, bizDate, {
      bizLabel: '本次报销付款',
      backfill: backfill?.mode === 'execute' ? backfill : null,
    })

    const row = await lockStatusRow(conn, {
      table: 'expense_claims', id, columns: 'id, claim_no, status, total_amount, applicant_name', entityName: '费用报销单',
    })
    const rule = assertStatusAction('expenseClaim', 'pay', row.status)
    const amount = Number(row.total_amount)
    if (amount <= 0) throw new AppError('报销金额为 0，无需付款', 400)

    // 账户行锁：闸门已持账套锁，这里补上「账户」这一环，顺序即账套→账户。
    // 后面的 recordTransaction 对同一账户行是同事务重入。
    await conn.query('SELECT id FROM finance_accounts WHERE id=? FOR UPDATE', [Number(accountId)])

    await compareAndSetStatus(conn, {
      table: 'expense_claims', id, fromStatus: rule.from, toStatus: rule.to, entityName: '费用报销单',
    })
    await conn.query(
      'UPDATE expense_claims SET paid_account_id=?,paid_at=NOW(),paid_by_name=? WHERE id=?',
      [Number(accountId), operator.operatorName, id],
    )
    await accountSvc.recordTransaction(conn, {
      accountId: Number(accountId),
      direction: accountSvc.DIRECTION.OUT,
      amount,
      bizType: accountSvc.BIZ_TYPE.EXPENSE,
      bizId: Number(id),
      bizNo: row.claim_no,
      partyName: row.applicant_name,
      // 资金流水仍按业务日期记（银行对账依据它，补录不能把它改成今天）；
      // 只有凭证归属日期改用补录当期，并把申请单挂上供自动核对反查。
      happenedAt: bizDate,
      remark: remark || `费用报销 ${row.claim_no}`,
      voucherDateOverride: periodState.voucherDateOverride,
      backfillId: backfill?.mode === 'execute' ? backfill.approvedId : null,
    }, operator)
    const result = { id: Number(id), status: rule.to, amount }
    await completeOperationRequest(conn, reqState, {
      data: result, message: '付款完成，已记入账户流水',
      resourceType: 'expense_claim', resourceId: Number(id),
    })
    if (own) await conn.commit()
    return result
  } catch (error) {
    if (own) await conn.rollback()
    throw error
  } finally {
    if (own) conn.release()
  }
}

async function findAll({ page = 1, pageSize = 20, status = '', keyword = '', applicantId = '', startDate = '', endDate = '', minAmount = '', maxAmount = '' } = {}) {
  const p = Number(page) || 1
  const ps = Number(pageSize) || 20
  const conds = ['c.deleted_at IS NULL']
  const params = []
  if (status) { conds.push('c.status=?'); params.push(Number(status)) }
  if (applicantId) { conds.push('c.applicant_id=?'); params.push(Number(applicantId)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(c.claim_no LIKE ? OR c.title LIKE ? OR c.applicant_name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`) }
  if (startDate) { conds.push('c.created_at>=?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('c.created_at<DATE_ADD(?, INTERVAL 1 DAY)'); params.push(endDate) }
  if (minAmount !== '' && minAmount != null) { conds.push('c.total_amount>=?'); params.push(Number(minAmount)) }
  if (maxAmount !== '' && maxAmount != null) { conds.push('c.total_amount<=?'); params.push(Number(maxAmount)) }
  const where = `WHERE ${conds.join(' AND ')}`

  const [rows] = await pool.query(
    `SELECT c.*, a.name AS paid_account_name,
            (SELECT COUNT(*) FROM expense_claim_items i WHERE i.claim_id = c.id) AS item_count
       FROM expense_claims c
       LEFT JOIN finance_accounts a ON a.id = c.paid_account_id
       ${where}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM expense_claims c ${where}`, params)
  const [[summary]] = await pool.query(
    `SELECT COALESCE(SUM(c.total_amount),0) AS totalAmount,
            COALESCE(SUM(CASE WHEN c.status=2 THEN c.total_amount ELSE 0 END),0) AS pendingAmount,
            COALESCE(SUM(CASE WHEN c.status=4 THEN c.total_amount ELSE 0 END),0) AS paidAmount
       FROM expense_claims c ${where}`,
    params,
  )
  return {
    list: rows.map(fmtClaim),
    summary: {
      totalAmount: Number(summary.totalAmount),
      pendingAmount: Number(summary.pendingAmount),
      paidAmount: Number(summary.paidAmount),
    },
    pagination: { page: p, pageSize: ps, total },
  }
}

async function findById(id, { applicantId = null, allowAll = false } = {}) {
  const [[row]] = await pool.query(
    `SELECT c.*, a.name AS paid_account_name FROM expense_claims c
       LEFT JOIN finance_accounts a ON a.id = c.paid_account_id
      WHERE c.id=? AND c.deleted_at IS NULL`, [id],
  )
  if (!row) throw new AppError('费用报销单不存在', 404)
  // 越权读防护（对齐列表的 canViewAll/applicantId 口径）：非查看全部者只能读自己的单
  if (!allowAll && applicantId != null && Number(row.applicant_id) !== Number(applicantId)) {
    throw new AppError('无权查看他人的费用报销单', 403, 'EXPENSE_VIEW_DENIED')
  }
  const [items] = await pool.query(
    'SELECT * FROM expense_claim_items WHERE claim_id=? ORDER BY happened_at ASC, id ASC', [id],
  )
  return {
    ...fmtClaim(row),
    items: items.map(i => ({
      id: Number(i.id),
      categoryId: Number(i.category_id),
      categoryName: i.category_name,
      amount: Number(i.amount),
      happenedAt: i.happened_at,
      description: i.description,
    })),
  }
}

// ── 费用类别字典 ──────────────────────────────────────────────────────────────

async function listCategories({ activeOnly = false } = {}) {
  const conds = ['deleted_at IS NULL']
  if (activeOnly) conds.push('is_active=1')
  const [rows] = await pool.query(
    `SELECT * FROM expense_categories WHERE ${conds.join(' AND ')} ORDER BY sort_order ASC, id ASC`,
  )
  return rows.map(r => ({
    id: Number(r.id), code: r.code, name: r.name,
    isActive: !!r.is_active, sortOrder: Number(r.sort_order), remark: r.remark,
  }))
}

async function createCategory({ name, sortOrder = 0, remark }) {
  const code = await generateMasterCode(pool, 'EC', 'expense_categories')
  const [r] = await pool.query(
    'INSERT INTO expense_categories (code,name,sort_order,remark) VALUES (?,?,?,?)',
    [code, String(name).trim(), Number(sortOrder) || 0, remark || null],
  )
  return { id: r.insertId, code }
}

async function updateCategory(id, { name, isActive, sortOrder, remark }) {
  const [r] = await pool.query(
    'UPDATE expense_categories SET name=?,is_active=?,sort_order=?,remark=? WHERE id=? AND deleted_at IS NULL',
    [String(name).trim(), isActive ? 1 : 0, Number(sortOrder) || 0, remark || null, id],
  )
  if (!r.affectedRows) throw new AppError('费用类别不存在', 404)
  return { id: Number(id) }
}

/** 用过的类别不删除，只停用——删了历史报销单的类别名快照还在，但统计会断 */
async function deleteCategory(id) {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM expense_claim_items WHERE category_id=?', [id])
  if (Number(n) > 0) throw new AppError('该类别已被报销单使用，不能删除；请改为停用', 409)
  const [r] = await pool.query('UPDATE expense_categories SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id])
  if (!r.affectedRows) throw new AppError('费用类别不存在', 404)
  return { id: Number(id) }
}

module.exports = {
  STATUS, STATUS_NAME,
  create, update, submit, withdraw, approve, reject, pay, cancel, findAll, findById,
  listCategories, createCategory, updateCategory, deleteCategory,
}
