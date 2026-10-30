'use strict'
require('./helpers/testEnvironment').configureTestEnvironment()
const assert = require('node:assert/strict')
const { prepareSmokeContext, login, createPurchaseOrder, confirmPurchaseOrder, createInboundTaskFromPurchase, randomRef } = require('./helpers/smokeTestKit')
async function main() {
  const ctx = await prepareSmokeContext()
  const { http, pool, warehouse, supplier, product, location } = ctx
  const ok = (r, label) => assert.ok(r.ok && r.data?.success, `${label}: ${r.status} ${JSON.stringify(r.data)}`)
  try {
    const auth = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    assert.ok(auth.token)
    const token = auth.token
    // Synthetic historical snapshot only: no application path creates a retired request.
    const [pr] = await pool.query('INSERT INTO purchase_requisitions(requisition_no,title,warehouse_id,warehouse_name,applicant_id,applicant_name,status) VALUES(?,?,?,?,?,?,3)', [randomRef('OLDPR'), '合成历史来源', warehouse.id, warehouse.name, auth.user.id, '合成历史申请人'])
    const prId = pr.insertId
    const [[before]] = await pool.query('SELECT * FROM purchase_requisitions WHERE id=?', [prId])
    const endpoints = [['get',''],['get',`/${prId}`],['post',''],['put',`/${prId}`],...['submit','withdraw','cancel','approve','reject','convert'].map(action=>['post',`/${prId}/${action}`])]
    for (const [method, suffix] of endpoints) {
      const r = await http[method](`/api/purchase-requisitions${suffix}`, { token, json: method === 'get' ? undefined : { reason: '合成测试', lines: [] } })
      assert.equal(r.status, 404, `${method} ${suffix}: ${JSON.stringify(r.data)}`)
      assert.equal(r.data?.success, false)
      assert.equal(r.data?.message, '接口不存在')
      console.log(`PASS ${method.toUpperCase()} /api/purchase-requisitions${suffix} -> 404, 接口不存在`)
    }
    const po = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: 2 })
    ok(po, '采购创建')
    const purchaseId = Number(po.data.data.id)
    await pool.query('UPDATE purchase_orders SET source_requisition_id=? WHERE id=?', [prId, purchaseId])
    ok(await http.get(`/api/purchase/${purchaseId}`, { token }), '历史来源采购只读详情')
    ok(await confirmPurchaseOrder(http, token, purchaseId), '历史来源采购确认')
    const task = await createInboundTaskFromPurchase(http, token, purchaseId)
    ok(task, '历史来源采购生成收货')
    const taskId = Number(task.data.data.taskId)
    ok(await http.post(`/api/inbound-tasks/${taskId}/submit`, { token }), '提交收货')
    ok(await http.post(`/api/inbound-tasks/${taskId}/receive`, { token, headers: ctx.pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty: 2 }] } }), '合成PDA收货')
    const containers = await http.get(`/api/inbound-tasks/${taskId}/containers`, { token })
    ok(containers, '容器读取')
    const pending = containers.data.data.waiting?.[0] || containers.data.data.list?.[0]
    assert.ok(pending)
    ok(await http.post(`/api/inbound-tasks/${taskId}/putaway`, { token, headers: ctx.pdaHeaders(), json: { containerId: Number(pending.id), locationId: Number(location.id) } }), '合成PDA上架')
    const [[after]] = await pool.query('SELECT * FROM purchase_requisitions WHERE id=?', [prId])
    assert.deepEqual(after, before, '历史申请保持原始快照')
    const [[saved]] = await pool.query('SELECT source_requisition_id,status FROM purchase_orders WHERE id=?', [purchaseId])
    assert.equal(Number(saved.source_requisition_id), prId)
    assert.equal(Number(saved.status), 3)
    const [[stock]] = await pool.query('SELECT quantity FROM inventory_stock WHERE warehouse_id=? AND product_id=?', [warehouse.id, product.id])
    assert.equal(Number(stock.quantity), 2)
    console.log('PASS 历史source_requisition_id采购详情、确认、收货、上架、完成；原申请快照及采购来源ID保留，库存=2')
  } finally {
    await ctx.close()
    await require('../backend/src/config/db').pool.end()
  }
}
main().catch(e => { console.error(e); process.exitCode=1 })
