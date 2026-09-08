'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const config = validateTestEnvironment()
const mysql = require('../backend/node_modules/mysql2/promise')

test('往来明细：启用前结转与启用后逐笔变化', async t => {
  const file = path.join(__dirname, '../backend/src/database/238_party_ledger.sql')
  assert.ok(fs.existsSync(file), '需要往来明细迁移及事务记账')
  const c = await mysql.createConnection({ ...config, multipleStatements: true, dateStrings: true })
  try {
    const [[{ count }]] = await c.query("SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='party_ledger_events'")
    assert.equal(Number(count), 1, '测试库须显式完成迁移')
    const svc = require('../backend/src/modules/payments/party-ledger.service')
    await c.beginTransaction()
    const [customer] = await c.query("INSERT INTO sale_customers(code,name) VALUES(LEFT(UUID(),30),'往来回归客户')")
    const [other] = await c.query("INSERT INTO sale_customers(code,name) VALUES(LEFT(UUID(),30),'往来回归客户二')")
    const partyId = customer.insertId
    const [order] = await c.query("INSERT INTO sale_orders(order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES(LEFT(UUID(),30),?,'往来回归客户',1,'测试仓',1,'回归')", [partyId])
    const [record] = await c.query("INSERT INTO payment_records(type,order_id,order_no,party_name,total_amount,balance) VALUES(2,?,'LEDGER-SALE','往来回归客户',1000,1000)", [order.insertId])
    const recordId = record.insertId
    const query = extra => svc.findLedger({ type: 2, partyId, ...extra }, c)
    await t.test('关联客户 ID 精确归属，其他客户不可见', async () => {
      const data = await query()
      assert.equal(data.summary.closingBalance, 1000)
      assert.equal((await svc.findLedger({ type: 2, partyId: other.insertId }, c)).pagination.total, 0)
    })
    await t.test('汇款含预收，随后核销不重复减少余额', async () => {
      const [receipt] = await c.query("INSERT INTO payment_receipts(receipt_no,type,party_id,party_name,amount,balance,payment_date) VALUES(LEFT(UUID(),30),2,?,'往来回归客户',1200,1200,CURDATE())", [partyId])
      assert.equal((await query()).summary.closingBalance, -200)
      await c.query('UPDATE payment_records SET paid_amount=1000,balance=0 WHERE id=?', [recordId])
      await c.query('INSERT INTO payment_entries(record_id,receipt_id,amount,payment_date) VALUES(?,?,1000,CURDATE())', [recordId, receipt.insertId])
      await c.query('UPDATE payment_receipts SET settled_amount=1000,balance=200 WHERE id=?', [receipt.insertId])
      assert.equal((await query()).summary.closingBalance, -200)
      assert.equal((await query()).pagination.total, 2)
    })
    await t.test('退款增加往来余额，退货减少账款，各记一次', async () => {
      await c.query('UPDATE payment_records SET paid_amount=800,balance=200 WHERE id=?', [recordId])
      await c.query('INSERT INTO payment_entries(record_id,amount,payment_date) VALUES(?,-200,CURDATE())', [recordId])
      await c.query('UPDATE payment_records SET total_amount=800,balance=0 WHERE id=?', [recordId])
      const data = await query()
      assert.equal(data.summary.closingBalance, -200)
      assert.deepEqual(data.list.map(r => r.balanceAfter), [1000, -200, 0, -200])
    })
    await t.test('翻页保持同一事件边界，并返回完整期初/本期合计', async () => {
      const first = await query({ pageSize: 2 })
      await c.query('UPDATE payment_records SET total_amount=850,balance=50 WHERE id=?', [recordId])
      const second = await query({ pageSize: 2, page: 2, snapshotId: first.snapshotId })
      assert.equal(second.pagination.total, 4)
      assert.equal(second.summary.closingBalance, -200)
      assert.equal(second.list[0].balanceAfter, 0)
      assert.equal((await query()).summary.closingBalance, -150)
    })
    await t.test('单据更名不改变既有流水归属；无金额变化不记账', async () => {
      await c.query("UPDATE sale_customers SET name='往来回归更名' WHERE id=?", [partyId])
      await c.query('UPDATE payment_records SET confirm_status=1 WHERE id=?', [recordId])
      assert.equal((await query()).pagination.total, 5)
      assert.equal((await query()).party.name, '往来回归更名')
    })
    await t.test('更名旧单以稳定 ID 收款，同名单位不得混核', async () => {
      const { resolveReceiptParty } = require('../backend/src/modules/payments/party-identity')
      const resolved = await resolveReceiptParty(c, { type: 2, partyName: '往来回归客户', allocations: [{ recordId, amount: 1 }] })
      assert.equal(resolved, partyId)
      await assert.rejects(resolveReceiptParty(c, { type: 2, partyId: other.insertId, partyName: '往来回归客户', allocations: [{ recordId, amount: 1 }] }), /往来单位/)
    })
    await t.test('事务回滚同时撤销明细', async () => {
      await c.query('SAVEPOINT ledger_check')
      await c.query('UPDATE payment_records SET total_amount=900 WHERE id=?', [recordId])
      assert.equal((await query()).summary.closingBalance, -100)
      await c.query('ROLLBACK TO SAVEPOINT ledger_check')
      assert.equal((await query()).summary.closingBalance, -150)
    })
    await t.test('未归属汇款不能按同名猜归属，也不能核销已知单位账款', async () => {
      const { assertAllocationParty } = require('../backend/src/modules/payments/party-identity')
      const before = (await query()).summary.closingBalance
      const [receipt] = await c.query("INSERT INTO payment_receipts(receipt_no,type,party_name,amount,balance,payment_date) VALUES(LEFT(UUID(),30),2,'往来回归更名',10,10,CURDATE())")
      const [[event]] = await c.query('SELECT party_id FROM party_ledger_events WHERE receipt_id=?', [receipt.insertId])
      assert.equal(event.party_id,null)
      assert.equal((await query()).summary.closingBalance,before)
      await assert.rejects(assertAllocationParty(c,recordId,{type:2,party_id:null}),/归属/)
      await assertAllocationParty(c,recordId,{type:2,party_id:partyId})
      const [manual] = await c.query("INSERT INTO payment_records(type,order_no,party_name,total_amount,balance) VALUES(2,'MANUAL','往来回归更名',10,10)")
      await assertAllocationParty(c,manual.insertId,{type:2,party_id:null})
      await assert.rejects(assertAllocationParty(c,manual.insertId,{type:2,party_id:partyId}),/归属/)
    })
    await t.test('日期和单位参数不能绕过查询边界', async () => {
      await assert.rejects(query({ partyId: -1 }), /参数/)
      await assert.rejects(query({ startDate: '2026-02-30' }), /日期/)
      await assert.rejects(query({ startDate: '2026-09-02', endDate: '2026-09-01' }), /日期/)
    })
  } finally { await c.rollback(); await c.end() }
})

