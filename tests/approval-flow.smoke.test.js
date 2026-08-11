#!/usr/bin/env node
'use strict'

/**
 * 多级审批流引擎回归（P2-7）：请购单接入 approvalEngine 的完整链路。
 *
 * 覆盖的引擎语义（doc: docs/proposals/15-部门组织与多级审批流.md）：
 *   1. 提交请购时按金额区间匹配审批流，建审批实例 + 节点快照（串行逐级）。
 *   2. 申请人不得审批自己的单；非当前节点审批人审批被拒（403 APPROVAL_NOT_ASSIGNED）。
 *   3. 当前节点审批人批过 → 实例推进到下一级，请购仍待审批；最后一级批过 → 实例已通过，请购→已批准。
 *   4. 驳回 → 实例已驳回 + 请购→已驳回 + 写驳回原因。
 *   5. 无匹配审批流（金额区间不命中）→ startApproval 返回 null，走原单级审批（行为回归）。
 *   6. 并发：同节点两个审批人同时批 → 一方成功一方 409（CAS 防护）。
 *   7. 申请人撤回待审批请购 → 实例撤销，不残留「审批中」孤儿。
 *
 * 运行：node tests/approval-flow.smoke.test.js
 */

const path = require('path')
const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const BIZ = 'purchase_requisition'

/** 建专用测试角色（审批人用），授请购审批 + 查看权限 */
async function ensureApproverRole(pool, roleCode, roleName) {
  let [roles] = await pool.query("SELECT id FROM sys_roles WHERE code=? LIMIT 1", [roleCode])
  let roleId
  if (!roles.length) {
    const [r] = await pool.query("INSERT INTO sys_roles (name, code, remark, is_system) VALUES (?, ?, 'smoke approval test role', 0)", [roleName, roleCode])
    roleId = r.insertId
  } else {
    roleId = roles[0].id
  }
  await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [roleId, 'purchase.requisition.approve'])
  await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [roleId, 'purchase.requisition.view'])
  await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [roleId, 'purchase.requisition.create'])
  return roleId
}

