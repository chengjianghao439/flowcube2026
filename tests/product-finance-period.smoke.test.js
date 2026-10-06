'use strict'

// Real HTTP execution, owned facts only. Calendar attribution is controlled AFTER
// execution by changing only the owned source timestamps listed in the manifest.
// This proves period projection, not a calendar-month-long operational trial.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
require('./helpers/testEnvironment').validateTestEnvironment()
const { pool } = require('../backend/src/config/db')
const app = require('../backend/src/app')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')
const { assertSqlIdentifier } = require('../backend/src/utils/sqlIdentifier')
const printFixture = require('./helpers/ownedPrintFixture')
const ref = `PFP-${randomUUID().slice(0, 8)}`
const manifestPath = `/tmp/flowcube-product-finance-${ref}.json`
const own = { ref, database: process.env.DB_NAME, sales: [], purchases: [], returns: [], tasks: [], actors: [], products: [], timestamps: [] }
let server, token, pdaHeaders, printer, warehouseId, locationId, supplierId, customerId, accountId
const rows = async (sql, values = []) => (await pool.query(sql, values))[0]
const one = async (sql, values = []) => (await rows(sql, values))[0]
const insert = async (sql, values) => Number((await rows(sql, values)).insertId)
const save = () => fs.writeFileSync(manifestPath, JSON.stringify(own, null, 2), { mode: 0o600 })
const ymd = value => value instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) : String(value).slice(0, 10)

