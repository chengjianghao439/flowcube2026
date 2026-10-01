'use strict'
// Real purchase -> PDA receive -> putaway supplies stock. Business evidence is retained by exact IDs.
const assert = require('node:assert/strict')
require('./helpers/testEnvironment').validateTestEnvironment()
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { pool } = require('../backend/src/config/db')
const app = require('../backend/src/app')
const ref = `KST-${randomUUID().slice(0, 8)}`
const fixture = { ref, products: [], kits: [], containers: [] }
let server, post
const q = async (sql, params = []) => (await pool.query(sql, params))[0]
const insert = async (sql, params) => Number((await q(sql, params)).insertId)
async function main() {
  try {
    fixture.userId = await insert('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,\'!\',?,1,\'测试\',1)', [ref, ref])
    const token = require('../backend/node_modules/jsonwebtoken').sign({ userId: fixture.userId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '10m' })
    fixture.warehouseId = await insert('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [ref, ref])
    fixture.locationId = await insert('INSERT INTO warehouse_locations (warehouse_id,code,name) VALUES (?,?,?)', [fixture.warehouseId, ref, ref])
    fixture.supplierId = await insert('INSERT INTO supply_suppliers (code,name) VALUES (?,?)', [ref, ref])
    fixture.customerId = await insert('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,NULL)', [ref, ref])
    for (const [name, price] of [['铰链', 80], ['螺钉', 5]]) fixture.products.push(await insert('INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,\'个\',?,1,0)', [`${ref}-${fixture.products.length}`, `${ref}-${name}`, price]))
    const secret = randomUUID()
    fixture.deviceId = await insert("INSERT INTO pda_devices (device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)", [ref, ref, fixture.warehouseId, require('../backend/node_modules/bcryptjs').hashSync(secret, 4)])
    const session = await require('../backend/src/modules/pda/pda.sessions.service').createSession({ deviceCode: ref, deviceSecret: secret, userId: fixture.userId })
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject) })
    post = async (path, body = {}, pda = false) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Request-Key': randomUUID(), ...(pda ? { 'X-Client': 'pda', 'X-PDA-Session': session.sessionToken } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
      const json = await response.json()
      assert.ok(response.ok, `${response.status} ${JSON.stringify(json)}`)
      return json.data
    }
    const po = await post('/purchase', { supplierId: fixture.supplierId, supplierName: ref, warehouseId: fixture.warehouseId, warehouseName: ref, items: fixture.products.map((id, i) => ({ productId: id, productCode: `${ref}-${i}`, productName: `${ref}-${i}`, unit: '个', quantity: i ? 8 : 1, unitPrice: 1 })) })
    fixture.purchaseId = po.id
    await post(`/purchase/${po.id}/confirm`)
    const task = await post('/inbound-tasks', { poId: po.id })
    fixture.inboundTaskId = task.taskId
    await post(`/inbound-tasks/${task.taskId}/submit`)
    for (const [i, productId] of fixture.products.entries()) {
      const received = await post(`/inbound-tasks/${task.taskId}/receive`, { productId, packages: [{ qty: i ? 8 : 1 }] }, true)
      for (const container of received.containers) { fixture.containers.push(container.containerId); await post(`/inbound-tasks/${task.taskId}/putaway`, { containerId: container.containerId, locationId: fixture.locationId }, true) }
    }
    for (const price of [100, 200]) {
      const kit = await post('/kits', { code: `${ref}-${price}`, name: `${ref}-${price}`, referenceUnitPrice: price, components: fixture.products.map((productId, i) => ({ productId, baseQty: i ? 4 : 1 })) })
      fixture.kits.push({ id: kit.id, versionId: kit.currentVersionId })
    }
    const snapshot = async () => ({
      stock: await q('SELECT * FROM inventory_stock WHERE product_id IN (?) ORDER BY id', [fixture.products]),
      containers: await q('SELECT * FROM inventory_containers WHERE id IN (?) ORDER BY id', [fixture.containers]),
      reservations: await q('SELECT * FROM stock_reservations WHERE product_id IN (?) ORDER BY id', [fixture.products]),
      logs: await q('SELECT * FROM inventory_logs WHERE product_id IN (?) ORDER BY id', [fixture.products]),
      ap: await q('SELECT * FROM payment_records WHERE type=1 AND order_id IN (?) ORDER BY id', [[fixture.purchaseId, fixture.decimalPurchaseId].filter(Boolean)]),
      sales: await q('SELECT * FROM sale_orders WHERE customer_id=? ORDER BY id', [fixture.customerId]),
    })
    const before = await snapshot()
    assert.equal(Number(before.ap[0]?.total_amount), 9, '采购真实收货结算基线须存在')
    const groups = fixture.kits.map((k, i) => ({ kind: 'kit', lineKey: String(i), kitVersionId: k.versionId, quantity: 1, priceSource: 'kit_default' }))
    for (const g of groups) {
      const one = await post('/kits/preview', { customerId: fixture.customerId, warehouseId: fixture.warehouseId, groups: [g] })
      assert.equal(one.canFulfillEntireVector, true, '每种套独立均有1套现货参考')
    }
    const together = await post('/kits/preview', { customerId: fixture.customerId, warehouseId: fixture.warehouseId, groups })
    assert.equal(together.canFulfillEntireVector, false, '共享1只铰链不能承诺两套同时有现货')
    assert.deepEqual(together.physicalItems.map(p => [p.quantity, p.amount, p.inventory.quantity, p.inventory.shortage]), [[2, 240, 1, 1], [8, 60, 8, 0]])
    assert.equal(together.amount, 300)
    assert.deepEqual(await snapshot(), before, '预览不得更改库存、预占、库存日志、采购应付、销售订单')
    console.log('[PASS] 真实采购/PDA收货上架：两个单套均有现货参考，整向量共享缺件；预览零业务写入')
    // Keep this fractional fixture separate from the original two-product commercial groups.
    fixture.decimalProductId = await insert('INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,\'个\',10,1,1)', [`${ref}-D`, `${ref}-小数商品`])
    fixture.products.push(fixture.decimalProductId)
    const decimalPurchase = await post('/purchase', { supplierId: fixture.supplierId, supplierName: ref, warehouseId: fixture.warehouseId, warehouseName: ref, items: [{ productId: fixture.decimalProductId, productCode: `${ref}-D`, productName: `${ref}-小数商品`, unit: '个', quantity: 1, unitPrice: 1 }] })
    fixture.decimalPurchaseId = decimalPurchase.id
    await post(`/purchase/${decimalPurchase.id}/confirm`)
    const decimalTask = await post('/inbound-tasks', { poId: decimalPurchase.id })
    fixture.decimalInboundTaskId = decimalTask.taskId
    await post(`/inbound-tasks/${decimalTask.taskId}/submit`)
    const decimalReceived = await post(`/inbound-tasks/${decimalTask.taskId}/receive`, { productId: fixture.decimalProductId, packages: [{ qty: 0.3 }] }, true)
    for (const container of decimalReceived.containers) {
      fixture.containers.push(container.containerId)
      await post(`/inbound-tasks/${decimalTask.taskId}/putaway`, { containerId: container.containerId, locationId: fixture.locationId }, true)
    }
    const closed = await post(`/inbound-tasks/${decimalTask.taskId}/close-receiving`)
    assert.equal(closed.status, 4, '合法短收结案须完成实收结算')
    const decimalAP = await q('SELECT total_amount FROM payment_records WHERE type=1 AND order_id=?', [decimalPurchase.id])
    assert.equal(Number(decimalAP[0]?.total_amount), 0.3, '小数实收应付基线须存在')
    const decimalKit = await post('/kits', { code: `${ref}-D`, name: `${ref}-小数套`, referenceUnitPrice: 1, components: [{ productId: fixture.decimalProductId, baseQty: 0.1 }] })
    fixture.decimalKit = { id: decimalKit.id, versionId: decimalKit.currentVersionId }
    const finderSets = async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/kits/finder?warehouseId=${fixture.warehouseId}&keyword=${ref}-D`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
      const json = await response.json()
      assert.ok(response.ok, `${response.status} ${JSON.stringify(json)}`)
      const kit = json.data.list.find(k => k.id === decimalKit.id)
      assert.ok(kit, 'finder须返回当前夹具套件')
      return kit.standaloneCompleteSetsByCurrentStock
    }
    const unreservedSets = await finderSets()
    const sale = await post('/sale', { customerId: fixture.customerId, customerName: ref, warehouseId: fixture.warehouseId, warehouseName: ref, items: [{ productId: fixture.decimalProductId, productCode: `${ref}-D`, productName: `${ref}-小数商品`, unit: '个', quantity: 0.2, unitPrice: 1, priceSource: 'manual' }] })
    fixture.decimalSaleId = sale.id
    const [saleItem] = await q('SELECT id FROM sale_order_items WHERE order_id=?', [sale.id])
    await post(`/sale/${sale.id}/reserve`, { items: [{ id: saleItem.id, warehouseId: fixture.warehouseId, warehouseName: ref, qty: 0.2 }] })
    const [stock] = await q('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [fixture.decimalProductId, fixture.warehouseId])
    assert.deepEqual([Number(stock.quantity), Number(stock.reserved)], [0.3, 0.2], '真实收货上架与销售预占基线')
    const decimalBefore = await snapshot()
    const reservedSets = await finderSets()
    const decimalPreview = await post('/kits/preview', { customerId: fixture.customerId, warehouseId: fixture.warehouseId, groups: [{ kind: 'kit', lineKey: 'decimal', kitVersionId: decimalKit.currentVersionId, quantity: 1, priceSource: 'kit_default' }] })
    assert.equal(decimalPreview.canFulfillEntireVector, true)
    assert.equal(decimalPreview.physicalItems[0].inventory.shortage, 0)
    assert.deepEqual(await snapshot(), decimalBefore, '小数finder/预览不得更改库存、预占或业务事实')
    assert.deepEqual([unreservedSets, reservedSets], [3, 1], 'finder百分单位：0.30/0.10=3；(0.30-0.20)/0.10=1，须与预览一致')
    console.log('[PASS] 真实小数收货0.30/销售预占0.20：finder无预占3套、有预占1套，与预览零缺量一致')
  } finally {
    fs.writeFileSync(`/tmp/flowcube-kits-stock-${ref}.json`, JSON.stringify(fixture, null, 2), { mode: 0o600 })
    try {
      try {
        if (fixture.decimalSaleId) {
          await post(`/sale/${fixture.decimalSaleId}/cancel`)
          const [stock] = await q('SELECT reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [fixture.decimalProductId, fixture.warehouseId])
          assert.equal(Number(stock.reserved), 0, '退出前合法取消本轮销售单须释放其预占')
        }
      } finally {
        try {
          if (fixture.deviceId) { await q('DELETE FROM pda_device_sessions WHERE device_id=?', [fixture.deviceId]); await q('DELETE FROM pda_devices WHERE id=?', [fixture.deviceId]) }
        } finally {
          if (fixture.userId) await q('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?', [fixture.userId])
        }
      }
    } finally {
      try { if (server) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) } finally { await pool.end() }
    }
    console.log(`[fixtures] /tmp/flowcube-kits-stock-${ref}.json (owned business facts retained; test user disabled; device removed; server/pool closed)`)
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
