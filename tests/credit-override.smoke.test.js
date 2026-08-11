#!/usr/bin/env node
'use strict'

/**
 * 超额放行申请单回归（文档 05 Phase 2）：销售员申请 → 审批 → 占库自动放行。
 *
 * 覆盖语义：
 *   1. 客户授信不足且操作者无 override 权限 → 占库硬拦截（CREDIT_LIMIT_EXCEEDED）。
 *   2. 销售员（role 3，有 apply 权限）发起放行申请 → 草稿 → 提交 → 走多级审批流。
 *   3. 审批人批准 → 申请单已批准（3）。
 *   4. ★ 核心：该销售单再有任意用户（无 override 权限）占库 → 自动放行成功。
 *   5. 另一张未申请的销售单（同客户超限）占库 → 仍拦截。
 *   6. 申请人本人不能批准自己的申请。
 *
 * 运行：node tests/credit-override.smoke.test.js
 */

const path = require('path')
const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
const {
  createLogger,
  prepareSmokeContext,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

async function createUser(pool, { username, realName, roleId }) {
  const hashed = bcrypt.hashSync('SmokePwd123!', 10)
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=VALUES(role_id), role_name=VALUES(role_name), is_active=1, deleted_at=NULL`,
    [username, hashed, realName, roleId, realName],
  )
  const [[u]] = await pool.query('SELECT id FROM sys_users WHERE username=? LIMIT 1', [username])
  return { id: u.id, username, realName }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx

  try {
    // 清掉可能残留的测试审批流（避免金额区间污染），再建一条给超额放行申请用的审批流
    await pool.query('DELETE FROM approval_flow_steps WHERE flow_id IN (SELECT id FROM approval_flows)')
    await pool.query('DELETE FROM approval_flows')
    await pool.query('DELETE FROM approval_instance_task_approvers')
    await pool.query('DELETE FROM approval_instance_tasks')
    await pool.query('DELETE FROM approval_instances')

    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const adminToken = adminLogin.token || adminLogin.data?.token

    // 为超额放行申请建一条审批流（指定用户=超管，走多级审批引擎）
    const [[adminUser]] = await pool.query("SELECT id FROM sys_users WHERE username='smoke_admin' AND deleted_at IS NULL AND is_active=1 ORDER BY id LIMIT 1")
    const adminUserId = Number(adminUser.id)
    await pool.query(
      `INSERT INTO approval_flows (biz_type, name, min_amount, max_amount, is_active)
       VALUES ('sale_credit_override', '超额放行审批流', 0, NULL, 1)`,
    )
    const [[flowRow]] = await pool.query("SELECT id FROM approval_flows WHERE biz_type='sale_credit_override' ORDER BY id DESC LIMIT 1")
    await pool.query(
      `INSERT INTO approval_flow_steps (flow_id, step_order, approver_type, role_id, department_id, user_id)
       VALUES (?, 1, 3, NULL, NULL, ?)`,
      [flowRow.id, adminUserId],
    )

    // 建销售员（role 3，153 迁移已 seed purchase.*；本测试需要 sale.* 与 credit override apply）
    const ref = randomRef('CO-').slice(0, 6)
    const salesman = await createUser(pool, { username: `smoke_sales_${ref}`, realName: 'Smoke销售员', roleId: 3 })
    // 授销售员相关权限（建销售单/占库/发起申请）
    await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (3, ?), (3, ?), (3, ?), (3, ?)',
      ['sale.order.create', 'sale.order.reserve', 'sale.credit.override.apply', 'sale.credit.override.view'])
    const salesLogin = await login(http, salesman.username, 'SmokePwd123!')
    const salesToken = salesLogin.token || salesLogin.data?.token

    // 建额度 1000 的测试客户
    const [cr] = await pool.query(
      "INSERT INTO sale_customers (name, code, credit_limit) VALUES ('超额放行测试客户', ?, 1000)",
      [`COVR-CUS-${ref}`],
    )
    const customerId = cr.insertId
    // 建测试商品（覆盖 prepareSmokeContext 可能没有足够库存的测试商品，用独立商品）
    const [pr] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price, avg_cost) VALUES (?, ?, '个', 10, 5, 5)",
      [`COVR-PRD-${ref}`, '超额放行测试商品'],
    )
    const productId = pr.insertId
    // 注入库存（走容器引擎正规两段式）
    const containerEngine = require(path.resolve(__dirname, '../backend/src/engine/containerEngine'))
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const { containerId } = await containerEngine.createContainer(conn, {
        productId, warehouseId: ctx.warehouse.id, initialQty: 500,
        sourceType: containerEngine.SOURCE_TYPE.MANUAL, sourceRefId: 999997,
        remark: '超额放行测试铺底库存', containerStatus: containerEngine.CONTAINER_STATUS.PENDING_PUTAWAY,
      })
      await containerEngine.promotePendingContainerToActive(conn, containerId, productId, ctx.warehouse.id)
      await conn.commit()
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }

    const orderPayload = (orderNo) => ({
      token: salesToken,
      json: {
        orderNo,
        customerId,
        customerName: '超额放行测试客户',
        warehouseId: ctx.warehouse.id,
        warehouseName: ctx.warehouse.name,
        items: [{ productId, productCode: `COVR-PRD-${ref}`, productName: '超额放行测试商品', unit: '个', quantity: 120, unitPrice: 15 }],
      },
    })
    // 建两张 1200 的销售单（额度 1000 → 各超 200）
    const o1 = await http.post('/api/sale', orderPayload(`SO-COVR-${ref}-1`))
    const order1Id = o1.data?.data?.id
    const o2 = await http.post('/api/sale', orderPayload(`SO-COVR-${ref}-2`))
    const order2Id = o2.data?.data?.id
    log.assert('建两张超限销售单', Number.isInteger(order1Id) && Number.isInteger(order2Id), JSON.stringify(o1.data))

    log.section('用例1：无 override 权限占库被拦')
    {
      const r = await http.post(`/api/sale/${order1Id}/reserve`, { token: salesToken })
      log.assert('超限且无 override 权限 → 409 CREDIT_LIMIT_EXCEEDED', !r.ok && r.status === 409 && r.data?.code === 'CREDIT_LIMIT_EXCEEDED', `${r.status} ${JSON.stringify(r.data)}`)
    }

    log.section('用例2：发起放行申请 → 提交 → 审批通过')
    {
      const createR = await http.post('/api/credit-overrides', {
        token: salesToken,
        json: { saleOrderId: order1Id, reason: '客户大促备货，预计回款快' },
      })
      const applyId = createR.data?.data?.id
      log.assert('发起申请成功（草稿）', Number.isInteger(applyId) && createR.ok, JSON.stringify(createR.data))
      // 单额 1800（120×15），额度 1000 → 超量 800
      log.assert('申请快照超量 800', createR.data?.data?.overAmount === 800, JSON.stringify(createR.data))

      const submitR = await http.post(`/api/credit-overrides/${applyId}/submit`, { token: salesToken })
      log.assert('提交后待审批 + 建审批实例', submitR.ok && submitR.data?.data?.multiLevel === true, JSON.stringify(submitR.data))

      // 申请人自批被拒（routes 权限通过，但 service/引擎校验）
      const selfApprove = await http.post(`/api/credit-overrides/${applyId}/approve`, { token: salesToken })
      log.assert('申请人自批被拒', !selfApprove.ok && selfApprove.status === 403, `${selfApprove.status} ${JSON.stringify(selfApprove.data)}`)

      // 超管批准 → 申请单已批准
      const approveR = await http.post(`/api/credit-overrides/${applyId}/approve`, { token: adminToken })
      log.assert('审批通过 → 申请单已批准(3)', approveR.ok && approveR.data?.data?.status === 3, JSON.stringify(approveR.data))

      const detail = await http.get(`/api/credit-overrides/${applyId}`, { token: salesToken })
      log.assert('详情含审批实例且实例已通过', detail.data?.data?.approval?.status === 2, JSON.stringify(detail.data?.data?.approval))
    }

    log.section('用例3：★ 已批准申请 → 占库自动放行（无需 override 权限）')
    {
      const r = await http.post(`/api/sale/${order1Id}/reserve`, { token: salesToken })
      log.assert('已批准申请单 → 占库自动放行成功', r.ok, `${r.status} ${JSON.stringify(r.data)}`)
      const events = await pool.query(
        'SELECT event_type, payload_json FROM sale_order_events WHERE sale_order_id=? AND event_type=? ORDER BY id DESC LIMIT 1',
        [order1Id, 'credit_override'],
      )
      const evt = events[0][0]
      const payload = typeof evt?.payload_json === 'string' ? JSON.parse(evt.payload_json) : evt?.payload_json
      log.assert('放行事件留痕（自动放行）', evt?.event_type === 'credit_override' && payload?.via === 'approved_override' && payload?.approvedOverrideId != null, JSON.stringify(evt))
    }

    log.section('用例4：未申请的销售单占库仍拦截')
    {
      const r = await http.post(`/api/sale/${order2Id}/reserve`, { token: salesToken })
      log.assert('无申请的另一张超限单 → 仍拦截', !r.ok && r.status === 409 && r.data?.code === 'CREDIT_LIMIT_EXCEEDED', `${r.status} ${JSON.stringify(r.data)}`)
    }

    // 清理
    await pool.query('DELETE FROM approval_flow_steps WHERE flow_id IN (SELECT id FROM approval_flows)')
    await pool.query('DELETE FROM approval_flows')
    await pool.query('DELETE FROM approval_instance_task_approvers')
    await pool.query('DELETE FROM approval_instance_tasks')
    await pool.query('DELETE FROM approval_instances')
    await pool.query('DELETE FROM sale_credit_overrides')
    await pool.query('DELETE FROM sale_order_events WHERE sale_order_id IN (?, ?)', [order1Id, order2Id])
    await pool.query('DELETE FROM sale_order_items WHERE order_id IN (?, ?)', [order1Id, order2Id])
    await pool.query('DELETE FROM sale_orders WHERE id IN (?, ?)', [order1Id, order2Id])
    await pool.query('DELETE FROM sale_customers WHERE id=?', [customerId])
    await pool.query('DELETE FROM product_items WHERE id=?', [productId])
  } finally {
    await ctx.close()
  }

  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
