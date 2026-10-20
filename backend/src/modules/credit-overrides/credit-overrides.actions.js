const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const approvalEngine = require('../../engine/approvalEngine')
const { assertSaleDocumentInScope } = require('../../utils/saleDocumentScope')
const { beginResourceOperationRequest, completeOperationRequest, creationFingerprint } = require('../../utils/operationRequest')
const policy = require('./credit-overrides.policy')

// All credit writers share SO -> request -> actor -> approval locks. Reservation
// and shipment already lock SO first, so revocation cannot race consumption.
async function lockRequest(conn, id) {
  const [[identity]] = await conn.query('SELECT sale_order_id FROM sale_credit_overrides WHERE id=? AND deleted_at IS NULL', [Number(id)])
  if (!identity) throw new AppError('放行申请不存在', 404)
  const [[order]] = await conn.query('SELECT * FROM sale_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE', [Number(identity.sale_order_id)])
  const [[row]] = await conn.query('SELECT * FROM sale_credit_overrides WHERE id=? AND deleted_at IS NULL FOR UPDATE', [Number(id)])
  if (!order || !row || Number(row.sale_order_id) !== Number(order.id)) throw new AppError('关联销售单身份已变化', 409, 'CREDIT_APPROVAL_BASIS_INVALID')
  return { order, row }
}

async function assertBasis(conn, order, row) {
  const [[proof]] = await conn.query('SELECT * FROM sale_credit_approval_proofs WHERE override_id=? AND sale_order_id=? FOR SHARE', [row.id, order.id])
  const basisHash = proof ? await policy.orderBasis(conn,order) : null
  // Current locking reads are required: lockRequest's initial identity lookup
  // may have opened an RR snapshot before waiting for the sale-order lock.
  const [newer] = await conn.query('SELECT id FROM sale_credit_overrides WHERE sale_order_id=? AND id>? ORDER BY id DESC LIMIT 1 FOR SHARE',[order.id,row.id])
  const [[clock]] = await conn.query('SELECT (expires_at IS NOT NULL AND expires_at<=NOW()) AS proof_expired FROM sale_credit_approval_proofs WHERE override_id=? AND sale_order_id=? FOR SHARE',[row.id,order.id])
  if (Number(row.status)===2 && Number(clock?.proof_expired)===1) throw new AppError('待审批申请已过期，不能继续审批。请按当前销售单重新申请，无需先取消历史申请',409,'CREDIT_APPROVAL_EXPIRED')
  if (newer.length) throw new AppError('已有更新的申请，原申请仅保留历史，不能继续提交或审批',409,'CREDIT_APPROVAL_SUPERSEDED')
  if (!proof || Number(clock?.proof_expired)===1 || ![1, 2, 3, 6].includes(Number(order.status)) || Number(order.customer_id) !== Number(row.customer_id) || proof.basis_hash !== basisHash) {
    throw new AppError('申请已过期或销售单已变化，请取消原申请并重新申请', 409, 'CREDIT_APPROVAL_BASIS_INVALID')
  }
  return proof
}

const commentTooLong = value => String(value || '').length > 500

