const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { getCustomerCreditUsed } = require('../../utils/creditExposure')
const { getNetOrderAmount } = require('../sale/sale.contracts')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { compareAndSetStatus } = require('../../utils/statusTransition')
const { normalizePagination } = require('../../utils/pagination')
const approvalEngine = require('../../engine/approvalEngine')
const actions = require('./credit-overrides.actions')
const policy = require('./credit-overrides.policy')
const validity = require('./credit-overrides.validity')
const { saleDocumentScopeFilter, assertSaleDocumentInScope } = require('../../utils/saleDocumentScope')

/**
 * 超额放行审批单（文档 05 Phase 2）：销售员发起「申请—审批」两步。
 *
 * 场景：客户额度不足必须发起放行申请；任何身份都不能直接放行，
 * 走多级审批流（biz_type='sale_credit_override'），审批通过后该销售单占库自动放行。
 *
 * 状态机：1草稿 → 2待审批 → 3已批准 / 4已驳回 / 5已取消（2/3 由审批流引擎实例驱动）。
 * 纯单据：不改钱、不改库存、不改销售单状态；唯一的业务副作用在「占库放行」时发生（sale.service 读本表）。
 */

const STATUS = { DRAFT: 1, PENDING: 2, APPROVED: 3, REJECTED: 4, CANCELLED: 5 }
const STATUS_NAME = { 1: '草稿', 2: '待审批', 3: '已批准', 4: '已驳回', 5: '已取消' }
const STATUS_TONE = { 1: 'draft', 2: 'warning', 3: 'success', 4: 'danger', 5: 'draft' }

function fmt(row) {
  return {
    id: Number(row.id),
    overrideNo: row.override_no,
    saleOrderId: Number(row.sale_order_id),
    saleOrderNo: row.sale_order_no,
    customerId: Number(row.customer_id),
    customerName: row.customer_name,
    creditLimit: Number(row.credit_limit),
    usedCredit: Number(row.used_credit),
    thisAmount: Number(row.this_amount),
    overAmount: Number(row.over_amount),
    reason: row.reason,
    applicantId: Number(row.applicant_id),
    applicantName: row.applicant_name,
    status: Number(row.status),
    statusName: STATUS_NAME[Number(row.status)],
    statusTone: STATUS_TONE[Number(row.status)],
    rejectReason: row.reject_reason,
    createdAt: row.created_at,
  }
}

/**
 * 发起申请（草稿态）：校验销售单存在、额度确实不足，快照额度/已用/本单/超量。
 * 一张销售单不允许重复发起未结束的申请（活跃唯一性）。
 */
