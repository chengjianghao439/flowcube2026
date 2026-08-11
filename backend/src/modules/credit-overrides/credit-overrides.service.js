const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { normalizePagination } = require('../../utils/pagination')
const approvalEngine = require('../../engine/approvalEngine')

/**
 * 超额放行审批单（文档 05 Phase 2）：销售员发起「申请—审批」两步。
 *
 * 场景：占库时客户额度不足，销售员若无 sale.credit.override 权限，可发起一张放行申请单，
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
async function create({ saleOrderId, reason }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[order]] = await conn.query(
      'SELECT o.id, o.order_no, o.total_amount, o.customer_id, o.status, c.name AS customer_name, c.credit_limit FROM sale_orders o JOIN sale_customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL',
      [Number(saleOrderId)],
    )
    if (!order) throw new AppError('销售单不存在', 404)
    if (order.credit_limit == null) throw new AppError('该客户未设置授信额度，无需超额放行申请', 400)

    // 活跃唯一性：该销售单已有「未结束」的申请（草稿/待审批/已批准）→ 拒绝
    const [[active]] = await conn.query(
      'SELECT id FROM sale_credit_overrides WHERE sale_order_id=? AND status IN (1,2,3) AND deleted_at IS NULL LIMIT 1',
      [Number(saleOrderId)],
    )
    if (active) throw new AppError('该销售单已存在进行中或已批准的放行申请，请勿重复发起', 409, 'CREDIT_OVERRIDE_DUPLICATE')

    // 快照信用口径（占库校验同款：未清应收 + 在途敞口）。本单尚为草稿(1)不占用信用。
    const used = await getUsedCredit(conn, Number(order.customer_id))
    const thisAmount = Number(order.total_amount) || 0
    const limit = Number(order.credit_limit)
    const overAmount = Math.max(0, Math.round((used + thisAmount - limit) * 100) / 100)
    if (overAmount <= 0) {
      throw new AppError('该销售单当前未超授信额度，无需放行申请', 400)
    }

    const overrideNo = await generateDailyCode(conn, 'CO', 'sale_credit_overrides', 'override_no')
    const [r] = await conn.query(
      `INSERT INTO sale_credit_overrides
        (override_no, sale_order_id, sale_order_no, customer_id, customer_name, credit_limit, used_credit, this_amount, over_amount, reason, applicant_id, applicant_name, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [overrideNo, order.id, order.order_no, Number(order.customer_id), order.customer_name, limit, used, thisAmount, overAmount,
        String(reason || '').trim() || null, Number(operator.operatorId), operator.operatorName],
    )
    await conn.commit()
    return { id: r.insertId, overrideNo, overAmount }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 提交审批：草稿 → 待审批，同事务建审批流实例（引擎）。 */
async function submit(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'sale_credit_overrides', id,
      columns: 'id, status, applicant_id, sale_order_id, over_amount', entityName: '放行申请单',
    })
    await assertOwner(row, operator)
    const rule = assertStatusAction('creditOverride', 'submit', row.status)
    await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })

    const inst = await approvalEngine.startApproval(conn, {
      bizType: 'sale_credit_override',
      bizId: id,
      amount: Number(row.over_amount),
      applicantId: Number(row.applicant_id),
      applicantName: operator.operatorName,
    })
    await conn.commit()
    return { id: Number(id), status: rule.to, overrideNo: row.override_no, multiLevel: !!inst, instanceId: inst?.instanceId ?? null }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 审批通过：推进引擎节点；实例最终通过 → 申请单 2→3 已批准。 */
async function approve(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'sale_credit_overrides', id, columns: 'id, status, applicant_id', entityName: '放行申请单',
    })
    if (Number(row.applicant_id) === Number(operator.operatorId)) throw new AppError('不能审批自己发起的放行申请', 403)
    const rule = assertStatusAction('creditOverride', 'approve', row.status)

    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: id })
    if (active) {
      const r = await approvalEngine.approveStep(conn, { instanceId: active.instance.id, operator, comment: null })
      if (Number(r.status) === approvalEngine.INSTANCE_STATUS.APPROVED) {
        await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })
        await conn.query('UPDATE sale_credit_overrides SET reject_reason=NULL WHERE id=?', [id])
      }
      await conn.commit()
      return { id: Number(id), status: Number(r.status) === approvalEngine.INSTANCE_STATUS.APPROVED ? rule.to : row.status, multiLevel: true, approvalStatus: r.status }
    }
    // 无引擎实例 → 单级直接批（兼容未配流程的情况）
    await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })
    await conn.query('UPDATE sale_credit_overrides SET reject_reason=NULL WHERE id=?', [id])
    await conn.commit()
    return { id: Number(id), status: rule.to, multiLevel: false }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 驳回：引擎驳回实例 + 申请单 → 已驳回。 */
