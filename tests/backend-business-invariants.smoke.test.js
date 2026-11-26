'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const imports = require('../backend/src/modules/import/import.service')
const reports = require('../backend/src/modules/reports/reports.query')
const prices = require('../backend/src/modules/price-lists/price-lists.service')
const stockcheck = require('../backend/src/modules/stockcheck/stockcheck.service')
const prefix = 'BC' + randomUUID().slice(0, 8)
after(() => pool.end())

test('商品导入逐行拒绝非法价格，并保留同批有效行', async t => {
  const names = ['有效', '进价文本', '进价负数', '售价文本', '售价负数'].map(n => prefix + n)
  t.after(() => pool.query('DELETE FROM product_items WHERE name IN (?)', [names]))
  const rows = [[12, 15], ['待定', 15], [-1, 15], [12, '待定'], [12, -15]]
  const csv = ['名称,单位,型号,颜色,货号,进价,售价A', ...rows.map(([cost, sale], i) => [names[i], '个', 'A', '红', '', cost, sale].join(','))].join('\n')
  const { data } = await imports.importProducts({ fileBuffer: Buffer.from(csv) })
  assert.deepEqual([data.success, data.errors.length], [1, 4])
  const [stored] = await pool.query('SELECT name FROM product_items WHERE name IN (?)', [names])
  assert.deepEqual(stored.map(row => row.name), [names[0]])
})