test('独立临时库：真实历史结转、迁移重放、两连接迟提交与期间余额', async t => {
  const database = `flowcube_ledger${Date.now()}_test`
  validateTestEnvironment({ ...process.env, DB_NAME: database })
  const admin = await mysql.createConnection({ ...config, multipleStatements: true, dateStrings: true })
  let c, other
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    c = await mysql.createConnection({ ...config, database, multipleStatements: true, dateStrings: true })
    const tables = ['sale_customers','supply_suppliers','sale_orders','purchase_orders','payment_records','payment_receipts','payment_entries']
    for (const table of tables) await c.query(`CREATE TABLE \`${table}\` LIKE \`${config.database}\`.\`${table}\``)
    await c.query("INSERT INTO sale_customers(id,code,name) VALUES(1,'C1','结转客户')")
    await c.query("INSERT INTO sale_orders(id,order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES(1,'S1',1,'结转客户',1,'仓',1,'测试')")
    await c.query("INSERT INTO payment_records(id,type,order_id,order_no,party_name,total_amount,paid_amount,balance) VALUES(1,2,1,'S1','结转客户',1000,600,400)")
    await c.query("INSERT INTO payment_receipts(id,receipt_no,type,party_name,amount,settled_amount,balance,payment_date) VALUES(1,'R1',2,'结转客户',800,600,200,'2026-08-01')")
    await c.query("INSERT INTO payment_entries(record_id,receipt_id,amount,payment_date) VALUES(1,1,600,'2026-08-01')")
    const migrate = async () => {
      for (const file of ['238_party_ledger.sql','239_party_ledger_receipt_identity.sql','240_party_ledger_explicit_identity.sql']) await c.query(fs.readFileSync(path.join(__dirname,'../backend/src/database',file),'utf8'))
    }
    await migrate()
    const svc = require('../backend/src/modules/payments/party-ledger.service')
    const query = extra => svc.findLedger({ type:2,partyId:1,...extra },c)
    await t.test('已有账款400与未核销200分别结转，净欠款200', async () => {
      const data = await query()
      assert.equal(data.summary.closingBalance,200)
      assert.deepEqual(data.list.map(r => [r.eventType,r.increase,r.decrease]), [['OPENING_RECORD',400,0],['OPENING_ADVANCE',0,200]])
      assert.equal(data.list[0].occurredAt,data.historyStartedAt)
    })
    await t.test('重复执行迁移不重复入账或更改记账时间', async () => {
      const before = await query()
      await migrate()
      assert.deepEqual(await query(),before)
    })
    await t.test('同名复用只能按指定 ID 或原单归属，不按新名字误配', async () => {
      await c.query("UPDATE sale_customers SET name='客户更名' WHERE id=1")
      await c.query("INSERT INTO sale_customers(id,code,name) VALUES(2,'C2','结转客户')")
      const identity = require('../backend/src/modules/payments/party-identity')
      assert.equal(await identity.resolveReceiptParty(c,{type:2,partyName:'结转客户'}),null)
      assert.equal(await identity.resolveReceiptParty(c,{type:2,partyName:'结转客户',allocations:[{recordId:1,amount:1}]}),1)
      assert.equal(await identity.resolveReceiptParty(c,{type:2,partyId:2,partyName:'结转客户'}),2)
    })
    await t.test('迟提交较小 ID 必须中止分批读取，包括区间外的期初变化', async () => {
      other = await mysql.createConnection({ ...config,database,dateStrings:true })
      await other.beginTransaction()
      await other.query("INSERT INTO party_ledger_events(type,party_id,party_name,document_no,event_type,delta,occurred_at) VALUES(2,1,'客户更名','LATE','CHARGE',50,'2026-08-01')")
      await c.query("INSERT INTO party_ledger_events(type,party_id,party_name,document_no,event_type,delta,occurred_at) VALUES(2,1,'客户更名','EARLY','CHARGE',10,'2026-09-10')")
      const first = await query({pageSize:1,startDate:'2026-09-01'})
      await other.commit()
      await assert.rejects(query({page:2,pageSize:1,startDate:'2026-09-01',snapshotId:first.snapshotId,snapshotCount:first.snapshotCount}), /发生变化/)
    })
    await t.test('跨日汇总包括区间前期初，日期尾日完整纳入', async () => {
      await c.query("UPDATE party_ledger_events SET occurred_at='2026-09-08 12:00:00' WHERE event_type LIKE 'OPENING_%'")
      const data = await query({startDate:'2026-09-10',endDate:'2026-09-10'})
      assert.equal(data.summary.openingBalance,250)
      assert.equal(data.summary.increase,10)
      assert.equal(data.summary.closingBalance,260)
      assert.equal(data.list[0].balanceAfter,260)
    })
    await t.test('供应商同样涵盖采购、付款、冲减，不能混入客户账', async () => {
      await c.query("INSERT INTO supply_suppliers(id,code,name) VALUES(1,'V1','测试供应商')")
      await c.query("INSERT INTO purchase_orders(id,order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES(1,'P1',1,'测试供应商',1,'仓',1,'测试')")
      await c.query("INSERT INTO payment_records(id,type,order_id,order_no,party_name,total_amount,balance) VALUES(2,1,1,'P1','测试供应商',300,300)")
      await c.query("INSERT INTO payment_receipts(receipt_no,type,party_id,party_name,amount,balance,payment_date) VALUES('V-R1',1,1,'测试供应商',100,100,CURDATE())")
      await c.query('UPDATE payment_records SET total_amount=250 WHERE id=2')
      const data = await svc.findLedger({type:1,partyId:1},c)
      assert.equal(data.summary.closingBalance,150)
      assert.deepEqual(data.list.map(r=>r.balanceAfter),[300,200,150])
    })
  } finally {
    if (other) { await other.rollback(); await other.end() }
    if (c) await c.end()
    // 只清理本测试显式创建的随机独立库；不连接生产库，不碰宿主业务库。
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await admin.end()
  }
})
