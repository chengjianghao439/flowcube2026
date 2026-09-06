'use strict'
require('./helpers/testEnvironment').configureTestEnvironment()
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { pool } = require('../backend/src/config/db')
// This domain regression does not run background print dispatch or retention deletion.
require('../backend/src/modules/print-jobs/print-jobs.dispatch').startPrintJobSweeper = () => {}
const plan = require('../backend/src/modules/procurement/procurement.service')
const requests = require('../backend/src/modules/purchase-requisitions/purchase-requisitions.service')
const policies = require('../backend/src/modules/procurement/procurement.policies')
const { getSupplyRows } = require('../backend/src/modules/inventory/inventory.procurement')
const containers = require('../backend/src/engine/containerEngine')
const purchase = require('../backend/src/modules/purchase/purchase.service')
const insert = async (sql, params) => (await pool.query(sql, params))[0].insertId

test.after(() => pool.end())
test('real DB: concurrent plan generation, PR coverage, conversion and cancellation preserve one supply commitment', async () => {
  const suffix = 'PP' + crypto.randomBytes(5).toString('hex')
  const warehouseId = await insert('INSERT INTO inventory_warehouses(code,name) VALUES(?,?)', [suffix, suffix])
  const supplierId = await insert('INSERT INTO supply_suppliers(code,name) VALUES(?,?)', [suffix, suffix])
  const productId = await insert('INSERT INTO product_items(code,name,unit,supplier_id) VALUES(?,?,?,?)', [suffix, suffix, '件', supplierId])
  const salesId = await insert('INSERT INTO sale_orders(order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES(?,1,?,?,?,1,?)', [suffix, suffix, warehouseId, suffix, suffix])
  await insert('INSERT INTO sale_order_items(order_id,product_id,product_code,product_name,unit,quantity,warehouse_id) VALUES(?,?,?,?,?,73,?)', [salesId, productId, suffix, suffix, '件', warehouseId])
  const operator = { userId: 1, realName: '测试采购员', operatorId: 1, operatorName: '测试采购员', roleId: 1, warehouseIds: [warehouseId] }
  const options = { warehouseId, scopeWarehouseIds: [warehouseId], operator }
  try {
    await policies.savePolicy({ productId, supplierId, entryUnit: '件', packMultiple: 12, minimumOrderQty: 100 })
    const r = (await getSupplyRows(options)).list.find(i => i.productId === productId)
    assert.equal(r.confirmedDemand, 73); assert.equal(r.suggestedQty, 108); assert.equal(r.excessQty, 35)
    const race = await Promise.allSettled([plan.generatePlan({ ...options, requestKey: suffix + '-1' }), plan.generatePlan({ ...options, requestKey: suffix + '-2' })])
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(race.find(r => r.status === 'rejected').reason.statusCode, 409)
    const generated = race.find(r => r.status === 'fulfilled').value
    const reqBody = { warehouseId, source: 'replenishment', items: [{ productId, quantity: 108, suggestedSupplierId: supplierId }] }
    await assert.rejects(requests.create({ ...reqBody, requestKey: suffix + '-pr0' }, operator), e => e.statusCode === 409)
    await plan.cancel(generated.id, [warehouseId])
    const req = await requests.create({ ...reqBody, requestKey: suffix + '-pr1' }, operator)
    await assert.rejects(plan.generatePlan({ ...options, requestKey: suffix + '-3' }), e => e.statusCode === 409)
    await requests.cancel(req.id, operator)
    const next = await plan.generatePlan({ ...options, requestKey: suffix + '-4' })
    const detail = await plan.getPlan(next.id, [warehouseId])
    assert.equal(detail.items[0].expectedArrival, detail.items[0].supplySnapshot.expectedArrival)
    const converted = await plan.convert(next.id, { itemIds: detail.items.map(i => i.id), operator, scopeWarehouseIds: [warehouseId], requestKey: suffix + '-convert' })
    const row = (await getSupplyRows(options)).list.find(i => i.productId === productId)
    assert.equal(row.planCoverage || 0, 0); assert.equal(row.requisitionCoverage || 0, 0); assert.equal(row.draftCoverage, 108)
    await assert.rejects(plan.generatePlan({ ...options, requestKey: suffix + '-5' }), e => e.statusCode === 409)
    await purchase.cancel(converted.createdOrders[0].purchaseOrderId, operator, [warehouseId])
    const final = await plan.generatePlan({ ...options, requestKey: suffix + '-6' })
    assert.ok(final.id)
    await plan.cancel(final.id, [warehouseId])
    await policies.savePolicy({ productId, supplierId, entryUnit: '件', packMultiple: 12, minimumOrderQty: 0 })
    const reducePlan = await plan.generatePlan({ ...options, requestKey: suffix + '-reduce' })
    const reduceItems = (await plan.getPlan(reducePlan.id, [warehouseId])).items
    await plan.updatePlanItem(reducePlan.id, reduceItems[0].id, { adjustedQty: 60 }, [warehouseId])
    const remainder = (await getSupplyRows(options)).list.find(i => i.productId === productId)
    assert.equal(remainder.netRequirement, 13); assert.equal(remainder.suggestedQty, 24)
    await plan.cancel(reducePlan.id, [warehouseId])
    const approved = await requests.create({ ...reqBody, items: [{ productId, quantity: 84, suggestedSupplierId: supplierId }], requestKey: suffix + '-approved' }, operator)
    // This test isolates conversion; approval state-machine regression lives in existing PR tests.
    await pool.query('UPDATE purchase_requisitions SET status=3 WHERE id=?', [approved.id])
    const [[requestItem]] = await pool.query('SELECT id FROM purchase_requisition_items WHERE requisition_id=?', [approved.id])
    const approvedConversion = await requests.convert(approved.id, { lines: [{ requisitionItemId: requestItem.id, quantity: 84, supplierId, unitPrice: 1 }], requestKey: suffix + '-pr-convert' }, operator)
    const afterPR = (await getSupplyRows(options)).list.find(i => i.productId === productId)
    assert.equal(afterPR.requisitionCoverage || 0, 0); assert.equal(afterPR.draftCoverage, 84)
    await purchase.cancel(approvedConversion.createdOrders[0].id, operator, [warehouseId])
  } finally {
    // Keep source documents as inspectable evidence in this dedicated disposable test DB.
    await pool.query('UPDATE sale_orders SET deleted_at=NOW() WHERE id=?', [salesId])
    await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=?', [productId])
    await pool.query('UPDATE inventory_warehouses SET deleted_at=NOW() WHERE id=?', [warehouseId])
    await pool.query('UPDATE supply_suppliers SET deleted_at=NOW() WHERE id=?', [supplierId])
  }
})