async function createUser(pool, { username, password, realName, roleId }) {
  const hashed = bcrypt.hashSync(password, 10)
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=VALUES(role_id), role_name=VALUES(role_name), is_active=1, deleted_at=NULL`,
    [username, hashed, realName, roleId, realName],
  )
  const [[u]] = await pool.query('SELECT id FROM sys_users WHERE username=? LIMIT 1', [username])
  return { id: u.id, username, realName }
}

/** 配置一条请购审批流：biz_type + 金额区间 + 节点（指定用户串行）。返回 flowId */
async function createFlow(pool, { minAmount = 0, maxAmount = null, approvers }) {
  const name = `smoke审批流-${randomRef('AF-')}`
  const [r] = await pool.query(
    'INSERT INTO approval_flows (biz_type, name, min_amount, max_amount, is_active) VALUES (?, ?, ?, ?, 1)',
    [BIZ, name, minAmount, maxAmount, maxAmount != null ? maxAmount : null],
  )
  const flowId = r.insertId
  let order = 1
  for (const approver of approvers) {
    await pool.query(
      `INSERT INTO approval_flow_steps (flow_id, step_order, approver_type, role_id, department_id, user_id)
       VALUES (?, ?, 3, NULL, NULL, ?)`,
      [flowId, order, approver.id],
    )
    order++
  }
  return flowId
}

async function createRequisition(ctx, token, opts = {}) {
  const { title = '多级审批测试', estimatedPrice = 100 } = opts
  const res = await ctx.http.post('/api/purchase-requisitions', {
    token,
    json: {
      title,
      warehouseId: ctx.warehouse.id,
      items: [{ productId: ctx.product.id, quantity: 1, estimatedPrice }],
    },
  })
  if (!res.ok) throw new Error(`建请购失败: ${JSON.stringify(res.data)}`)
  return res.data?.data?.id
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const adminToken = adminLogin.token || adminLogin.data?.token

    // ── 数据准备 ──────────────────────────────────────────────
    log.section('数据准备')
    const approverRoleId = await ensureApproverRole(pool, 'smoke_approver', 'Smoke审批人')
    const applicant = await createUser(pool, { username: `smoke_app_${randomRef('').slice(0, 6)}`, password: 'SmokeApplicant123!', realName: 'Smoke申请人', roleId: 3 })
    const approverA = await createUser(pool, { username: `smoke_apv_a_${randomRef('').slice(0, 6)}`, password: 'SmokeApprover123!', realName: 'Smoke审批甲', roleId: approverRoleId })
    const approverB = await createUser(pool, { username: `smoke_apv_b_${randomRef('').slice(0, 6)}`, password: 'SmokeApprover123!', realName: 'Smoke审批乙', roleId: approverRoleId })

    // 申请人挂 role 3（153 迁移已 seed purchase.requisition.create/view）
    await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [3, 'purchase.requisition.create'])
    await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [3, 'purchase.requisition.view'])

    // 审批流是全局配置，历史残留（旧版本测试运行的流程）会污染金额区间匹配：
    // 先清空再建，保证本测试只命中自己建的流程。
    await pool.query('DELETE FROM approval_flow_steps WHERE flow_id IN (SELECT id FROM approval_flows)')
    await pool.query('DELETE FROM approval_flows')
    await pool.query('DELETE FROM approval_instance_task_approvers')
    await pool.query('DELETE FROM approval_instance_tasks')
    await pool.query('DELETE FROM approval_instances')

    const flowId = await createFlow(pool, { minAmount: 0, maxAmount: 5000, approvers: [approverA, approverB] })
    log.assert('审批流配置成功（2 级指定用户）', flowId > 0)

    const applicantLogin = await login(http, applicant.username, 'SmokeApplicant123!')
    const applicantToken = applicantLogin.token || applicantLogin.data?.token
    const approverALogin = await login(http, approverA.username, 'SmokeApprover123!')
    const approverAToken = approverALogin.token || approverALogin.data?.token
    const approverBLogin = await login(http, approverB.username, 'SmokeApprover123!')
    const approverBToken = approverBLogin.token || approverBLogin.data?.token

    if (!applicantToken || !approverAToken || !approverBToken) {
      throw new Error(`登录失败：applicant=${!!applicantToken} apvA=${!!approverAToken} apvB=${!!approverBToken} applicantLogin=${JSON.stringify(applicantLogin.response?.data)}`)
    }

    log.section('用例1：多级审批全链路（提交→一级批过→二级批过→请购已批准）')
    {
      const reqId = await createRequisition(ctx, applicantToken)
      const submit = await http.post(`/api/purchase-requisitions/${reqId}/submit`, { token: applicantToken })
      log.assert('申请人提交请购成功', submit.ok, JSON.stringify(submit.data))
      log.assert('submit 返回多级标志 multiLevel=true', submit.data?.data?.multiLevel === true, JSON.stringify(submit.data))
      log.assert('submit 返回 2 级', submit.data?.data?.totalSteps === 2, JSON.stringify(submit.data))

      const detail = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      const approval = detail.data?.data?.approval
      log.assert('详情含审批实例', !!approval && approval.status === 1, JSON.stringify(detail.data?.data?.approval))
      log.assert('当前第 1 级', approval?.currentStep === 1, JSON.stringify(approval))

      // 申请人自批被拒（引擎内「非审批人」校验）
      const selfApprove = await http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: applicantToken })
      log.assert('申请人自批被拒', !selfApprove.ok && selfApprove.status === 403, `${selfApprove.status} ${JSON.stringify(selfApprove.data)}`)

      // 非当前节点审批人（乙）批甲的第 1 级 → 403
      const wrongApprove = await http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverBToken })
      log.assert('非当前节点审批人被拒(403)', !wrongApprove.ok && wrongApprove.status === 403, `${wrongApprove.status} ${JSON.stringify(wrongApprove.data)}`)

      // 甲批过第 1 级 → 推进到第 2 级，请购仍待审批
      const step1 = await http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverAToken })
      log.assert('第 1 级审批通过', step1.ok, JSON.stringify(step1.data))
      log.assert('审批后 multiLevel=true 且 approvalStatus=1(审批中)', step1.data?.data?.multiLevel === true && step1.data?.data?.approvalStatus === 1, JSON.stringify(step1.data))
      const detail2 = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('推进后实例 currentStep=2', detail2.data?.data?.approval?.currentStep === 2, JSON.stringify(detail2.data?.data?.approval))
      log.assert('请购仍待审批(2)', detail2.data?.data?.status === 2, `status=${detail2.data?.data?.status}`)

      // 甲再批（已是第 2 级，非甲的节点）→ 403
      const repeatApprove = await http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverAToken })
      log.assert('已过节点审批人重复批被拒(403)', !repeatApprove.ok && repeatApprove.status === 403, `${repeatApprove.status} ${JSON.stringify(repeatApprove.data)}`)

      // 乙批过第 2 级 → 实例已通过，请购→已批准(3)
      const step2 = await http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverBToken })
      log.assert('第 2 级审批通过', step2.ok, JSON.stringify(step2.data))
      log.assert('审批后 approvalStatus=2(已通过)', step2.data?.data?.approvalStatus === 2, JSON.stringify(step2.data))
      const detail3 = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('请购→已批准(3)', detail3.data?.data?.status === 3, `status=${detail3.data?.data?.status}`)
      log.assert('实例终态已通过', detail3.data?.data?.approval?.status === 2, JSON.stringify(detail3.data?.data?.approval))
    }

    log.section('用例2：驳回 → 实例已驳回 + 请购已驳回')
    {
      const reqId = await createRequisition(ctx, applicantToken)
      await http.post(`/api/purchase-requisitions/${reqId}/submit`, { token: applicantToken })
      const reject = await http.post(`/api/purchase-requisitions/${reqId}/reject`, { token: approverAToken, json: { reason: '预算不足，驳回测试' } })
      log.assert('第 1 级驳回成功', reject.ok, JSON.stringify(reject.data))
      const detail = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('请购→已驳回(4)', detail.data?.data?.status === 4, `status=${detail.data?.data?.status}`)
      log.assert('实例已驳回 + 驳回原因落库', detail.data?.data?.approval?.status === 3 && detail.data?.data?.approval?.rejectReason === '预算不足，驳回测试', JSON.stringify(detail.data?.data?.approval))
    }

    log.section('用例3：无匹配审批流 → 走单级审批（行为回归）')
    {
      // 金额超过主流程上限（主流程 0~5000），且不命中 100000 起步的流程 → 无匹配流程，走单级审批
      await createFlow(pool, { minAmount: 100000, approvers: [approverA] })
      const reqId = await createRequisition(ctx, applicantToken, { estimatedPrice: 10000 })
      const submit = await http.post(`/api/purchase-requisitions/${reqId}/submit`, { token: applicantToken })
      log.assert('submit multiLevel=false（无匹配流程）', submit.data?.data?.multiLevel === false, JSON.stringify(submit.data))
      const detail = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('详情无 approval 实例', detail.data?.data?.approval == null, JSON.stringify(detail.data?.data?.approval))
      // 单级审批仍可用（审批人需非申请人）
      const approve = await http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverAToken })
      log.assert('单级审批通过 → 请购已批准', approve.ok && approve.data?.data?.multiLevel === false, JSON.stringify(approve.data))
      const detail2 = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('请购→已批准(3)', detail2.data?.data?.status === 3, `status=${detail2.data?.data?.status}`)
    }

    log.section('用例4：并发同审批人两次审批 → 恰好一次推进')
    {
      const reqId = await createRequisition(ctx, applicantToken)
      await http.post(`/api/purchase-requisitions/${reqId}/submit`, { token: applicantToken })
      // 同一审批人并发打同一节点：FOR UPDATE 串行化后，第二个请求要么是「节点已处理」(409)
      // 要么因实例已推进到下一级而「非当前节点审批人」(403)——总之绝不能两次都推进。
      const [r1, r2] = await Promise.all([
        http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverAToken }),
        http.post(`/api/purchase-requisitions/${reqId}/approve`, { token: approverAToken }),
      ])
      const okCount = [r1, r2].filter(r => r.ok).length
      const rejected = [r1, r2].filter(r => !r.ok && (r.status === 409 || r.status === 403)).length
      log.assert('并发双请求恰好 1 成功 1 被拒(403/409)', okCount === 1 && rejected === 1,
        `ok=${okCount} rejected=${rejected} ${JSON.stringify(r1.data)} ${JSON.stringify(r2.data)}`)
      const detail = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('实例仍在审批中且停在下一级', detail.data?.data?.approval?.status === 1 && detail.data?.data?.approval?.currentStep === 2, JSON.stringify(detail.data?.data?.approval))
    }

    log.section('用例5：申请人撤回待审批 → 实例撤销，不留孤儿')
    {
      const reqId = await createRequisition(ctx, applicantToken)
      await http.post(`/api/purchase-requisitions/${reqId}/submit`, { token: applicantToken })
      const withdraw = await http.post(`/api/purchase-requisitions/${reqId}/withdraw`, { token: applicantToken })
      log.assert('撤回成功', withdraw.ok, JSON.stringify(withdraw.data))
      const detail = await http.get(`/api/purchase-requisitions/${reqId}`, { token: applicantToken })
      log.assert('请购回到草稿(1)', detail.data?.data?.status === 1, `status=${detail.data?.data?.status}`)
      log.assert('实例已撤销(4)', detail.data?.data?.approval?.status === 4, JSON.stringify(detail.data?.data?.approval))
      // 撤销后重新提交 → 应能新建实例（终态不阻塞重发）
      const resubmit = await http.post(`/api/purchase-requisitions/${reqId}/submit`, { token: applicantToken })
      log.assert('撤销后重新提交成功且新建实例', resubmit.ok && resubmit.data?.data?.multiLevel === true, JSON.stringify(resubmit.data))
    }

    // 清理测试产生的流程
    // 清理测试产生的所有审批流与实例（审批流是全局配置，残留会污染后续运行与真实环境）
    await pool.query('DELETE FROM approval_flow_steps WHERE flow_id IN (SELECT id FROM approval_flows)')
    await pool.query('DELETE FROM approval_flows')
    await pool.query('DELETE FROM approval_instance_task_approvers')
    await pool.query('DELETE FROM approval_instance_tasks')
    await pool.query('DELETE FROM approval_instances')
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
