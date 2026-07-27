const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode, generateMasterCode } = require('../../utils/codeGenerator')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
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

async function update(id, { title, items, remark }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'expense_claims', id, columns: 'id, status', entityName: '费用报销单' })
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

async function submit(id) {
  const [[row]] = await pool.query('SELECT total_amount FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  if (Number(row.total_amount) <= 0) throw new AppError('报销金额为 0，请先填写费用明细', 400)
  return transition(id, 'submit', 'UPDATE expense_claims SET submitted_at=NOW() WHERE id=?')
}

async function withdraw(id) { return transition(id, 'withdraw', 'UPDATE expense_claims SET submitted_at=NULL WHERE id=?') }

/**
 * 审批通过。**审批人不能是申请人本人**——一级审批只有这一道内控，
 * 少了它等于自己批自己的报销。
 */
async function approve(id, operator) {
  const [[row]] = await pool.query('SELECT applicant_id, applicant_name FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  if (Number(row.applicant_id) === Number(operator.operatorId)) {
    throw new AppError('不能审批自己提交的报销单，请由他人审批', 403)
  }
  return transition(id, 'approve',
    'UPDATE expense_claims SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=NULL WHERE id=?',
    [operator.operatorId, operator.operatorName])
}

async function reject(id, { reason }, operator) {
  const [[row]] = await pool.query('SELECT applicant_id FROM expense_claims WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('费用报销单不存在', 404)
  if (Number(row.applicant_id) === Number(operator.operatorId)) {
    throw new AppError('不能驳回自己提交的报销单', 403)
  }
  if (!String(reason || '').trim()) throw new AppError('请填写驳回原因', 400)
  return transition(id, 'reject',
    'UPDATE expense_claims SET approved_by=?,approved_by_name=?,approved_at=NOW(),reject_reason=? WHERE id=?',
    [operator.operatorId, operator.operatorName, String(reason).trim()])
}

async function cancel(id) { return transition(id, 'cancel') }

/**
 * 付款：从指定资金账户出账，同事务写账户流水。
 * 钱出去和单据状态必须同生共死，不能只改状态不动账。
 */
async function pay(id, { accountId, happenedAt, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'expense_claims', id, columns: 'id, claim_no, status, total_amount, applicant_name', entityName: '费用报销单',
    })
    const rule = assertStatusAction('expenseClaim', 'pay', row.status)
    const amount = Number(row.total_amount)
    if (amount <= 0) throw new AppError('报销金额为 0，无需付款', 400)

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
      happenedAt: happenedAt || new Date().toISOString().slice(0, 10),
      remark: remark || `费用报销 ${row.claim_no}`,
    }, operator)
    await conn.commit()
    return { id: Number(id), status: rule.to, amount }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
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
  if (startDate) { conds.push('DATE(c.created_at)>=?'); params.push(startDate) }
  if (endDate) { conds.push('DATE(c.created_at)<=?'); params.push(endDate) }
  if (minAmount !== '' && minAmount != null) { conds.push('c.total_amount>=?'); params.push(Number(minAmount)) }
  if (maxAmount !== '' && maxAmount != null) { conds.push('c.total_amount<=?'); params.push(Number(maxAmount)) }
  const where = `WHERE ${conds.join(' AND ')}`

  const [rows] = await pool.query(
    `SELECT c.*, a.name AS paid_account_name,
            (SELECT COUNT(*) FROM expense_claim_items i WHERE i.claim_id = c.id) AS item_count
       FROM expense_claims c
       LEFT JOIN finance_accounts a ON a.id = c.paid_account_id
       ${where}
      ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
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

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT c.*, a.name AS paid_account_name FROM expense_claims c
       LEFT JOIN finance_accounts a ON a.id = c.paid_account_id
      WHERE c.id=? AND c.deleted_at IS NULL`, [id],
  )
  if (!row) throw new AppError('费用报销单不存在', 404)
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