test('real DB: ACTIVE projection ignores cache drift and scope protects transfer candidate quantities', async () => {
  const suffix = 'PA' + crypto.randomBytes(5).toString('hex')
  const wh = []
  for (let i = 0; i < 3; i++) wh.push(await insert('INSERT INTO inventory_warehouses(code,name) VALUES(?,?)', [suffix + i, suffix + i]))
  const productId = await insert('INSERT INTO product_items(code,name,unit) VALUES(?,?,?)', [suffix, suffix, '件'])
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const warehouseId of wh.slice(1)) {
      await containers.lockStockDimension(conn, productId, warehouseId)
      await containers.createContainer(conn, { productId, warehouseId, initialQty: 100, unit: '件', sourceType: 'transfer', sourceRefId: 1 })
      await containers.syncStockFromContainers(conn, productId, warehouseId)
    }
    await conn.query('INSERT INTO inventory_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,?,999,0)', [productId, wh[0]])
    await conn.query('INSERT INTO product_stock_policies(product_id,warehouse_id,safety_stock,reorder_point,target_stock) VALUES(?,?,0,73,73),(?,?,20,0,20)', [productId, wh[0], productId, wh[1]])
    await conn.commit()
    const rows = (await getSupplyRows({ mode: 'replenishment', warehouseId: wh[0], scopeWarehouseIds: wh.slice(0, 2) })).list
    const r = rows.find(i => i.productId === productId)
    assert.equal(r.onHand, 0); assert.equal(r.suggestedQty, 73)
    assert.equal(r.transferCandidates.length, 1); assert.equal(r.transferCandidates[0].warehouseId, wh[1]); assert.equal(r.transferCandidates[0].quantity, 73)
  } finally {
    await conn.rollback(); conn.release()
    await pool.query('UPDATE inventory_warehouses SET deleted_at=NOW() WHERE id IN (?)', [wh])
    await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=?', [productId])
  }
})