async function request(path, body, { method = 'POST', expect = 200, pda = false, key = randomUUID(), bearer = token, headers = {} } = {}) {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'X-Request-Key': key, ...(pda ? pdaHeaders : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  })
  const json = await r.json()
  assert.equal(r.status, expect, `${path}: ${JSON.stringify(json)}`)
  return json
}
const http = async (path, body, options) => (await request(path, body, options)).data
const read = path => http(path, undefined, { method: 'GET' })
const generate = period => http('/accounting/vouchers/generate', { period })
async function closed(period) {
  await http('/accounting/periods/generate-closing', { period })
  await http('/accounting/periods/close', { period })
  assert.equal((await one('SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [period])).status, 2)
  own.closedPeriods.push(period)
}

// Explicit table/column/ID allowlist: never status, quantities, paid or money.
async function controlDate(kind, id, date) {
  const targets = {
    shipment: ['warehouse_tasks', 'shipped_at', own.tasks],
    dispatch: ['sale_dispatch_groups', 'confirmed_at', own.dispatches],
    saleReturn: ['sale_returns', 'updated_at', own.returns],
    purchaseReturn: ['purchase_returns', 'updated_at', own.purchaseReturns],
    payable: ['payment_records', 'created_at', own.payables],
    receipt: ['inbound_tasks', 'created_at', own.inbounds],
    audit: ['inbound_tasks', 'audited_at', own.inbounds],
    stockLog: ['inventory_logs', 'created_at', own.stockLogs],
  }
  const [table, column, ids] = targets[kind] || []
  assert.ok(ids?.includes(Number(id)), `${kind} date control must own exact ID`)
  assertSqlIdentifier(table, 'owned date table'); assertSqlIdentifier(column, 'owned date column')
  const before = await one(`SELECT ${column} AS original FROM ${table} WHERE id=?`, [id])
  assert.ok(before?.original, `${kind} must already have a real execution timestamp`)
  own.timestamps.push({ kind, id: Number(id), table, column, original: before.original, controlled: date })
  save()
  const changed = await rows(`UPDATE ${table} SET ${column}=? WHERE id=?`, [date, id])
  assert.equal(changed.affectedRows, 1)
  assert.equal(ymd((await one(`SELECT ${column} AS date FROM ${table} WHERE id=?`, [id])).date), date.slice(0, 10))
}
async function snapshotVouchers(sourceType, sourceId) {
  return rows(`SELECT v.*,e.id AS entry_id,e.line_no,e.account_code,e.direction,e.amount FROM acct_vouchers v
    JOIN acct_voucher_entries e ON e.voucher_id=v.id WHERE v.company_id=1 AND v.source_type=? AND
    (v.source_id=? OR v.source_root_id IN (SELECT id FROM acct_vouchers WHERE company_id=1 AND source_type=? AND source_id=?)) ORDER BY v.id,e.id`, [sourceType, sourceId, sourceType, sourceId])
}
async function net(sourceType, sourceId, period, code) {
  const result = await rows(`SELECT e.direction,e.amount FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
    WHERE v.company_id=1 AND v.source_type=? AND v.period=? AND e.account_code=? AND
    (v.source_id=? OR v.source_root_id IN (SELECT id FROM acct_vouchers WHERE company_id=1 AND source_type=? AND source_id=?))`, [sourceType, period, code, sourceId, sourceType, sourceId])
  return Math.round(result.reduce((sum, leg) => sum + (leg.direction === 1 ? 1 : -1) * Number(leg.amount), 0) * 100) / 100
}
async function balanced(sourceType, sourceId) {
  const vouchers = await rows(`SELECT v.id,v.period,v.total_debit,v.total_credit, SUM(IF(e.direction=1,e.amount,0)) AS debit,
    SUM(IF(e.direction=2,e.amount,0)) AS credit FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
    WHERE v.company_id=1 AND v.source_type=? AND (v.source_id=? OR v.source_root_id IN
    (SELECT id FROM acct_vouchers WHERE company_id=1 AND source_type=? AND source_id=?)) GROUP BY v.id`, [sourceType, sourceId, sourceType, sourceId])
  assert.ok(vouchers.length, `${sourceType} must persist real vouchers`)
  for (const v of vouchers) {
    assert.equal(Number(v.debit), Number(v.credit)); assert.equal(Number(v.total_debit), Number(v.debit)); assert.equal(Number(v.total_credit), Number(v.credit))
  }
}

async function product(suffix, salePrice, cost) {
  const code = `${ref}-${suffix}`
  const id = await insert("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',?,?,0)", [code, code, salePrice, cost])
  own.products.push(id)
  return { id, code, name: code, unit: '个', cost }
}
async function purchase(p, qty, packages, taskQty) {
  const po = await http('/purchase', { supplierId, supplierName: ref, warehouseId, warehouseName: ref, items: [{ productId: p.id, productCode: p.code, productName: p.name, unit: '个', quantity: qty, unitPrice: p.cost }] }, { expect: 201 })
  own.purchases.push(po.id)
  await http(`/purchase/${po.id}/confirm`, {})
  const item = await one('SELECT id FROM purchase_order_items WHERE order_id=?', [po.id])
  const made = await inbound(item.id, taskQty || qty)
  if (packages) await receivePut(made.taskId, p, packages)
  return { ...po, itemId: Number(item.id), taskId: made.taskId, product: p }
}
async function inbound(itemId, qty) {
  const made = await http('/inbound-tasks', { supplierId, supplierName: ref, items: [{ purchaseItemId: itemId, qty }] }, { expect: 201 })
  own.inbounds.push(made.taskId)
  await http(`/inbound-tasks/${made.taskId}/submit`, {})
  return made
}
async function receivePut(taskId, p, quantities) {
  const result = await http(`/inbound-tasks/${taskId}/receive`, { productId: p.id, packages: quantities.map(qty => ({ qty })) }, { pda: true })
  for (const c of result.containers) await http(`/inbound-tasks/${taskId}/putaway`, { containerId: c.containerId, locationId }, { pda: true })
  return result.containers
}
async function actualShip(taskId) {
  const task = await read(`/warehouse-tasks/${taskId}`)
  if (!(await one('SELECT sorting_bin_id FROM warehouse_tasks WHERE id=?', [taskId])).sorting_bin_id) await http(`/warehouse-tasks/${taskId}/assign-sorting-bin`, {})
  for (const i of task.items) {
    const c = await one('SELECT id,barcode,remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND locked_by_task_id IS NULL AND remaining_qty=? ORDER BY id LIMIT 1', [i.productId, warehouseId, i.requiredQty])
    assert.ok(c, 'each demand uses an owned whole container')
    await http('/scan-logs', { taskId, itemId: i.id, containerId: Number(c.id), barcode: c.barcode, productId: i.productId, qty: i.requiredQty, scanMode: '整件' }, { pda: true, expect: 201 })
  }
  await http(`/warehouse-tasks/${taskId}/ready`, {}, { method: 'PUT', pda: true })
  const bin = await one('SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [taskId])
  await http(`/warehouse-tasks/${taskId}/sort-done`, { items: task.items.map(i => ({ itemId: i.id, sortedQty: i.requiredQty, binCode: bin.sorting_bin_code })) }, { method: 'PUT', pda: true })
  for (const c of await rows('SELECT barcode FROM inventory_containers WHERE locked_by_task_id=?', [taskId])) await http('/scan-logs/check', { taskId, barcode: c.barcode }, { pda: true, expect: 201 })
  for (const i of task.items) {
    const pkg = await http('/packages', { warehouseTaskId: taskId }, { pda: true })
    await http(`/packages/${pkg.id}/add-item`, { productCode: i.productCode, qty: i.requiredQty }, { pda: true })
    await http(`/packages/${pkg.id}/finish`, {}, { method: 'PUT', pda: true })
  }
  for (let n = 0; n < 30; n++) {
    const claimed = await http('/print-jobs/claim-client', { limit: 100 }, { headers: printer.headers })
    const jobs = Array.isArray(claimed) ? claimed : claimed.jobs
    assert.ok(Array.isArray(jobs))
    if (!jobs.length) break
    for (const j of jobs) await http(`/print-jobs/${j.id}/complete-client`, { clientId: printer.clientId, ackToken: j.ackToken }, { headers: printer.headers })
  }
  await http(`/warehouse-tasks/${taskId}/pack-done`, {}, { method: 'PUT', pda: true })
  const key = randomUUID()
  const result = await http(`/warehouse-tasks/${taskId}/ship`, {}, { method: 'PUT', pda: true, key })
  assert.deepEqual(await http(`/warehouse-tasks/${taskId}/ship`, {}, { method: 'PUT', pda: true, key }), result)
  assert.equal((await one('SELECT status FROM warehouse_tasks WHERE id=?', [taskId])).status, 7)
}
async function salesReturn(sale, source, qty) {
  const sr = await http('/returns/sale', { customerId, customerName: ref, warehouseId, warehouseName: ref, saleOrderId: sale.id, saleOrderNo: sale.orderNo, commercialModel: 'kit-v1', expectedRevision: 2, items: [{ sourceItemId: source.sourceItemId, commercialComponentId: source.commercialComponentId, dispatchComponentId: source.dispatchComponentId, productId: source.productId, productCode: source.productCode, productName: source.productName, unit: source.unit, quantity: qty, unitPrice: source.unitPrice }] }, { expect: 201 })
  own.returns.push(sr.id)
  await http(`/returns/sale/${sr.id}/confirm`, {})
  const taskId = (await read(`/returns/sale/${sr.id}`)).task.id
  await http(`/return-tasks/${taskId}/receive`, { productId: source.productId, packages: [{ qty }] }, { pda: true })
  await http(`/return-tasks/${taskId}/check`, { productId: source.productId, passedQty: qty, rejectedQty: 0 }, { pda: true })
  const containers = await rows("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4", [taskId])
  assert.equal(containers.length, 1)
  await http(`/return-tasks/${taskId}/putaway`, { containerId: Number(containers[0].id), locationId }, { pda: true })
  assert.equal((await read(`/returns/sale/${sr.id}`)).status, 3)
  return sr.id
}

test('C2/C4真实履约、财务和受控来源日期跨期入账', async () => {
  let businessError
  const cleanupErrors = []
  const clean = async (label, fn) => { try { await fn() } catch (e) { cleanupErrors.push(new Error(`cleanup ${label}`, { cause: e })) } }
  try {
    assert.equal((await one('SELECT DATABASE() AS name')).name, process.env.DB_NAME)
    own.inbounds = []; own.dispatches = []; own.payables = []; own.stockLogs = []; own.purchaseReturns = []; own.closedPeriods = []
    for (let n = 0; n < 2; n++) own.actors.push(await insert("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,'!',?,1,'测试',1)", [`${ref}-${n}`, ref]))
    const jwt = require('../backend/node_modules/jsonwebtoken')
    token = jwt.sign({ userId: own.actors[0], tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '30m' })
    const approver = jwt.sign({ userId: own.actors[1], tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '30m' })
    warehouseId = own.warehouseId = await insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [ref, ref])
    locationId = own.locationId = await insert('INSERT INTO warehouse_locations(warehouse_id,code,name) VALUES (?,?,?)', [warehouseId, ref, ref])
    supplierId = own.supplierId = await insert('INSERT INTO supply_suppliers(code,name,settlement_type,payment_terms_days) VALUES (?,?,2,30)', [ref, ref])
    customerId = own.customerId = await insert('INSERT INTO sale_customers(code,name,credit_limit) VALUES (?,?,NULL)', [ref, ref])
    own.binId = await insert('INSERT INTO sorting_bins(warehouse_id,code) VALUES (?,?)', [warehouseId, ref])
    const secret = randomUUID()
    own.deviceId = await insert("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)", [ref, ref, warehouseId, require('../backend/node_modules/bcryptjs').hashSync(secret, 4)])
    const session = await require('../backend/src/modules/pda/pda.sessions.service').createSession({ deviceCode: ref, deviceSecret: secret, userId: own.actors[0] })
    pdaHeaders = { 'X-Client': 'pda', 'X-PDA-Session': session.sessionToken }
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject) })
    const printHttp = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (path, options = {}) => {
      const data = await http(path.replace(/^\/api/, ''), options.json, { method: method.toUpperCase(), expect: method === 'post' && (path === '/api/printers' || path === '/api/printers/clients/register') ? 201 : 200, headers: options.headers })
      return { ok: true, status: 200, data: { data } }
    }]))
    printer = await printFixture.acquireOwnPackageLabelPrinter({ http: printHttp, token, warehouseId, assert, randomRef: () => ref + randomUUID().slice(0, 4) })
    own.printerId = printer.printerId; own.printHttp = printHttp
    printer.code = (await read(`/printers/${printer.printerId}`)).code
    await http('/printers/client-heartbeat', { hostname: ref }, { headers: printer.headers })
    accountId = own.accountId = (await http('/finance/accounts', { name: ref, type: 2, openingBalance: 1000 }, { expect: 201 })).id

    const hinge = await product('hinge', 40, 7), screw = await product('screw', 5, 2)
    await purchase(hinge, 6, [2, 2, 2]); await purchase(screw, 12, [4, 4, 4])
    const kit = await http('/kits', { code: ref, name: ref, referenceUnitPrice: 100, components: [{ productId: hinge.id, baseQty: 2 }, { productId: screw.id, baseQty: 4 }] }, { expect: 201 })
    const sale = await http('/sale', { customerId, warehouseId, commercialModel: 'kit-v1', discountAmount: 30.0101, commercialGroups: [{ kind: 'kit', lineKey: 'A', kitVersionId: kit.currentVersionId, quantity: 3, warehouseId, priceSource: 'kit_default' }] }, { expect: 201 })
    own.sales.push(sale.id)
    const detail = await read(`/sale/${sale.id}`), groupId = detail.commercialGroups[0].id
    await http(`/sale/${sale.id}/reserve`, { commercialModel: 'kit-v1', expectedRevision: 1, items: detail.physicalItems.map(i => ({ id: i.id, warehouseId, warehouseName: ref, qty: i.quantity })) })
    for (const [index, date] of ['2025-08-15 10:00:00', '2025-09-15 10:00:00'].entries()) {
      const dispatched = await http(`/sale/${sale.id}/ship`, { commercialModel: 'kit-v1', expectedRevision: 1, groups: [{ groupId, qty: 1 }] })
      const taskId = dispatched.tasks[0].taskId; own.tasks.push(taskId)
      await actualShip(taskId)
      const dispatch = await one('SELECT id FROM sale_dispatch_groups WHERE task_id=? AND confirmed_at IS NOT NULL', [taskId])
      own.dispatches.push(Number(dispatch.id))
      await controlDate('shipment', taskId, date); await controlDate('dispatch', dispatch.id, date)
      // Independent decimal expectations: half-up(30.0101 * 100/300)=10.0034;
      // half-up(30.0101 * 200/300)=20.0067. Do not call the product calculator.
      assert.equal(Number((await one('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?', [sale.id])).total_amount), [89.9966, 179.9933][index])
      await generate(index ? '202509' : '202508')
      assert.equal(await net('sale_revenue', sale.id, index ? '202509' : '202508', '1122'), [90, 89.99][index], 'period income is the difference of rounded cumulative net: 179.99 minus 90')
      assert.equal(await net('sale_cogs', sale.id, index ? '202509' : '202508', '6401'), 22)
      if (!index) {
        await closed('202508')
        own.augustRevenue = (await snapshotVouchers('sale_revenue', sale.id)).filter(v => v.period === '202508')
        own.augustCost = (await snapshotVouchers('sale_cogs', sale.id)).filter(v => v.period === '202508')
      } else {
        assert.deepEqual((await snapshotVouchers('sale_revenue', sale.id)).filter(v => v.period === '202508'), own.augustRevenue)
        assert.deepEqual((await snapshotVouchers('sale_cogs', sale.id)).filter(v => v.period === '202508'), own.augustCost)
      }
    }
    const august = (await snapshotVouchers('sale_revenue', sale.id)).filter(v => v.period === '202508')
    const costs = await rows('SELECT product_id,cost_snapshot FROM sale_order_items WHERE order_id=?', [sale.id])
    assert.equal(Number(costs.find(i => i.product_id === hinge.id).cost_snapshot), 7)
    assert.equal(Number(costs.find(i => i.product_id === screw.id).cost_snapshot), 2)
    await http(`/sale/${sale.id}/cancel`, { commercialModel: 'kit-v1', expectedRevision: 1 })
    const closedSale = await read(`/sale/${sale.id}`)
    assert.equal(closedSale.totalAmount, 200, 'closed order shows shipped gross; AR retains the original net discount')
    assert.equal(closedSale.commercialGroups[0].id, groupId)
    assert.equal(Number((await one('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?', [sale.id])).total_amount), 179.9933)
    const frozen = await rows('SELECT order_gross_basis,discount_basis,confirmed_gross FROM sale_dispatch_groups WHERE order_id=? AND confirmed_at IS NOT NULL ORDER BY id', [sale.id])
    assert.deepEqual(frozen.map(r => [Number(r.order_gross_basis), Number(r.discount_basis), Number(r.confirmed_gross)]), [[300, 30.0101, 100], [300, 30.0101, 100]])
    const source = (await read(`/returns/sale/source-order?orderNo=${encodeURIComponent(sale.orderNo)}`)).items.find(i => i.productId === hinge.id && i.taskId === own.tasks[0])
    assert.ok(source, 'return must select the first real shipment component')
    // Later master-price drift must not change the frozen original shipment cost.
    await rows('UPDATE product_items SET cost_price=99 WHERE id=?', [hinge.id])
    for (const [index, date] of ['2025-09-20 10:00:00', '2025-10-20 10:00:00'].entries()) {
      const returnId = await salesReturn(sale, source, 1)
      // Gross source 40 then 80: proportional discount cumulative4 is 4.0013
      // then 8.0027; net deltas are 35.9987 and 35.9986, NOT 35.99/35.99.
      const receipt = await one('SELECT qualified_qty,refund_amount,financial_amount FROM sale_commercial_refund_receipts WHERE return_item_id IN (SELECT id FROM sale_return_items WHERE return_id=?)', [returnId])
      assert.deepEqual([Number(receipt.qualified_qty), Number(receipt.refund_amount), Number(receipt.financial_amount)], [1, 40, [35.9987, 35.9986][index]])
      await controlDate('saleReturn', returnId, date)
      await generate(index ? '202510' : '202509')
      assert.equal(await net('sale_return', returnId, index ? '202510' : '202509', '1122'), -36)
      assert.equal(await net('sale_return', returnId, index ? '202510' : '202509', '1405'), 7)
      await balanced('sale_return', returnId)
      assert.equal(Number((await one('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?', [sale.id])).total_amount), [143.9946, 107.9960][index])
    }
    const refunds = await one('SELECT SUM(refund_amount) AS gross,SUM(financial_amount) AS financial FROM sale_commercial_refund_receipts WHERE order_id=?', [sale.id])
    assert.equal(Number(refunds.gross), 80); assert.equal(Number(refunds.financial), 71.9973)
    const ar = await one('SELECT id,total_amount FROM payment_records WHERE type=2 AND order_id=?', [sale.id])
    const arRead = (await read(`/payments?type=2&orderNo=${encodeURIComponent(sale.orderNo)}`)).list.find(r => r.id === Number(ar.id))
    assert.ok(arRead); assert.equal(arRead.totalAmount, Number(ar.total_amount))
    assert.equal(Number(ar.total_amount), 107.9960)
    await generate()
    const beforeRepeat = await snapshotVouchers('sale_revenue', sale.id)
    const repeat = await generate()
    assert.equal(repeat.created + repeat.updated + repeat.reversed, 0)
    assert.deepEqual(await snapshotVouchers('sale_revenue', sale.id), beforeRepeat)
    assert.deepEqual((await snapshotVouchers('sale_revenue', sale.id)).filter(v => v.period === '202508'), august)
    assert.deepEqual((await snapshotVouchers('sale_cogs', sale.id)).filter(v => v.period === '202508'), own.augustCost)
    await balanced('sale_revenue', sale.id); await balanced('sale_cogs', sale.id)
    console.log('[PASS C2] split AR89.9966/179.9933; component financial4 35.9987+35.9986=71.9973, remaining AR107.9960; controlled Aug/Sep/Oct vouchers revenue90+89.99 cost22+22 reverse36+36 cost7+7; closed August unchanged')

    const purchased = await product('progressive', 20, 10)
    const po = await purchase(purchased, 100, [2, 18], 40)
    await controlDate('receipt', po.taskId, '2025-04-30 10:00:00')
    const logs = await rows("SELECT id FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [po.taskId])
    own.stockLogs.push(...logs.map(r => Number(r.id)))
    for (const l of logs) await controlDate('stockLog', l.id, '2025-04-30 10:00:00')
    assert.deepEqual(await one('SELECT status,audit_status FROM inbound_tasks WHERE id=?', [po.taskId]), { status: 2, audit_status: 0 })
    assert.equal(Number((await one('SELECT SUM(remaining_qty) AS qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1', [purchased.id, warehouseId])).qty), 20)
    assert.equal(await one('SELECT id FROM payment_records WHERE type=1 AND order_id=?', [po.id]), undefined)
    await generate('202504')
    assert.equal((await snapshotVouchers('purchase_settle', po.id)).length, 0)
    await http(`/inbound-tasks/${po.taskId}/close-receiving`, {})
    await controlDate('audit', po.taskId, '2025-05-02 10:00:00')
    const payable = await one('SELECT * FROM payment_records WHERE type=1 AND order_id=?', [po.id])
    own.payables.push(Number(payable.id))
    assert.equal(Number(payable.total_amount), 200)
    await controlDate('payable', payable.id, '2025-05-02 10:00:00')
    const first = await one('SELECT created_at,due_date,settlement_type FROM payment_records WHERE id=?', [payable.id])
    await generate('202505')
    assert.equal(await net('purchase_settle', po.id, '202505', '2202'), -200)
    await http(`/payments/${payable.id}/confirm`, {})
    const funds = async () => ({
      account: await one('SELECT type,opening_balance,current_balance FROM finance_accounts WHERE id=?', [accountId]),
      entries: await rows('SELECT id,record_id,account_id,amount,payment_date FROM payment_entries WHERE record_id=? ORDER BY id', [payable.id]),
      txns: await rows('SELECT id,account_id,direction,amount,biz_type,biz_id,backfill_id FROM finance_account_transactions WHERE account_id=? ORDER BY id', [accountId]),
      events: await rows("SELECT id,payload_json FROM payment_record_events WHERE payment_record_id=? AND event_type='PAYMENT_RECORDED' ORDER BY id", [payable.id]),
      party: await rows("SELECT id,type,party_id,record_id,entry_id,order_id,delta,business_date FROM party_ledger_events WHERE record_id=? AND event_type='DIRECT_PAYMENT' ORDER BY id", [payable.id]),
    })
    async function assertFunds(amounts, balance) {
      const f = await funds()
      assert.deepEqual([Number(f.account.type), Number(f.account.opening_balance), Number(f.account.current_balance)], [2, 1000, balance])
      assert.equal((await read(`/finance/accounts/${accountId}`)).currentBalance, balance)
      for (const list of [f.entries, f.txns, f.events, f.party]) assert.equal(list.length, amounts.length, 'one entry/fund transaction/payment event/party event per payment')
      for (const [i, amount] of amounts.entries()) {
        const entry = f.entries[i], txn = f.txns[i], party = f.party[i]
        assert.deepEqual([Number(entry.record_id), Number(entry.account_id), Number(entry.amount)], [Number(payable.id), Number(accountId), amount])
        assert.deepEqual([Number(txn.account_id), Number(txn.direction), Number(txn.amount), Number(txn.biz_type), Number(txn.biz_id)], [Number(accountId), 2, amount, 2, Number(entry.id)])
        assert.equal(txn.backfill_id == null ? null : Number(txn.backfill_id), i ? Number(own.backfillId) : null)
        const payload = typeof f.events[i].payload_json === 'string' ? JSON.parse(f.events[i].payload_json) : f.events[i].payload_json
        assert.deepEqual([Number(payload.entryId), Number(payload.amount)], [Number(entry.id), amount])
        assert.deepEqual([Number(party.type), Number(party.party_id), Number(party.record_id), Number(party.entry_id), Number(party.order_id), Number(party.delta)], [1, Number(supplierId), Number(payable.id), Number(entry.id), Number(po.id), -amount])
        assert.equal(ymd(party.business_date), ymd(entry.payment_date))
      }
      own.fundSnapshots ||= []
      own.fundSnapshots.push({ amounts, balance, facts: f })
      return f
    }
    await assertFunds([], 1000)
    const firstPay = { amount: 50, paymentDate: '2025-05-03', method: '现金', accountId, remark: ref }, firstPayKey = randomUUID()
    const firstPayReceipt = await http(`/payments/${payable.id}/pay`, firstPay, { key: firstPayKey })
    const paidFunds = await assertFunds([50], 950)
    assert.deepEqual(await http(`/payments/${payable.id}/pay`, firstPay, { key: firstPayKey }), firstPayReceipt)
    assert.deepEqual(await assertFunds([50], 950), paidFunds, 'same-key payment replay cannot move the cash account or repeat events')
    assert.equal(Number((await one('SELECT paid_amount FROM payment_records WHERE id=?', [payable.id])).paid_amount), 50)
    const pr = await http('/returns/purchase', { supplierId, supplierName: ref, warehouseId, warehouseName: ref, purchaseOrderId: po.id, purchaseOrderNo: po.orderNo, items: [{ sourceItemId: po.itemId, productId: purchased.id, productCode: purchased.code, productName: purchased.name, unit: '个', quantity: 2, unitPrice: 10 }] }, { expect: 201 })
    own.purchaseReturns.push(pr.id)
    await http(`/returns/purchase/${pr.id}/confirm`, {})
    const wt = await one("SELECT id FROM warehouse_tasks WHERE return_id=? AND task_type='purchase_return'", [pr.id]); own.tasks.push(Number(wt.id))
    const wti = await one('SELECT id FROM warehouse_task_items WHERE task_id=?', [wt.id])
    const container = await one('SELECT id,barcode FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND remaining_qty=2 AND locked_by_task_id IS NULL', [purchased.id, warehouseId])
    await http('/scan-logs', { taskId: Number(wt.id), itemId: Number(wti.id), containerId: Number(container.id), barcode: container.barcode, productId: purchased.id, qty: 2, scanMode: '整件' }, { pda: true, expect: 201 })
    await http(`/warehouse-tasks/${wt.id}/ready`, {}, { method: 'PUT', pda: true })
    await http(`/warehouse-tasks/${wt.id}/ship`, {}, { method: 'PUT', pda: true })
    assert.equal((await read(`/returns/purchase/${pr.id}`)).status, 3)
    await controlDate('purchaseReturn', pr.id, '2025-05-04 10:00:00')
    await http(`/suppliers/${supplierId}`, { name: ref, isActive: true, settlementType: 1, paymentTermsDays: 0 }, { method: 'PUT' })
    assert.equal((await read(`/suppliers/${supplierId}`)).settlementType, 1)
    assert.equal(first.settlement_type, 2, 'first monthly terms must survive a later supplier cash-policy change')
    const next = await inbound(po.itemId, 60)
    await receivePut(next.taskId, purchased, [20])
    await controlDate('receipt', next.taskId, '2025-06-01 10:00:00')
    const laterLogs = await rows("SELECT id FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [next.taskId])
    own.stockLogs.push(...laterLogs.map(r => Number(r.id)))
    for (const l of laterLogs) await controlDate('stockLog', l.id, '2025-06-01 10:00:00')
    assert.equal(Number((await one('SELECT total_amount FROM payment_records WHERE id=?', [payable.id])).total_amount), 180)
    await http(`/inbound-tasks/${next.taskId}/close-receiving`, {})
    await controlDate('audit', next.taskId, '2025-06-02 10:00:00')
    const final = await one('SELECT * FROM payment_records WHERE id=?', [payable.id])
    assert.deepEqual([Number(final.total_amount), Number(final.paid_amount), Number(final.balance), final.confirm_status], [380, 50, 330, 0])
    assert.deepEqual({ created_at: final.created_at, due_date: final.due_date, settlement_type: final.settlement_type }, first)
    await generate('202505')
    assert.equal(await net('purchase_settle', po.id, '202505', '2202'), -400)
    assert.equal(await net('purchase_return', pr.id, '202505', '2202'), 20)
    await balanced('purchase_settle', po.id); await balanced('purchase_return', pr.id)
    const paidEntry = await one('SELECT amount,payment_date FROM payment_entries WHERE record_id=?', [payable.id])
    assert.equal(Number(paidEntry.amount), 50); assert.equal(ymd(paidEntry.payment_date), '2025-05-03')
    await closed('202505')
    const frozenPurchase = await snapshotVouchers('purchase_settle', po.id)
    await http(`/payments/${payable.id}/confirm`, {})
    const pay = { amount: 10, paymentDate: '2025-05-05', method: '现金', accountId, remark: ref }
    const beforePay = await read(`/payments/${payable.id}/settlement-detail`)
    assert.deepEqual([beforePay.record.totalAmount, beforePay.record.paidAmount, beforePay.record.balance], [380, 50, 330])
    const beforeFunds = await assertFunds([50], 950)
    assert.equal((await request(`/payments/${payable.id}/pay`, pay, { expect: 409 })).code, 'FINANCE_PERIOD_CLOSED')
    assert.deepEqual(await read(`/payments/${payable.id}/settlement-detail`), beforePay)
    assert.deepEqual(await funds(), beforeFunds, 'closed-period rejection cannot move money or create payment facts')
    const applied = await http(`/payments/${payable.id}/pay`, { ...pay, backfillRequest: true, backfillReason: '专属测试库跨期验收' }, { expect: 202 })
    own.backfillId = applied.id
    assert.deepEqual(await assertFunds([50], 950), beforeFunds, 'an application cannot move money before approval')
    await http(`/accounting/backfills/${applied.id}/approve`, { remark: '独立审批人验收' }, { bearer: approver })
    const bf = await read(`/accounting/backfills/${applied.id}`)
    assert.ok(bf.executedAt && bf.voucherGeneratedAt); assert.equal(bf.voucherGenerateError, null)
    const period = beijingTodayYmd().replaceAll('-', '').slice(0, 6)
    assert.equal(bf.postingPeriod, period)
    const txn = await one('SELECT id,amount,happened_at,voucher_date_override FROM finance_account_transactions WHERE backfill_id=?', [applied.id])
    assert.equal(Number(txn.amount), 10); assert.equal(ymd(txn.happened_at), pay.paymentDate); assert.equal(ymd(txn.voucher_date_override), beijingTodayYmd())
    assert.equal(await net('payment_out', txn.id, period, '2202'), 10)
    assert.equal(await net('payment_out', txn.id, period, '1001'), -10)
    await balanced('payment_out', txn.id)
    assert.equal(Number((await one('SELECT paid_amount FROM payment_records WHERE id=?', [payable.id])).paid_amount), 60)
    const backfilledRead = (await read(`/payments/${payable.id}/settlement-detail`)).record
    assert.deepEqual([backfilledRead.totalAmount, backfilledRead.paidAmount, backfilledRead.balance], [380, 60, 320])
    const approvedFunds = await assertFunds([50, 10], 940)
    assert.equal((await http(`/accounting/backfills/${applied.id}/execute`, {}, { bearer: approver })).alreadyExecuted, true)
    await read(`/accounting/backfills/${applied.id}`)
    assert.deepEqual(await assertFunds([50, 10], 940), approvedFunds, 'executed backfill replay/read cannot move cash or repeat business events')
    const reread = await generate(period); assert.equal(reread.created + reread.updated + reread.reversed, 0)
    assert.deepEqual(await snapshotVouchers('purchase_settle', po.id), frozenPurchase)
    console.log('[PASS C4] early ACTIVE20/no AP; real pay50+PR20+next batch: AP380/paid50/balance330; gross400-return20/first terms; closed pay409, approval backfill10/current-period voucher; cash1000→950→940, each payment entry/fund/PAYMENT_RECORDED/party event once, original-key and backfill replay unchanged')
    own.completed = true
  } catch (e) { businessError = e }
  finally {
    await clean('manifest', async () => { save(); console.log(`[fixtures] ${manifestPath}`) })
    for (const saleId of own.sales) await clean(`sale ${saleId} normal cancellation/return`, async () => {
      const sale = await one('SELECT status,commercial_revision FROM sale_orders WHERE id=?', [saleId])
      if (sale && [1, 2, 3, 6].includes(sale.status)) await http(`/sale/${saleId}/cancel`, { commercialModel: 'kit-v1', expectedRevision: Number(sale.commercial_revision) })
      for (const task of await rows('SELECT id FROM warehouse_tasks WHERE sale_order_id=? AND cancel_requested_at IS NOT NULL AND status<>8', [saleId])) {
        const pending = await read(`/warehouse-tasks/${task.id}/cancel-return-detail`)
        for (const p of pending.packages) await http('/scan-logs/cancel-return/box', { taskId: task.id, packageId: p.packageId, barcode: p.barcode }, { pda: true, expect: 201 })
        for (const c of pending.containers) await http('/scan-logs/cancel-return', { taskId: task.id, containerId: c.containerId, barcode: c.barcode, locationId }, { pda: true, expect: 201 })
      }
    })
    for (const returnId of own.returns) await clean(`return ${returnId} normal cancellation`, async () => {
      const sr = await one('SELECT status FROM sale_returns WHERE id=?', [returnId])
      if (sr && [1, 2].includes(sr.status)) await http(`/returns/sale/${returnId}/cancel`, {})
    })
    for (const period of own.closedPeriods || []) await clean(`owned period ${period} reopen`, () => http('/accounting/periods/reopen', { period }))
    await clean('printer', async () => { if (printer) await printFixture.releaseOwnPackageLabelPrinter(printer, { http: own.printHttp, token, assert }) })
    await clean('device', async () => {
      if (!own.deviceId) return
      await rows('DELETE FROM pda_device_sessions WHERE device_id=?', [own.deviceId])
      await rows("UPDATE pda_devices SET status='disabled' WHERE id=?", [own.deviceId])
    })
    for (const id of own.actors) await clean(`actor ${id}`, () => rows('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?', [id]))
    await clean('finance account', async () => { if (accountId) await rows('UPDATE finance_accounts SET is_active=0 WHERE id=?', [accountId]) })
    await clean('resource proof', async () => {
      own.cleanup = {}
      if (own.actors.length) {
        own.cleanup.actors = await rows('SELECT id,is_active FROM sys_users WHERE id IN (?)', [own.actors])
        assert.ok(own.cleanup.actors.every(a => a.is_active === 0))
      }
      if (own.deviceId) {
        assert.equal(Number((await one('SELECT COUNT(*) AS n FROM pda_device_sessions WHERE device_id=?', [own.deviceId])).n), 0)
        assert.equal((await one('SELECT status FROM pda_devices WHERE id=?', [own.deviceId])).status, 'disabled')
        own.cleanup.deviceDisabled = true; own.cleanup.sessions = 0
      }
      if (own.sales.length) {
        const reserved = await one("SELECT COALESCE(SUM(qty),0) AS qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id IN (?) AND status=1", [own.sales])
        assert.equal(Number(reserved.qty), 0); own.cleanup.reserved = 0
      }
      if (own.tasks.length) {
        assert.equal(Number((await one('SELECT COUNT(*) AS n FROM inventory_containers WHERE locked_by_task_id IN (?)', [own.tasks])).n), 0)
        own.cleanup.lockedContainers = 0
      }
    })
    await clean('server', async () => { if (server) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); own.cleanup.serverClosed = server.address() === null } })
    await clean('pool', async () => { await pool.end(); if (own.cleanup) own.cleanup.poolEnded = true })
    own.cleanupErrors = cleanupErrors.map(e => `${e.message}: ${e.cause?.message || ''}`)
    await clean('final manifest', async () => { save() })
  }
  if (businessError && cleanupErrors.length) throw new AggregateError([businessError, ...cleanupErrors], 'Business and cleanup failed')
  if (businessError) throw businessError
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Cleanup failed')
})
