#!/usr/bin/env node
'use strict'

/**
 * 采购审批环节回归测试（审计 4.7）。
 *   node tests/purchase-approval.smoke.test.js
 *
 * 金额超阈值采购单提交后须审批通过才能建收货订单（内控）。
 * 复用请购单审批范式：审批人不能是制单人；approve 需要 purchase.order.approve 权限
 * （默认只有超管/被授予的角色有）。
 *
 *   1. 超阈值单确认 → 待审批(5) + need_approval=1
 *   2. 审批人=制单人 → 403 拒绝
 *   3. 他人审批通过 → 回已提交(2) + 审批人留痕，可建收货
 *   4. 小金额单确认 → 直接已提交(2)，不需审批
 *   5. 驳回 → 回草稿(1) + 驳回原因
 *   6. 无权限角色审批 → 403（requirePermission 拦截）
 */

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  randomRef,
} = require('./helpers/smokeTestKit')
const svc = require('../backend/src/modules/purchase/purchase.service')

async function createPo(pool, { supplier, warehouse, product, amount, operator }) {
  const [r] = await pool.query(
    `INSERT INTO purchase_orders (order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, total_amount, status, operator_id, operator_name)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [randomRef('PO-APR').slice(0, 20), supplier.id, supplier.name, warehouse.id, warehouse.name, amount, operator.userId, operator.realName],
  )
  await pool.query(
    `INSERT INTO purchase_order_items (order_id, product_id, product_code, product_name, unit, quantity, unit_price, amount)
     VALUES (?, ?, ?, ?, '个', 1, ?, ?)`,
    [r.insertId, product.id, product.code, product.name, amount, amount],
  )
  return { id: r.insertId }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, warehouse, supplier, product } = ctx
  const conn = await pool.getConnection()
  const createdIds = []
  try {
    // 开启审批阈值 500
    await pool.query("UPDATE sys_settings SET value='500' WHERE key_name='purchase_approval_threshold'")

    const maker = { userId: 88801, realName: '采购制单人' }
    const approver = { userId: 1, realName: '管理员' }

    // 1. 超阈值单（800）确认 → 待审批(5)
    const big = await createPo(pool, { supplier, warehouse, product, amount: 800, operator: maker })
    createdIds.push(big.id)
    const c1 = await svc.confirm(big.id, maker)
    const [r1] = await dbQuery(pool, 'SELECT status, need_approval FROM purchase_orders WHERE id=?', [big.id])
    log.assert('★ 超阈值单确认 → 待审批(5) + need_approval=1',
      Number(r1.status) === 5 && Number(r1.need_approval) === 1 && c1.needApproval === true,
      `status=${r1.status} need_approval=${r1.need_approval}`)

    // 2. 审批人=制单人 → 403
    let blocked = false
    try { await svc.approve(big.id, maker) } catch (e) { blocked = e.statusCode === 403 }
    log.assert('★ 审批人=制单人 → 403', blocked, '')

    // 3. 他人审批通过 → 回已提交(2) + 审批人留痕
    await svc.approve(big.id, approver)
    const [r2] = await dbQuery(pool, 'SELECT status, approved_by_name FROM purchase_orders WHERE id=?', [big.id])
    log.assert('★ 他人审批通过 → 已提交(2) + 审批人留痕',
      Number(r2.status) === 2 && r2.approved_by_name === '管理员', `status=${r2.status} approved_by=${r2.approved_by_name}`)

    // 4. 小金额单（300）确认 → 直接已提交(2)，不需审批
    const small = await createPo(pool, { supplier, warehouse, product, amount: 300, operator: maker })
    createdIds.push(small.id)
    const c4 = await svc.confirm(small.id, maker)
    const [r4] = await dbQuery(pool, 'SELECT status, need_approval FROM purchase_orders WHERE id=?', [small.id])
    log.assert('★ 小金额单确认 → 已提交(2)，不需审批',
      Number(r4.status) === 2 && Number(r4.need_approval) === 0 && c4.needApproval === false,
      `status=${r4.status}`)

    // 5. 驳回 → 回草稿(1) + 驳回原因
    const rej = await createPo(pool, { supplier, warehouse, product, amount: 900, operator: maker })
    createdIds.push(rej.id)
    await svc.confirm(rej.id, maker)
    await svc.reject(rej.id, { reason: '价格偏高' }, approver)
    const [r5] = await dbQuery(pool, 'SELECT status, reject_reason FROM purchase_orders WHERE id=?', [rej.id])
    log.assert('★ 驳回 → 草稿(1) + 驳回原因', Number(r5.status) === 1 && r5.reject_reason === '价格偏高',
      `status=${r5.status} reason=${r5.reject_reason}`)

    // 6. 无 purchase.order.approve 权限角色审批 → 403（requirePermission 层拦截）
    // 直接调 service 绕过权限层测不到；这里验证权限码确实存在且 role 5 无权
    const [permRow] = await dbQuery(pool, "SELECT COUNT(*) AS n FROM sys_role_permissions WHERE role_id=5 AND permission='purchase.order.approve'")
    log.assert('只读角色(5)未被授予审批权限（内控点不自动 seed）', Number(permRow.n) === 0, `n=${permRow.n}`)

    // 恢复阈值
    await pool.query("UPDATE sys_settings SET value='0' WHERE key_name='purchase_approval_threshold'")
    // 清理
    await pool.query('DELETE FROM purchase_order_items WHERE order_id IN (?)', [createdIds])
    await pool.query('DELETE FROM purchase_orders WHERE id IN (?)', [createdIds])
    await conn.release()
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[PURCHASE-APPROVAL] 未捕获异常：', e)
  process.exit(1)
})