test('有效价格表导入按最后一行覆盖，停用和删除均回退客户等级价', async t => {
  const [list] = await pool.query('INSERT INTO price_lists(name) VALUES (?)', [prefix])
  const [product] = await pool.query("INSERT INTO product_items(code,name,unit,sale_price_a) VALUES (?,?,'个',25)", [prefix, prefix])
  const [customer] = await pool.query('INSERT INTO sale_customers(code,name,price_list_id,price_list_name) VALUES (?,?,?,?)', [prefix, prefix, list.insertId, prefix])
  t.after(async () => {
    await pool.query('DELETE FROM price_list_items WHERE list_id=?', [list.insertId])
    await pool.query('DELETE FROM sale_customers WHERE id=?', [customer.insertId])
    await pool.query('DELETE FROM price_lists WHERE id=?', [list.insertId])
    await pool.query('DELETE FROM product_items WHERE id=?', [product.insertId])
  })
  const csv = ['价格表,编码,售价', [list.insertId, prefix, 30], [list.insertId, prefix, 31]].join('\n')
  const { data } = await imports.importPriceListItems({ fileBuffer: Buffer.from(csv) })
  assert.deepEqual([data.success, data.errors], [1, []])
  const quote = () => prices.findCustomerPrice(customer.insertId, product.insertId)
  const [warehouse] = await pool.query('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [prefix + 'Q', prefix])
  t.after(() => pool.query('DELETE FROM inventory_warehouses WHERE id=?', [warehouse.insertId]))
  const commercialQuote = async () => {
    const sale = require('../backend/src/modules/sale/sale.commercial-resolver')
    const result = await sale.resolve(pool, { customerId: customer.insertId, warehouseId: warehouse.insertId,
      commercialGroups: [{ kind: 'ordinary', lineKey: 'L1', productId: product.insertId, quantity: 1 }] }, [], { readOnly: true })
    return result.groups[0].metadata.quote
  }
  assert.equal((await quote()).salePrice, 31)
  assert.equal((await commercialQuote()).referenceUnitPrice, 31)
  await prices.update(list.insertId, { isActive: false })
  assert.equal((await quote()).salePrice, 25)
  assert.deepEqual(await commercialQuote(), { referenceUnitPrice: 25, resolvedPriceSource: 'price_level', resolvedPriceLevel: 'A', priceListId: null })
  await prices.update(list.insertId, { isActive: true })
  await prices.remove(list.insertId)
  assert.equal((await quote()).salePrice, 25)
  assert.deepEqual(await commercialQuote(), { referenceUnitPrice: 25, resolvedPriceSource: 'price_level', resolvedPriceLevel: 'A', priceListId: null })
})

test('波次两件明细和三步独立求和', async t => {
  const [wh] = await pool.query('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [prefix, prefix])
  const [wave] = await pool.query('INSERT INTO picking_waves(wave_no,warehouse_id) VALUES (?,?)', [prefix, wh.insertId])
  const id = wave.insertId
  t.after(async () => {
    await pool.query('DELETE FROM picking_wave_routes WHERE wave_id=?', [id])
    await pool.query('DELETE FROM picking_wave_items WHERE wave_id=?', [id])
    await pool.query('DELETE FROM picking_waves WHERE id=?', [id])
    await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [wh.insertId])
  })
  await pool.query('INSERT INTO picking_wave_items(wave_id,product_id,product_name,total_qty,picked_qty) VALUES ?', [[[id, 1, prefix, 5, 2], [id, 2, prefix, 7, 3]]])
  await pool.query('INSERT INTO picking_wave_routes(wave_id,step,container_id,barcode,product_id,product_name,wave_item_id,status) VALUES ?',
    [[1, 2, 3].map(i => [id, i, i, prefix + i, i, prefix, i, i === 1 ? 'completed' : 'pending'])])
  const { rows } = await reports.fetchWavePerformanceRows({ scopeWarehouseIds: [wh.insertId] })
  assert.equal(rows.length, 1)
  assert.deepEqual(['sku_count', 'total_required_qty', 'total_picked_qty', 'total_steps', 'completed_steps'].map(k => Number(rows[0][k])), [2, 12, 5, 3, 1])
})

test('空仓库范围返回零绩效', async () => {
  const result = await reports.fetchPdaPerformanceRows([])
  assert.deepEqual([Number(result.todaySummary.scan_count), Number(result.todaySummary.pick_qty), result.byOperator, result.daily], [0, 0, [], []])
})

test('循环抽盘缺少商品范围时，在开单之前报范围错误', async () => {
  for (const productIds of [null, []]) {
    await assert.rejects(stockcheck.create({ checkType: 2, warehouseId: 1, warehouseName: '测试仓', operator: { userId: 1, realName: '测试' }, productIds }), e => e.code === 'STOCKCHECK_PRODUCT_SCOPE_REQUIRED')
  }
})

test('库位换仓保留带货库位的归属', async t => {
  const locations = require('../backend/src/modules/locations/locations.service')
  const [a] = await pool.query('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [prefix + 'A', prefix])
  const [b] = await pool.query('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [prefix + 'B', prefix])
  const fields = { warehouseId: a.insertId, zone: 'A', aisle: '1', rack: '1', level: '1', position: '1' }
  const loc = await locations.create(fields)
  const [container] = await pool.query('INSERT INTO inventory_containers(barcode,product_id,warehouse_id,location_id,remaining_qty) VALUES (?,1,?,?,1)', [prefix, a.insertId, loc.id])
  t.after(async () => {
    await pool.query('DELETE FROM inventory_containers WHERE id=?', [container.insertId])
    await pool.query('DELETE FROM warehouse_locations WHERE id=?', [loc.id])
    await pool.query('DELETE FROM inventory_warehouses WHERE id IN (?,?)', [a.insertId, b.insertId])
  })
  await assert.rejects(locations.update(loc.id, { ...fields, warehouseId: b.insertId }), e => e.statusCode === 409)
  assert.equal((await locations.findById(loc.id)).warehouseId, a.insertId)
  await pool.query('UPDATE inventory_containers SET location_id=NULL WHERE id=?', [container.insertId])
  assert.equal((await locations.update(loc.id, { ...fields, warehouseId: b.insertId })).warehouseId, b.insertId)
})

test('已实收的部分调拨可记录短发结案', async t => {
  const transfer = require('../backend/src/modules/transfer/transfer.service')
  const [o] = await pool.query("INSERT INTO transfer_orders(order_no,from_warehouse_id,from_warehouse_name,to_warehouse_id,to_warehouse_name,status,operator_id,operator_name) VALUES (?,1,'甲',2,'乙',3,1,'测试员')", [prefix])
  const id = o.insertId
  t.after(async () => {
    await pool.query('DELETE FROM transfer_order_events WHERE transfer_order_id=?', [id])
    await pool.query('DELETE FROM transfer_order_items WHERE order_id=?', [id])
    await pool.query('DELETE FROM transfer_orders WHERE id=?', [id])
  })
  await pool.query("INSERT INTO transfer_order_items(order_id,product_id,product_code,product_name,unit,quantity,deducted_qty,received_qty) VALUES (?,1,'P','测试商品','个',10,4,4)", [id])
  await transfer.forceCloseInTransit(id, { userId: 1, realName: '测试员' }, { reason: '余量不再调拨' })
  const [[result]] = await pool.query('SELECT status,closed_reason FROM transfer_orders WHERE id=?', [id])
  assert.deepEqual([result.status, result.closed_reason], [4, 'force_close'])
  const [[line]] = await pool.query('SELECT quantity,deducted_qty,received_qty FROM transfer_order_items WHERE order_id=?', [id])
  assert.deepEqual(Object.values(line).map(Number), [10, 4, 4])
})

test('归档失败任务缺打印机时保持失败', async t => {
  const command = require('../backend/src/modules/print-jobs/print-jobs.command')
  const [j] = await pool.query("INSERT INTO print_jobs(title,content,status,error_message) VALUES (?,'',3,'no printer available')", [prefix])
  t.after(() => pool.query('DELETE FROM print_jobs WHERE id=?', [j.insertId]))
  await assert.rejects(command.retry(j.insertId), e => e.statusCode === 409)
  const [[row]] = await pool.query('SELECT status FROM print_jobs WHERE id=?', [j.insertId])
  assert.equal(row.status, 3)
})

test('对账单存储投影滞后时按已锁成员余额核销', async t => {
  const receipts = require('../backend/src/modules/payments/payment-receipts.service')
  const [record] = await pool.query("INSERT INTO payment_records(type,order_no,party_name,total_amount,paid_amount,balance,status,settlement_type) VALUES (2,?,?,20,0,20,1,2)", [prefix + 'PR', prefix])
  const [statement] = await pool.query("INSERT INTO reconciliation_statements(statement_no,type,party_name,total_amount,settled_amount,balance,status) VALUES (?,2,?,10,10,0,3)", [prefix + 'ST', prefix])
  const [receipt] = await pool.query("INSERT INTO payment_receipts(receipt_no,type,party_name,amount,balance,payment_date) VALUES (?,2,?,20,20,CURDATE())", [prefix + 'RC', prefix])
  t.after(async () => {
    await pool.query('DELETE FROM payment_record_events WHERE payment_record_id=?', [record.insertId])
    await pool.query('DELETE FROM payment_entries WHERE receipt_id=?', [receipt.insertId])
    await pool.query('DELETE FROM reconciliation_statement_items WHERE statement_id=?', [statement.insertId])
    await pool.query('DELETE FROM reconciliation_statements WHERE id=?', [statement.insertId])
    await pool.query('DELETE FROM payment_records WHERE id=?', [record.insertId])
    await pool.query('DELETE FROM payment_receipts WHERE id=?', [receipt.insertId])
  })
  await pool.query('INSERT INTO reconciliation_statement_items(statement_id,record_id,order_no,total_amount) VALUES (?,?,?,10)', [statement.insertId, record.insertId, prefix + 'PR'])
  await receipts.settle(receipt.insertId, { allocations: [{ statementId: statement.insertId, amount: 12 }] }, { operatorId: 1, operatorName: '测试员' })
  const [[row]] = await pool.query('SELECT total_amount,settled_amount,balance FROM reconciliation_statements WHERE id=?', [statement.insertId])
  assert.deepEqual(Object.values(row).map(Number), [20, 12, 8])
})

for (const action of ['withdrawConfirm', 'cancel']) {
  test('采购 ' + action + ' 等到原单锁后核对刚建好的收货单', async t => {
    const purchases = require('../backend/src/modules/purchase/purchase.service')
    const [po] = await pool.query("INSERT INTO purchase_orders(order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,operator_id,operator_name,status) VALUES (?,1,'供方',1,'仓',1,'测试员',2)", [prefix + action])
    const id = po.insertId
    const create = await pool.getConnection()
    let taskId
    t.after(async () => {
      create.release()
      await pool.query('DELETE FROM inbound_task_items WHERE task_id=?', [taskId])
      await pool.query('DELETE FROM inbound_tasks WHERE id=?', [taskId])
      await pool.query('DELETE FROM purchase_orders WHERE id=?', [id])
    })
    await create.beginTransaction()
    await create.query('SELECT id FROM purchase_orders WHERE id=? FOR UPDATE', [id])
    const [task] = await create.query("INSERT INTO inbound_tasks(task_no,warehouse_id,status) VALUES (?,1,1)", [prefix + action])
    taskId = task.insertId
    await create.query("INSERT INTO inbound_task_items(task_id,product_id,product_name,purchase_order_id) VALUES (?,1,'商品',?)", [taskId, id])
    const original = pool.getConnection.bind(pool)
    let started
    const waiting = new Promise(resolve => { started = resolve })
    t.mock.method(pool, 'getConnection', async () => {
      const conn = await original()
      const query = conn.query.bind(conn)
      conn.query = (sql, args) => {
        const pending = query(sql, args)
        if (/FROM purchase_orders\b.*FOR UPDATE/is.test(sql)) started()
        return pending
      }
      return conn
    })
    const result = purchases[action](id, { userId: 1, realName: '测试员' }, [1]).then(() => null, error => error)
    try {
      await Promise.race([waiting, result.then(() => { throw new Error('未到达采购单锁') })])
    } finally { await create.commit() }
    assert.equal((await result)?.statusCode, 409)
    const [[order]] = await pool.query('SELECT status FROM purchase_orders WHERE id=?', [id])
    assert.equal(order.status, 2)
  })
}

test('补打来源读到等锁期间提交的最新条码数量', async t => {
  const sources = require('../backend/src/modules/print-jobs/print-jobs.reprint-source')
  const [created] = await pool.query('INSERT INTO inventory_containers(barcode,product_id,warehouse_id,status,remaining_qty) VALUES (?,1,1,1,10)', [prefix + 'R'])
  const id = created.insertId
  const writer = await pool.getConnection()
  const reader = await pool.getConnection()
  t.after(async () => {
    await writer.rollback()
    await reader.rollback()
    writer.release()
    reader.release()
    await pool.query('DELETE FROM inventory_containers WHERE id=?', [id])
  })
  await writer.beginTransaction()
  await writer.query('UPDATE inventory_containers SET remaining_qty=9 WHERE id=?', [id])
  await reader.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
  await reader.beginTransaction()
  await reader.query('SELECT remaining_qty FROM inventory_containers WHERE id=?', [id])
  await writer.commit()
  const row = await sources.lockContainerReprintSource(reader, id, [1])
  assert.equal(Number(row.remaining_qty), 9)
})

test('履约待审事项只保留尚有效的最新授信申请', async t => {
  const { detect } = require('../backend/src/modules/fulfillment/fulfillment.detect')
  const [sale] = await pool.query("INSERT INTO sale_orders(order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name,status) VALUES (?,1,'客户',1,'仓',1,'测试',2)", [prefix + 'C'])
  const id = sale.insertId
  t.after(async () => {
    await pool.query('DELETE FROM sale_credit_approval_proofs WHERE sale_order_id=?', [id])
    await pool.query('DELETE FROM sale_credit_overrides WHERE sale_order_id=?', [id])
    await pool.query('DELETE FROM sale_orders WHERE id=?', [id])
  })
  const credit = async (suffix, days) => {
    const [c] = await pool.query("INSERT INTO sale_credit_overrides(override_no,sale_order_id,sale_order_no,customer_id,customer_name,credit_limit,this_amount,over_amount,applicant_id,applicant_name,status) VALUES (?,?,?,1,'测试',10,20,10,1,'测试',2)", [prefix + suffix, id, prefix + 'C'])
    await pool.query("INSERT INTO sale_credit_approval_proofs(override_id,sale_order_id,basis_hash,expires_at) VALUES (?,?,'hash',DATE_ADD(NOW(), INTERVAL ? DAY))", [c.insertId, id, days])
    return c.insertId
  }
  const keys = async () => (await detect(pool, 'sale', { id, warehouse_id: 1, status: 2 })).map(issue => issue.key)
  await credit('X', -1)
  assert.deepEqual(await keys(), [])
  await credit('Y', 1)
  const latest = await credit('Z', 1)
  assert.deepEqual(await keys(), ['credit:' + latest])
})

test('有打印机和内容的任务仅允许有效来源重试', async t => {
  const command = require('../backend/src/modules/print-jobs/print-jobs.command')
  const { CONTAINER_STATUS } = require('../backend/src/engine/containerEngine')
  const [container] = await pool.query('INSERT INTO inventory_containers(barcode,product_id,warehouse_id,status) VALUES (?,1,1,?)', [prefix + 'J', CONTAINER_STATUS.VOID])
  const [job] = await pool.query("INSERT INTO print_jobs(title,content,printer_id,warehouse_id,ref_type,ref_id,status) VALUES (?,'测试',1,1,'inventory_container',?,3)", [prefix, container.insertId])
  t.after(async () => {
    await pool.query('DELETE FROM print_jobs WHERE id=?', [job.insertId])
    await pool.query('DELETE FROM inventory_containers WHERE id=?', [container.insertId])
  })
  await assert.rejects(command.retry(job.insertId, [1]), { code: 'PRINT_BARCODE_CONTAINER_VOID' })
  const [[row]] = await pool.query('SELECT status FROM print_jobs WHERE id=?', [job.insertId])
  assert.equal(row.status, 3)
})