async function create({ saleOrderId, reason, expiresAt }, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[order]] = await conn.query(
      'SELECT * FROM sale_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [Number(saleOrderId)],
    )
    if (!order) throw new AppError('销售单不存在', 404)
    await assertSaleDocumentInScope(conn, scopeWarehouseIds, order.id, { entityName: '放行申请单', currentRead: true })
    const [[customer]] = await conn.query('SELECT name,credit_limit FROM sale_customers WHERE id=? AND deleted_at IS NULL FOR UPDATE', [Number(order.customer_id)])
    if (!customer) throw new AppError('客户不存在', 404)
    if (![1,2,3,6].includes(Number(order.status))) throw new AppError('当前销售单不可申请授信', 409)
    if (customer.credit_limit == null) throw new AppError('该客户未设置授信额度，无需超额放行申请', 400)

    const active = await validity.activeForOrder(conn,saleOrderId)
    const inProgress = active.find(r=>[1,2].includes(Number(r.status)))
    if (inProgress) throw new AppError(`该销售单已有${Number(inProgress.status)===1?'草稿':'待审批'}申请 ${inProgress.override_no}，请先查看或处理该申请`,409,'CREDIT_OVERRIDE_DUPLICATE')

    // 快照信用口径（占库校验同款：未清应收 + 在途敞口）。本单尚为草稿(1)不占用信用。
    const used = await getCustomerCreditUsed(conn, Number(order.customer_id), { excludeSaleOrderId: order.id })
    const thisAmount = getNetOrderAmount(order.total_amount, order.discount_amount)
    const limit = Number(customer.credit_limit)
    const overAmount = Math.max(0, Math.round((used + thisAmount - limit) * 100) / 100)
    if (overAmount <= 0) {
      throw new AppError('该销售单当前未超授信额度，无需放行申请', 400)
    }
    const basisHash = await policy.orderBasis(conn,order)
    const current = {order,basisHash,customerId:order.customer_id,creditLimit:limit,thisAmount,overAmount}
    if (active.some(r=>Number(r.status)===3 && validity.evaluate(r,current).valid)) {
      throw new AppError('该销售单已有有效批准，请按原批准继续操作，无需重复申请',409,'CREDIT_OVERRIDE_DUPLICATE')
    }

    const overrideNo = await generateDailyCode(conn, 'CO', 'sale_credit_overrides', 'override_no')
    const [r] = await conn.query(
      `INSERT INTO sale_credit_overrides
        (override_no, sale_order_id, sale_order_no, customer_id, customer_name, credit_limit, used_credit, this_amount, over_amount, reason, applicant_id, applicant_name, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [overrideNo, order.id, order.order_no, Number(order.customer_id), customer.name, limit, used, thisAmount, overAmount,
        String(reason || '').trim() || null, Number(operator.operatorId), operator.operatorName],
    )
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw new AppError('有效截止时间必须在将来',400)
    await conn.query('INSERT INTO sale_credit_approval_proofs (override_id,sale_order_id,basis_hash,expires_at) VALUES (?,?,?,?)', [r.insertId,order.id,basisHash,expiresAt ? new Date(expiresAt) : null])
    await conn.commit()
    return { id: r.insertId, overrideNo, overAmount }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 提交审批：草稿 → 待审批，同事务建审批流实例（引擎）。 */
async function submit(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const {row, order} = await actions.lockRequest(conn,id)
    const actor = await policy.loadActor(conn,operator.userId ?? operator.operatorId,true)
    await assertSaleDocumentInScope(conn,actor.warehouseIds,order.id,{currentRead:true})
    await assertOwner(row, actor)
    await actions.assertBasis(conn,order,row)
    const rule = assertStatusAction('creditOverride', 'submit', row.status)
    await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })

    const inst = await approvalEngine.startApproval(conn, {
      bizType: 'sale_credit_override',
      bizId: id,
      amount: Number(row.over_amount),
      applicantId: Number(row.applicant_id),
      applicantName: row.applicant_name,
    })
    if (!inst) throw new AppError('未匹配授信放行审批流程，请联系管理员配置后重新提交', 409, 'CREDIT_APPROVAL_FLOW_REQUIRED')
    await conn.commit()
    return { id: Number(id), status: rule.to, overrideNo: row.override_no, multiLevel: !!inst, instanceId: inst?.instanceId ?? null }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function approve(id, operator, intent) { return actions.act(id, 'approve', intent, operator) }
async function reject(id, intent, operator) { return actions.act(id, 'reject', intent, operator) }

/** 取消：草稿/待审批/已批准/已驳回 → 已取消；有进行中审批实例一并撤销。 */
async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const {row,order} = await actions.lockRequest(conn,id)
    const actor = await policy.loadActor(conn,operator.userId ?? operator.operatorId,true)
    await assertSaleDocumentInScope(conn,actor.warehouseIds,order.id,{currentRead:true})
    await assertOwner(row, actor)
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: id, currentRead: true })
    if (active) await approvalEngine.cancelInstance(conn, { instanceId: active.instance.id, operator })
    const rule = assertStatusAction('creditOverride', 'cancel', row.status)
    await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })
    await conn.commit()
    return { id: Number(id), status: rule.to }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function assertOwner(row, operator) {
  if (Number(operator?.roleId) === 1) return
  if (Number(row.applicant_id) !== Number(operator?.userId ?? operator?.operatorId)) throw new AppError('只能操作本人发起的放行申请', 403)
}

async function findAll({ page = 1, pageSize = 20, status = '', keyword = '', saleOrderId = '', startDate = '', endDate = '', scopeWarehouseIds = null, actorId = null } = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['c.deleted_at IS NULL']
  const params = []
  if (status) { conds.push('c.status=?'); params.push(Number(status)) }
  if (saleOrderId) { conds.push('c.sale_order_id=?'); params.push(Number(saleOrderId)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(c.override_no LIKE ? OR c.sale_order_no LIKE ? OR c.customer_name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`) }
  if (startDate) { conds.push('c.created_at >= ?'); params.push(`${String(startDate).slice(0, 10)} 00:00:00`) }
  if (endDate) { conds.push('c.created_at <= ?'); params.push(`${String(endDate).slice(0, 10)} 23:59:59`) }
  const scope = saleDocumentScopeFilter(scopeWarehouseIds, 'c.sale_order_id')
  params.push(...scope.params)
  const where = `WHERE ${conds.join(' AND ')}${scope.sql}`
  const [rows] = await pool.query(
    `SELECT * FROM sale_credit_overrides c ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_credit_overrides c ${where}`, params)
  return { list: await validity.decorate(pool,await actions.decorate(pool, rows.map(fmt), actorId)), pagination: { page: p, pageSize: ps, total } }
}

async function findById(id, scopeWarehouseIds = null, actorId = null) {
  const [[row]] = await pool.query('SELECT * FROM sale_credit_overrides WHERE id=? AND deleted_at IS NULL', [Number(id)])
  if (!row) throw new AppError('放行申请单不存在', 404)
  await assertSaleDocumentInScope(pool, scopeWarehouseIds, row.sale_order_id, { entityName: '放行申请单' })
  const [detail] = await validity.decorate(pool,await actions.decorate(pool, [fmt(row)], actorId))
  const conn = await pool.getConnection()
  try {
    const got = await approvalEngine.getLatestInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: Number(id) })
    if (got) {
      detail.approval = {
        instanceId: Number(got.instance.id),
        status: Number(got.instance.status),
        currentStep: Number(got.instance.current_step),
        rejectReason: got.instance.reject_reason,
        finishedAt: got.instance.finished_at,
        tasks: got.tasks.map(t => ({
          stepOrder: Number(t.step_order),
          status: Number(t.status),
          approverName: t.approver_name,
          comment: t.comment,
          actionAt: t.action_at,
        })),
      }
    }
  } finally { conn.release() }
  return detail
}

/** 供 sale.service 占库放行判断：已批准申请的客户、额度和金额快照仍覆盖当前超额敞口。 */
async function hasApprovedOverride(saleOrderId, current = {}) {
  const db = current.conn || pool
  const row = await validity.latestApproved(db,saleOrderId)
  if (!row) return null
  const order = current.order
  if (!order || ![1,2,3,6].includes(Number(order.status)) || Number(order.id)!==Number(saleOrderId)) return null
  const basisHash = await policy.orderBasis(db,order)
  const state = validity.evaluate(row,{...current,basisHash})
  if (!state.valid && current.explainInvalid) throw validity.invalidError(row,state)
  return state.valid ? Number(row.id) : null
}

module.exports = {
  STATUS, STATUS_NAME,
  create, submit, approve, reject, cancel, findAll, findById, hasApprovedOverride,
}