async function act(id, action, { expectedTaskId, reason, requestKey } = {}, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const { row, order } = await lockRequest(conn, id)
    const actor = await policy.loadActor(conn, operator?.userId ?? operator?.operatorId, true)
    await assertSaleDocumentInScope(conn, actor.warehouseIds, order.id, { currentRead: true })
    if (actor.roleId !== 1 && !policy.ACTION_PERMISSIONS.every(p => actor.permissions.includes(p))) throw new AppError('缺少授信审批相关权限', 403, 'CREDIT_APPROVAL_DENIED')
    const active = Number(row.status)===2 ? await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: id, currentRead: true }) : null
    if (Number(row.status)===2 && !active) throw new AppError('该申请缺少审批流程，请取消后重新提交',409,'CREDIT_APPROVAL_FLOW_REQUIRED')
    if (!requestKey || String(requestKey).length>100 || commentTooLong(reason) || !Number.isSafeInteger(Number(expectedTaskId)) || Number(expectedTaskId) <= 0) throw new AppError('请刷新当前审批节点后重新操作', 400, 'CREDIT_APPROVAL_INTENT_REQUIRED')
    const comment = String(reason || '').trim()
    const fingerprint = creationFingerprint({ id: Number(id), taskId: Number(expectedTaskId), action, reason: comment })
    const state = await beginResourceOperationRequest(conn, { requestKey, action: `credit.${action}`, userId: actor.userId, resourceType: 'credit_override', resourceId: id })
    if (state.replay) {
      if (state.responseData?.requestFingerprint !== fingerprint) throw new AppError('原请求内容不一致，请核对原审批结果', 409, 'CREDIT_APPROVAL_INTENT_CONFLICT')
      await conn.rollback()
      return state.responseData
    }
    policy.assertAction(actor, row.applicant_id, comment)
    if (Number(row.status) !== 2) throw new AppError('申请已处理，不能重复审批', 409, 'APPROVAL_FINISHED')
    await assertBasis(conn, order, row)
    const task = active?.tasks.find(t => Number(t.step_order) === Number(active.instance.current_step) && Number(t.status) === 1)
    if (!task || Number(task.id) !== Number(expectedTaskId)) throw new AppError('审批节点已变化，请刷新后核对', 409, 'APPROVAL_CONFLICT')
    const result = await (action === 'approve' ? approvalEngine.approveStep : approvalEngine.rejectStep)(conn, { instanceId: active.instance.id, operator: actor, comment })
    const finished = Number(result.status) === approvalEngine.INSTANCE_STATUS.APPROVED
    const status = action === 'reject' ? 4 : finished ? 3 : 2
    const [updated] = await conn.query('UPDATE sale_credit_overrides SET status=?, reject_reason=? WHERE id=? AND status=2', [status, action === 'reject' ? comment : null, id])
    if (Number(updated.affectedRows)!==1) throw new AppError('申请状态已变化，请刷新后核对',409,'APPROVAL_CONFLICT')
    await conn.query(`INSERT INTO sale_credit_approval_actions
      (override_id,sale_order_id,instance_id,task_id,step_order,applicant_id,approver_id,approver_name,action,reason,is_self_approval,authorization_basis,request_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, order.id, active.instance.id, task.id, task.step_order, row.applicant_id, actor.userId, actor.realName, action, comment || null,
      actor.userId === Number(row.applicant_id) ? 1 : 0,
      JSON.stringify({ roleId: actor.roleId, allowSelfApprove: actor.allowSelfApprove, permissionBasis: actor.roleId===1 ? 'administrator_role' : 'role_permissions', requiredPermissions: policy.ACTION_PERMISSIONS, heldPermissions: actor.permissions.filter(p=>policy.ACTION_PERMISSIONS.includes(p)), selfApprovalBasis: actor.userId===Number(row.applicant_id) ? 'sys_users.allow_self_approve=1' : null, nodeAssignment: Number(task.id), warehouseIds: actor.warehouseIds }), requestKey])
    const data = { id: Number(id), status, multiLevel: true, approvalStatus: result.status, processedTaskId: Number(task.id), requestFingerprint: fingerprint }
    await completeOperationRequest(conn, state, { data, resourceType: 'credit_override', resourceId: id })
    await conn.commit()
    return data
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}

async function decorate(db, rows, userId) {
  if (!rows.length || !userId) return rows.map(row => ({ ...row, canApprove: false }))
  const actor = await policy.loadActor(db, userId)
  const {saleDocumentScopeFilter} = require('../../utils/saleDocumentScope')
  const scope = saleDocumentScopeFilter(actor.warehouseIds,'c.sale_order_id')
  const [tasks] = await db.query(`SELECT i.biz_id,t.id AS task_id
    FROM approval_instances i JOIN sale_credit_overrides c ON c.id=i.biz_id AND c.status=2 AND c.deleted_at IS NULL
    JOIN sale_credit_approval_proofs p ON p.override_id=c.id AND p.sale_order_id=c.sale_order_id AND (p.expires_at IS NULL OR p.expires_at>NOW())
    JOIN sale_orders so ON so.id=c.sale_order_id AND so.deleted_at IS NULL AND so.status IN (1,2,3,6)
    JOIN approval_instance_tasks t ON t.instance_id=i.id AND t.step_order=i.current_step AND t.status=1
    JOIN approval_instance_task_approvers a ON a.task_id=t.id AND a.user_id=?
    WHERE i.biz_type='sale_credit_override' AND i.status=1 AND i.biz_id IN (?)
      AND NOT EXISTS (SELECT 1 FROM sale_credit_overrides newer WHERE newer.sale_order_id=c.sale_order_id AND newer.id>c.id)${scope.sql}`, [actor.userId, rows.map(r => r.id),...scope.params])
  const byId = new Map(tasks.map(t => [Number(t.biz_id), Number(t.task_id)]))
  return rows.map(row => ({ ...row, currentTaskId: byId.get(row.id) || null,
    canApprove: row.status === 2 && byId.has(row.id) && policy.canAct(actor, row.applicantId),
    canManage: (actor.roleId===1 || actor.userId===row.applicantId) && (actor.roleId===1 || actor.permissions.includes('sale.credit.override.apply')),
    isSelfApproval: actor.userId === row.applicantId }))
}

module.exports = { act, lockRequest, assertBasis, decorate }