test('real DB: fully bound expected purchase still covers demand and retains unknown/late date evidence', async () => {
  const suffix = 'PD' + crypto.randomBytes(5).toString('hex')
  const warehouseId = await insert('INSERT INTO inventory_warehouses(code,name) VALUES(?,?)', [suffix, suffix])
  const productId = await insert('INSERT INTO product_items(code,name,unit) VALUES(?,?,?)', [suffix, suffix, '件'])
  const salesId = await insert('INSERT INTO sale_orders(order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name,status) VALUES(?,1,?,?,?,1,?,2)', [suffix, suffix, warehouseId, suffix, suffix])
  const itemId = await insert('INSERT INTO sale_order_items(order_id,product_id,product_code,product_name,unit,quantity,warehouse_id) VALUES(?,?,?,?,?,100,?)', [salesId, productId, suffix, suffix, '件', warehouseId])
  const purchaseId = await insert('INSERT INTO purchase_orders(order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name,expected_date) VALUES(?,1,?,?,?,5,1,?,?)', [suffix, suffix, warehouseId, suffix, suffix, '2026-09-20'])
  const purchaseItemId = await insert('INSERT INTO purchase_order_items(order_id,product_id,product_code,product_name,unit,quantity) VALUES(?,?,?,?,?,100)', [purchaseId, productId, suffix, suffix, '件'])
  try {
    await pool.query('INSERT INTO inventory_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,?,0,100)', [productId, warehouseId])
    await pool.query('INSERT INTO sale_order_expected_bindings(sale_order_id,sale_order_item_id,purchase_order_id,purchase_item_id,product_id,warehouse_id,qty) VALUES(?,?,?,?,?,?,100)', [salesId, itemId, purchaseId, purchaseItemId, productId, warehouseId])
    await pool.query("INSERT INTO order_delivery_commitments(document_type,document_id,item_id,promised_date) VALUES('sale',?,0,'2026-09-10')", [salesId])
    const opts = { warehouseId, scopeWarehouseIds: [warehouseId], includeAll: true }
    let row = (await getSupplyRows(opts)).list.find(r => r.productId === productId)
    assert.equal(row.inTransit, 100); assert.equal(row.expectedBound, 100); assert.equal(row.netRequirement, 0)
    assert.equal(row.earliestDemandDate, '2026-09-10'); assert.equal(row.lateSupplyQty, 100)
    assert.equal(row.expectedArrivals[0].expectedDate, '2026-09-20')
    await pool.query('UPDATE purchase_orders SET expected_date=NULL WHERE id=?', [purchaseId])
    row = (await getSupplyRows(opts)).list.find(r => r.productId === productId)
    assert.equal(row.arrivalUnconfirmedQty, 100); assert.equal(row.lateSupplyQty, 0)
  } finally {
    await pool.query('UPDATE sale_orders SET deleted_at=NOW() WHERE id=?', [salesId])
    await pool.query('UPDATE purchase_orders SET deleted_at=NOW() WHERE id=?', [purchaseId])
    await pool.query('UPDATE inventory_warehouses SET deleted_at=NOW() WHERE id=?', [warehouseId])
    await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=?', [productId])
  }
})
