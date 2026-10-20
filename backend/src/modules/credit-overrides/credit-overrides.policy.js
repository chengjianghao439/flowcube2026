const crypto = require('node:crypto')
const AppError = require('../../utils/AppError')
const { PERMISSIONS: P } = require('../../constants/permissions')

const ACTION_PERMISSIONS = [P.SALE_CREDIT_OVERRIDE_VIEW, P.SALE_CREDIT_OVERRIDE_APPROVE, P.APPROVAL_TASK_VIEW]

async function loadActor(db, userId, current = false) {
  const lock = current ? ' FOR SHARE' : ''
  const [[user]] = await db.query('SELECT id, role_id, real_name, is_active, deleted_at, allow_self_approve FROM sys_users WHERE id=?' + lock, [Number(userId)])
  if (!user || Number(user.is_active) !== 1 || user.deleted_at) throw new AppError('当前账号不可用', 403, 'CREDIT_APPROVAL_DENIED')
  const [permissions] = await db.query('SELECT permission FROM sys_role_permissions WHERE role_id=? ORDER BY permission' + lock, [Number(user.role_id)])
  const [scopes] = await db.query('SELECT warehouse_id FROM user_warehouse_scope WHERE user_id=? ORDER BY warehouse_id' + lock, [Number(user.id)])
  return {
    userId: Number(user.id), roleId: Number(user.role_id), realName: user.real_name,
    allowSelfApprove: Number(user.allow_self_approve) === 1,
    permissions: permissions.map(r => r.permission),
    warehouseIds: Number(user.role_id) === 1 || !scopes.length ? null : scopes.map(r => Number(r.warehouse_id)),
  }
}

function canAct(actor, applicantId) {
  return (actor.roleId === 1 || ACTION_PERMISSIONS.every(p => actor.permissions.includes(p)))
    && (actor.userId !== Number(applicantId) || actor.allowSelfApprove)
}

function assertAction(actor, applicantId, comment) {
  if (actor.userId === Number(applicantId) && !actor.allowSelfApprove) throw new AppError('该账号未开启允许自行审批', 403, 'SELF_APPROVAL_DENIED')
  if (!canAct(actor, applicantId)) throw new AppError('缺少授信审批、查看或待办权限', 403, 'CREDIT_APPROVAL_DENIED')
  if (actor.userId === Number(applicantId) && !String(comment || '').trim()) throw new AppError('自行审批必须填写原因', 400, 'SELF_APPROVAL_REASON_REQUIRED')
}

// Bind commercial facts only. Reservation, picking and partial shipment progress
// must not invalidate approval of the unchanged order.
async function orderBasis(db, order) {
  const [items] = await db.query('SELECT id, product_id, warehouse_id, unit, quantity, unit_price FROM sale_order_items WHERE order_id=? ORDER BY id FOR SHARE', [Number(order.id)])
  return hashOrderBasis(order, items)
}

function hashOrderBasis(order, items) {
  const text = value => value == null ? null : String(value)
  const basis = [Number(order.id), Number(order.customer_id), Number(order.warehouse_id), text(order.total_amount), text(order.discount_amount), order.commercial_model || null, Number(order.commercial_revision || 0),
    items.map(r => [Number(r.id), Number(r.product_id), Number(r.warehouse_id ?? order.warehouse_id), r.unit, text(r.quantity), text(r.unit_price)])]
  if (!items.length) throw new AppError('销售单无完整明细，不能申请授信', 409, 'CREDIT_APPROVAL_BASIS_INVALID')
  return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex')
}

async function eligibleUserIds(db, userIds, bizId) {
  if (!userIds.length) return []
  const [rows] = await db.query(`SELECT u.id FROM sys_users u JOIN sys_roles r ON r.id=u.role_id
    JOIN sale_credit_overrides c ON c.id=? JOIN sale_orders so ON so.id=c.sale_order_id
    WHERE u.id IN (?) AND u.is_active=1 AND u.deleted_at IS NULL
      AND (u.role_id=1 OR (SELECT COUNT(DISTINCT p.permission) FROM sys_role_permissions p WHERE p.role_id=u.role_id AND p.permission IN (?))=?)
      AND (u.role_id=1 OR NOT EXISTS (SELECT 1 FROM user_warehouse_scope us WHERE us.user_id=u.id)
        OR (EXISTS (SELECT 1 FROM user_warehouse_scope us WHERE us.user_id=u.id AND us.warehouse_id=so.warehouse_id)
          AND NOT EXISTS (SELECT 1 FROM sale_order_items oi WHERE oi.order_id=so.id
            AND NOT EXISTS (SELECT 1 FROM user_warehouse_scope us WHERE us.user_id=u.id AND us.warehouse_id=COALESCE(oi.warehouse_id,so.warehouse_id)))))`,
  [Number(bizId), userIds, ACTION_PERMISSIONS, ACTION_PERMISSIONS.length])
  return rows.map(row => Number(row.id))
}

module.exports = { ACTION_PERMISSIONS, loadActor, canAct, assertAction, orderBasis, hashOrderBasis, eligibleUserIds }
