'use strict'

/**
 * 改价审批「历史旧价」回归（2026-09-27 P8 修复）。
 *
 * 规则：`product_price_history.old_price` 必须是**审批通过瞬间的真实当前价**；
 * `price_change_requests.old_price` 保留为**申请时的展示快照**（两者语义不同，不要互相替代）。
 * `product_items` 仍按审批通过写入 `new_price`（保留"审批覆盖价格"的现有语义）。
 *
 * 回归场景（修复前会红）：申请时 old=100 → 期间主档被改到 120 → 本申请审批为 110
 *   ⇒ product_items = 110（不变）
 *   ⇒ 本次审批写入的 history 行必须是 **120 → 110**（修复前会错记 100 → 110）
 * 同时断言：审批单停在已批准、且 `price_change_requests.old_price` 仍保持 100（申请时快照语义不变）。
 * 本用例**不**断言手工改价写出的历史——手工改价路径（`products.update`）的存在性在持续记录 §9.3 静态核实。
 *
 * 必须跑在显式回环独立测试库。运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-pricechange-downloads node tests/price-change-history-oldprice.smoke.test.js
 */

const path = require('path')
const assert = require('node:assert/strict')
const { prepareSmokeContext, randomRef } = require('./helpers/smokeTestKit')

const ROOT = path.resolve(__dirname, '..')

