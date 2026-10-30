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
    const stockQuantity = async productId => {
      const [[row]] = await pool.query('SELECT quantity FROM inventory_stock WHERE warehouse_id=? AND product_id=?', [warehouse.id, productId])
      return Number(row?.quantity ?? 0)
    }
    async function receiveHistoricalPurchase(product, label, expectedBefore) {
      const stockBefore = await stockQuantity(product.id)
      if (expectedBefore !== undefined) assert.equal(stockBefore, expectedBefore, `${label}: initial stock`)
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
      const stockAfter = await stockQuantity(product.id)
      assert.equal(stockAfter - stockBefore, 2, `${label}: this receipt increases stock by exactly 2`)
      const [ownedContainers] = await pool.query('SELECT id,product_id,warehouse_id,status,remaining_qty FROM inventory_containers WHERE inbound_task_id=? AND deleted_at IS NULL', [taskId])
      assert.equal(ownedContainers.length, 1, `${label}: exactly one container belongs to this task`)
      const owned = ownedContainers[0]
      assert.equal(Number(owned.id), Number(pending.id))
      assert.equal(Number(owned.product_id), Number(product.id))
      assert.equal(Number(owned.warehouse_id), Number(warehouse.id))
      assert.equal(Number(owned.status), 1, 'new container is ACTIVE')
      assert.equal(ownedContainers.reduce((sum, c) => sum + Number(c.remaining_qty), 0), 2)
      const [[taskRow]] = await pool.query('SELECT task_no FROM inbound_tasks WHERE id=?', [taskId])
      const [logs] = await pool.query("SELECT move_type,type,product_id,warehouse_id,quantity,before_qty,after_qty,ref_no,container_id FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [taskId])
      assert.equal(logs.length, 1, `${label}: exactly one inbound movement belongs to this task`)
      const movement = logs[0]
      assert.equal(Number(movement.move_type), 1, 'PURCHASE_IN')
      assert.equal(Number(movement.type), 1, 'inbound direction')
      assert.equal(Number(movement.product_id), Number(product.id))
      assert.equal(Number(movement.warehouse_id), Number(warehouse.id))
      assert.equal(Number(movement.container_id), Number(owned.id))
      assert.equal(movement.ref_no, taskRow.task_no)
      assert.equal(Number(movement.before_qty), stockBefore)
      assert.equal(Number(movement.after_qty), stockAfter)
      assert.equal(logs.reduce((sum, row) => sum + Number(row.quantity), 0), 2)
      console.log(`PASS ${label}: stock ${stockBefore}->${stockAfter}, delta=2; task=${taskId} ACTIVE container=2, inbound movement=2; historical request/source unchanged`)
    }
    // A private SKU proves zero and nonzero baselines without clearing shared inventory.
    const freshCode = randomRef('PRREMOVAL')
    const [fresh] = await pool.query('INSERT INTO product_items(code,name,unit) VALUES(?,?,?)', [freshCode, '采购申请退役独立合成商品', product.unit])
    const freshProduct = { id: fresh.insertId, code: freshCode, name: '采购申请退役独立合成商品', unit: product.unit }
    await receiveHistoricalPurchase(freshProduct, 'private SKU zero baseline', 0)
    await receiveHistoricalPurchase(freshProduct, 'private SKU nonzero baseline', 2)
    // smokeTestKit intentionally reuses a SKU/warehouse across CI suites. Add a real
    // receipt first, then prove the historical-source flow with its existing stock.
    await receiveHistoricalPurchase(product, 'shared fixture preparation')
    assert.ok(await stockQuantity(product.id) > 0, 'shared fixture has a nonzero baseline')
    await receiveHistoricalPurchase(product, 'shared fixture nonzero baseline')
  } finally {
    await ctx.close()
    await require('../backend/src/config/db').pool.end()
  }
}
main().catch(e => { console.error(e); process.exitCode=1 })