async function reject(id, { reason }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'sale_credit_overrides', id, columns: 'id, status, applicant_id', entityName: '放行申请单',
    })
    if (Number(row.applicant_id) === Number(operator.operatorId)) throw new AppError('不能驳回自己发起的放行申请', 403)
    if (!String(reason || '').trim()) throw new AppError('请填写驳回原因', 400)
    const rule = assertStatusAction('creditOverride', 'reject', row.status)

    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: id })
    if (active) await approvalEngine.rejectStep(conn, { instanceId: active.instance.id, operator, comment: reason })
    await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })
    await conn.query('UPDATE sale_credit_overrides SET reject_reason=? WHERE id=?', [String(reason).trim(), id])
    await conn.commit()
    return { id: Number(id), status: rule.to }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 取消：草稿/待审批/已驳回 → 已取消；有进行中审批实例一并撤销。 */
async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'sale_credit_overrides', id, columns: 'id, status, applicant_id', entityName: '放行申请单',
    })
    await assertOwner(row, operator)
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: id })
    if (active) await approvalEngine.cancelInstance(conn, { instanceId: active.instance.id, operator })
    const rule = assertStatusAction('creditOverride', 'cancel', row.status)
    await compareAndSetStatus(conn, { table: 'sale_credit_overrides', id, fromStatus: rule.from, toStatus: rule.to, entityName: '放行申请单' })
    await conn.commit()
    return { id: Number(id), status: rule.to }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function assertOwner(row, operator) {
  if (Number(operator?.roleId) === 1) return
  if (Number(row.applicant_id) !== Number(operator?.operatorId)) throw new AppError('只能操作本人发起的放行申请', 403)
}

async function findAll({ page = 1, pageSize = 20, status = '', keyword = '', saleOrderId = '' } = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['c.deleted_at IS NULL']
  const params = []
  if (status) { conds.push('c.status=?'); params.push(Number(status)) }
  if (saleOrderId) { conds.push('c.sale_order_id=?'); params.push(Number(saleOrderId)) }
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(c.override_no LIKE ? OR c.sale_order_no LIKE ? OR c.customer_name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`) }
  const where = `WHERE ${conds.join(' AND ')}`
  const [rows] = await pool.query(
    `SELECT * FROM sale_credit_overrides c ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_credit_overrides c ${where}`, params)
  return { list: rows.map(fmt), pagination: { page: p, pageSize: ps, total } }
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM sale_credit_overrides WHERE id=? AND deleted_at IS NULL', [Number(id)])
  if (!row) throw new AppError('放行申请单不存在', 404)
  const detail = fmt(row)
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

/** 供 sale.service 占库放行判断：该销售单是否存在「已批准」的放行申请 */
async function hasApprovedOverride(saleOrderId) {
  const [[row]] = await pool.query(
    'SELECT id FROM sale_credit_overrides WHERE sale_order_id=? AND status=3 AND deleted_at IS NULL LIMIT 1',
    [Number(saleOrderId)],
  )
  return row ? Number(row.id) : null
}

/** 信用口径同款（避免循环依赖 sale.service，此处内联：未清应收 + 在途敞口） */
async function getUsedCredit(conn, customerId) {
  const [[a]] = await conn.query(
    `SELECT COALESCE(SUM(pr.balance),0) AS used FROM payment_records pr
     JOIN sale_orders so ON so.id=pr.order_id
     WHERE pr.type=2 AND pr.status IN (1,2) AND so.customer_id=?`,
    [customerId],
  )
  const [[b]] = await conn.query(
    `SELECT COALESCE(SUM(GREATEST(0, so.total_amount - COALESCE(pr.total_amount,0))),0) AS used_open
     FROM sale_orders so
     LEFT JOIN payment_records pr ON pr.type=2 AND pr.order_id=so.id
     WHERE so.customer_id=? AND so.status IN (2,3) AND so.deleted_at IS NULL`,
    [customerId],
  )
  return Math.round((Number(a.used) + Number(b.used_open)) * 10000) / 10000
}

module.exports = {
  STATUS, STATUS_NAME,
  create, submit, approve, reject, cancel, findAll, findById, hasApprovedOverride,
}