async function main() {
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  const price = require(path.join(ROOT, 'backend/src/modules/price-change/price-change.service'))
  const suffix = randomRef('PCX')

  const created = { flowIds: [], requestIds: [], productIds: [] }
  let passed = 0
  let failed = 0
  const check = async (title, fn) => {
    try { await fn(); passed += 1; console.log(`  [PASS] ${title}`) }
    catch (e) { failed += 1; console.error(`  [FAIL] ${title}: ${e.message}`) }
  }

  // 不硬编码 userId：smoke_admin 的实际 ID 由查询取得（不保证为 1）
  const [[adminRow]] = await pool.query("SELECT id FROM sys_users WHERE username='smoke_admin' LIMIT 1")
  assert.ok(adminRow?.id, '需要 smoke_admin')
  const [[approverRow]] = await pool.query("SELECT id FROM sys_users WHERE username='smoke_limited' LIMIT 1")
  assert.ok(approverRow?.id, '需要 smoke_limited 作为审批人（engine 会排除申请人本人）')
  const admin = { roleId: 1, userId: adminRow.id, operatorId: adminRow.id, realName: 'smoke_admin' }
  // 共享夹具：记录 smoke_limited 的自批授权**原值**，收尾按原值恢复（不要无条件写 0 污染共享夹具）
  const [[sa]] = await pool.query('SELECT allow_self_approve FROM sys_users WHERE id=?', [approverRow.id])
  const selfApproveOriginal = Number(sa?.allow_self_approve) === 1 ? 1 : 0
  // 流程节点实际指定的是 smoke_limited：审批动作必须由**它**执行，不能拿超管自批
  // （那会在补上自批内控后被挡，属测试误护旧行为）。
  const approver = { roleId: 5, userId: approverRow.id, operatorId: approverRow.id, realName: 'smoke_limited' }

  let productSeq = 0
  const mkProduct = async (saleA) => {
    productSeq += 1
    const [r] = await pool.query(
      "INSERT INTO product_items (code,name,unit,sale_price,sale_price_a,cost_price) VALUES (?,?,?,?,?,?)",
      [`${suffix}-P${productSeq}`, `PCX商品${suffix}-${productSeq}`, '件', saleA, saleA, 50],
    )
    created.productIds.push(r.insertId)
    return r.insertId
  }
  const mkFlow = async () => {
    const [f] = await pool.query(
      "INSERT INTO approval_flows (biz_type,name,min_amount,is_active) VALUES ('product_price',?,0,1)",
      [`${suffix}-FLOW`],
    )
    created.flowIds.push(f.insertId)
    // 单步、按用户指定审批人：`approver_type=3`（APPROVER_TYPE.USER；写 1 是 ROLE，会被当成"按角色找人"而选不到）。
    // 审批人必须**不是申请人本人**（引擎默认排除申请人），故用 smoke_limited。
    await pool.query(
      'INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,user_id) VALUES (?,1,3,?)',
      [f.insertId, approverRow.id],
    )
    return f.insertId
  }

  try {
    await mkFlow()
    const pid = await mkProduct(100)

    await check('申请创建：request.old_price 记的是申请时刻的 100（展示快照）', async () => {
      const req = await price.create({ productId: pid, priceType: 'a', newPrice: 110 }, admin)
      created.requestIds.push(req.id)
      const [[row]] = await pool.query('SELECT old_price,new_price,status FROM price_change_requests WHERE id=?', [req.id])
      assert.equal(Number(row.old_price), 100, '申请时的 old_price 快照')
      assert.equal(Number(row.new_price), 110)
      assert.equal(Number(row.status), 1, '应停在待审批')
      await price.submit(req.id, admin)
    })

    const reqId = created.requestIds[created.requestIds.length - 1]

    // 期间主档被改到 120。这里**直接改主档**、不经 products.update——本用例只验证
    // 「审批写入的历史旧价是否为审批瞬间的当前价」；手工改价路径本身（会写手工 history）
    // 的存在性已在持续记录 §9.3 静态核实，不在本用例断言范围内。
    await pool.query('UPDATE product_items SET sale_price_a=120 WHERE id=?', [pid])

    await check('审批通过：商品价按 new_price 覆盖为 110', async () => {
      const r = await price.approve(reqId, approver)
      assert.ok(r, '审批应成功')
      const [[p]] = await pool.query('SELECT sale_price_a FROM product_items WHERE id=?', [pid])
      assert.equal(Number(p.sale_price_a), 110, '审批覆盖价格语义应保留')
    })

    await check('★ 本次审批写入的历史旧价必须是审批瞬间的真实当前价 120（修复前会是 100）', async () => {
      const [[h]] = await pool.query(
        "SELECT old_price,new_price FROM product_price_history WHERE product_id=? AND change_source='approval' ORDER BY id DESC LIMIT 1",
        [pid],
      )
      assert.ok(h, '应写入一条审批来源的历史')
      assert.equal(Number(h.new_price), 110)
      assert.equal(
        Number(h.old_price), 120,
        `审批瞬间的当前价是 120，历史旧价必须记 120（记 100 即为申请时快照，属旧价失真）`,
      )
    })

    await check('★ 超管未授予自批时自批改价必须 403', async () => {
      const [[adminSA]] = await pool.query('SELECT allow_self_approve FROM sys_users WHERE id=?', [adminRow.id])
      assert.equal(Number(adminSA?.allow_self_approve) === 1, false, '前置：超管当前不得已开启自批')
      const pid3 = await mkProduct(100)
      const req3 = await price.create({ productId: pid3, priceType: 'a', newPrice: 110 }, admin)
      created.requestIds.push(req3.id)
      await price.submit(req3.id, admin)
      let code = null
      try { await price.approve(req3.id, admin) } catch (e) { code = e.code }
      assert.equal(code, 'SELF_APPROVAL_DENIED', `超管自批应被拒，实际 ${code ?? '被放行'}`)
    })

    await check('★ 授予→提交→撤销后自批必须 403，且申请/实例保持待审批', async () => {
      await pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?', [approverRow.id])
      try {
        const pid4 = await mkProduct(100)
        const applicant = { roleId: 5, userId: approverRow.id, operatorId: approverRow.id, realName: 'smoke_limited' }
        const req4 = await price.create({ productId: pid4, priceType: 'a', newPrice: 110 }, applicant)
        created.requestIds.push(req4.id)
        await price.submit(req4.id, applicant) // 授予期内提交 ⇒ 快照含本人
        await pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?', [approverRow.id]) // 撤销
        let code = null
        try { await price.approve(req4.id, applicant) } catch (e) { code = e.code }
        assert.equal(code, 'SELF_APPROVAL_DENIED', `撤销后自批应被拒，实际 ${code ?? '被放行'}`)
        const [[r4]] = await pool.query('SELECT status FROM price_change_requests WHERE id=?', [req4.id])
        assert.equal(Number(r4.status), 1, '被拒后申请必须仍是待审批')
      } finally {
        await pool.query('UPDATE sys_users SET allow_self_approve=? WHERE id=?', [selfApproveOriginal, approverRow.id])
      }
    })

    await check('★ A 创建、B 提交：A 与 B 各自自批都必须 403（两个身份都要收口）', async () => {
      const pid5 = await mkProduct(100)
      // 创建人 A = smoke_limited（同时是流程节点的审批人，故在快照里）
      const applicantA = approver
      const req5 = await price.create({ productId: pid5, priceType: 'a', newPrice: 110 }, applicantA)
      created.requestIds.push(req5.id)
      // 提交人 B = 超管 admin（与创建人不同人；引擎实例的 applicantId = B）
      await price.submit(req5.id, admin)
      const [[inst5]] = await pool.query(
        "SELECT id, applicant_id, status FROM approval_instances WHERE biz_type='product_price' AND biz_id=? ORDER BY id DESC LIMIT 1",
        [req5.id],
      )
      assert.equal(Number(inst5.applicant_id), adminRow.id, '前置：实例申请人应为提交人 B')
      let codeA = null
      try { await price.approve(req5.id, applicantA) } catch (e) { codeA = e.code }
      assert.equal(codeA, 'SELF_APPROVAL_DENIED', `创建人 A 自批应被拒，实际 ${codeA ?? '被放行'}`)
      let codeB = null
      try { await price.approve(req5.id, admin) } catch (e) { codeB = e.code }
      assert.equal(codeB, 'SELF_APPROVAL_DENIED', `提交人 B 自批应被拒（只挡 A 不够），实际 ${codeB ?? '被放行'}`)
      // 状态未被破坏：申请仍待审批、实例仍进行中、商品价与历史未变
      // reject 路径同样必须收口（与 approve 同一安全单元）：两个身份各自驳回都要被挡
      let rejA = null
      try { await price.reject(req5.id, { reason: '测试', operator: applicantA }) } catch (e) { rejA = e.code }
      assert.equal(rejA, 'SELF_APPROVAL_DENIED', `创建人 A 自驳回应被拒，实际 ${rejA ?? '被放行'}`)
      let rejB = null
      try { await price.reject(req5.id, { reason: '测试', operator: admin }) } catch (e) { rejB = e.code }
      assert.equal(rejB, 'SELF_APPROVAL_DENIED', `提交人 B 自驳回应被拒（只挡 A 不够），实际 ${rejB ?? '被放行'}`)
      const [[inst5c]] = await pool.query('SELECT status FROM approval_instances WHERE id=?', [inst5.id])
      assert.equal(Number(inst5c.status), 1, 'reject 被拒后审批实例必须仍是进行中')
      const [[r5]] = await pool.query('SELECT status FROM price_change_requests WHERE id=?', [req5.id])
      assert.equal(Number(r5.status), 1, '两次被拒后申请必须仍是待审批')
      const [[inst5b]] = await pool.query('SELECT status FROM approval_instances WHERE id=?', [inst5.id])
      assert.equal(Number(inst5b.status), 1, '审批实例必须仍是进行中')
      const [[p5]] = await pool.query('SELECT sale_price_a FROM product_items WHERE id=?', [pid5])
      assert.equal(Number(p5.sale_price_a), 100, '商品价必须未被改动')
      const [[h5]] = await pool.query("SELECT COUNT(*) n FROM product_price_history WHERE product_id=? AND change_source='approval'", [pid5])
      assert.equal(Number(h5.n), 0, '不得写入审批历史')
    })

    await check('★ 商品在审批期间被软删：必须 409 回滚，不得留下「已批准却未改价」', async () => {
      const pid2 = await mkProduct(100)
      const req2 = await price.create({ productId: pid2, priceType: 'a', newPrice: 110 }, admin)
      created.requestIds.push(req2.id)
      await price.submit(req2.id, admin)
      // 绕过正常引用保护，模拟异常/历史数据：审批期间商品被软删
      await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=?', [pid2])

      let code = null
      try { await price.approve(req2.id, approver) } catch (e) { code = e.code }
      assert.equal(code, 'PRICE_CHANGE_PRODUCT_MISSING', `应 fail-loud 抛业务错误，实际 ${code}`)

      const [[r2]] = await pool.query('SELECT status FROM price_change_requests WHERE id=?', [req2.id])
      assert.equal(Number(r2.status), 1, '回滚后申请必须仍在「待审批」，不能被置为已通过')
      const [[inst]] = await pool.query(
        "SELECT status FROM approval_instances WHERE biz_type='product_price' AND biz_id=? ORDER BY id DESC LIMIT 1",
        [req2.id],
      )
      assert.equal(Number(inst.status), 1, '审批实例必须仍是进行中（未通过）')
      const [[ph]] = await pool.query(
        "SELECT COUNT(*) n FROM product_price_history WHERE product_id=? AND change_source='approval'",
        [pid2],
      )
      assert.equal(Number(ph.n), 0, '不得写入任何伪历史')
    })

    await check('审批单状态与申请快照未被破坏', async () => {
      const [[req]] = await pool.query('SELECT status, old_price FROM price_change_requests WHERE id=?', [reqId])
      assert.equal(Number(req.status), 2, '审批通过后应为已批准')
      assert.equal(Number(req.old_price), 100, '申请时展示快照保持 100（语义不变）')
    })
  } finally {
    for (const id of created.requestIds) {
      const [insts] = await pool.query("SELECT id FROM approval_instances WHERE biz_type='product_price' AND biz_id=?", [id])
      for (const it of insts) {
        await pool.query('DELETE FROM approval_instance_task_approvers WHERE instance_id=?', [it.id])
        await pool.query('DELETE FROM approval_instance_tasks WHERE instance_id=?', [it.id])
        await pool.query('DELETE FROM approval_instances WHERE id=?', [it.id])
      }
      await pool.query('DELETE FROM product_price_history WHERE product_id IN (SELECT product_id FROM price_change_requests WHERE id=?)', [id])
      await pool.query('DELETE FROM price_change_requests WHERE id=?', [id])
    }
    for (const id of created.flowIds) {
      await pool.query('DELETE FROM approval_flow_steps WHERE flow_id=?', [id])
      await pool.query('DELETE FROM approval_flows WHERE id=?', [id])
    }
    for (const id of created.productIds) {
      await pool.query('DELETE FROM product_price_history WHERE product_id=?', [id])
      await pool.query('DELETE FROM product_items WHERE id=?', [id])
    }
    const [[left]] = await pool.query('SELECT COUNT(*) n FROM product_items WHERE code LIKE ?', [`${suffix}%`])
    console.log(`\n自洁核对：夹具残留 ${left.n}`)
    await ctx.close()
    await require(path.join(ROOT, 'backend/src/config/db')).pool.end()
    console.log(`\n${passed} passed, ${failed} failed\n`)
    process.exit(failed ? 1 : 0)
  }
}

main().catch(error => { console.error(error); process.exit(1) })
