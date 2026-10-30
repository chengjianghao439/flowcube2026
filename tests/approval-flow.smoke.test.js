#!/usr/bin/env node
'use strict'

/**
 * 共享审批引擎实库回归。采购申请退役后，使用商品改价业务类型验证编排；
 * 直接调用引擎，只验证实例/节点状态，不宣称商品价格写入或 HTTP 验收。
 * 全部合成用户、流程、实例与节点在同一事务中创建，结束一律回滚；
 * 不清空任何全局审批配置。要求显式的本机独立测试库环境。
 */
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const engine = require('../backend/src/engine/approvalEngine')

async function main() {
  let conn
  try {
    conn = await pool.getConnection()
    await conn.beginTransaction()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const users = []
    for (const label of ['applicant', 'first', 'second']) {
      const [result] = await conn.query(
        'INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active,allow_self_approve) VALUES (?,?,?,3,?,1,0)',
        [`af_${label}_${suffix}`, 'synthetic-disabled-login', `审批回归${label}`, '合成审批人'],
      )
      users.push({ userId: Number(result.insertId), roleId: 3, realName: `审批回归${label}` })
    }
    const [applicant, first, second] = users
    // 精确金额区间不改动既有配置；resolveFlow 按最大下限命中本轮流程。
    const amount = 987654321
    const flowName = `合成审批回归-${suffix}`
    const [flow] = await conn.query(
      'INSERT INTO approval_flows (biz_type,name,min_amount,max_amount,is_active) VALUES (?,?,?,?,1)',
      ['product_price', flowName, amount, amount],
    )
    for (const [index, operator] of [first, second].entries()) {
      await conn.query(
        'INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,user_id) VALUES (?,?,3,?)',
        [flow.insertId, index + 1, operator.userId],
      )
    }
    let bizId = 1000000000
    async function start() {
      const result = await engine.startApproval(conn, {
        bizType: 'product_price', bizId: ++bizId, amount,
        applicantId: applicant.userId, applicantName: applicant.realName,
      })
      assert.equal(result.flowName, flowName, '必须仅命中本轮合成审批流')
      assert.equal(result.totalSteps, 2)
      return result.instanceId
    }
    const id = await start()
    await assert.rejects(() => engine.approveStep(conn, { instanceId: id, operator: applicant }), error => error.statusCode === 403)
    await assert.rejects(() => engine.approveStep(conn, { instanceId: id, operator: second }), error => error.code === 'APPROVAL_NOT_ASSIGNED')
    const firstResult = await engine.approveStep(conn, { instanceId: id, operator: first })
    assert.equal(firstResult.status, engine.INSTANCE_STATUS.PENDING)
    assert.equal(firstResult.currentStep, 2)
    await assert.rejects(() => engine.approveStep(conn, { instanceId: id, operator: first }), error => error.statusCode === 403)
    assert.equal((await engine.approveStep(conn, { instanceId: id, operator: second })).status, engine.INSTANCE_STATUS.APPROVED)
    await assert.rejects(() => engine.approveStep(conn, { instanceId: id, operator: second }), error => error.code === 'APPROVAL_FINISHED')

    const rejected = await start()
    await assert.rejects(() => engine.rejectStep(conn, { instanceId: rejected, operator: first, comment: '' }), error => error.statusCode === 400)
    assert.equal((await engine.rejectStep(conn, { instanceId: rejected, operator: first, comment: '合成预算不足' })).status, engine.INSTANCE_STATUS.REJECTED)
    const [[row]] = await conn.query('SELECT reject_reason FROM approval_instances WHERE id=?', [rejected])
    assert.equal(row.reject_reason, '合成预算不足')

    const cancelled = await start()
    await assert.rejects(() => engine.cancelInstance(conn, { instanceId: cancelled, operator: first }), error => error.statusCode === 403)
    assert.equal((await engine.cancelInstance(conn, { instanceId: cancelled, operator: applicant })).status, engine.INSTANCE_STATUS.CANCELLED)
    const [[pending]] = await conn.query('SELECT COUNT(*) AS n FROM approval_instance_tasks WHERE instance_id=? AND status=1', [cancelled])
    assert.equal(Number(pending.n), 0)
    assert.equal(await engine.startApproval(conn, {
      bizType: `smoke_unconfigured_${suffix}`, bizId: 1, amount: 1,
      applicantId: applicant.userId, applicantName: applicant.realName,
    }), null)
    console.log('共享审批引擎通过：两级推进、越权/重复拒绝、驳回、撤销、无匹配；合成数据回滚。')
  } finally {
    if (conn) { await conn.rollback(); conn.release() }
    await pool.end()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
