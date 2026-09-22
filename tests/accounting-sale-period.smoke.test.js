'use strict'
// F04：真实出库事实的按期间投影；每条测试独立事务回滚，不清理其他任务数据。
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
require('./helpers/testEnvironment').configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const engine = require('../backend/src/modules/accounting/voucher-engine')
let seq = 0
const unique = () => `F04${Date.now().toString(36)}${++seq}`
async function fixture(fn, { persist = false } = {}) {
  let saved = null
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  const insert = async (sql, args = []) => Number((await conn.query(sql, args))[0].insertId)
  try {
    const companyId = await insert('INSERT INTO acct_companies(code,name) VALUES (?,?)', [unique(), '跨期回归账套'])
    const [accounts] = await conn.query('SELECT * FROM acct_accounts WHERE company_id=1')
    for (const a of accounts) await conn.query(`INSERT INTO acct_accounts(company_id,code,name,category,balance_dir,is_leaf) VALUES (?,?,?,?,?,?)`, [companyId,a.code,a.name,a.category,a.balance_dir,a.is_leaf])
    const wh = await insert("INSERT INTO inventory_warehouses(code,name) VALUES (?,'跨期回归仓')", [unique()])
    const prod = await insert("INSERT INTO product_items(code,name,unit) VALUES (?,'跨期回归商品','个')", [unique()])
    const orderNo = unique()
    const orderId = await insert(`INSERT INTO sale_orders(order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name,total_amount,status)
      VALUES (?,1,'跨期回归客户',?,'跨期回归仓',1,'回归',100,4)`, [orderNo, wh])
    const itemId = await insert(`INSERT INTO sale_order_items(order_id,product_id,product_code,product_name,unit,quantity,shipped_qty,unit_price,amount,cost_snapshot,warehouse_id)
      VALUES (?,?,'F04','跨期回归商品','个',100,100,1,100,0.3,?)`, [orderId,prod,wh])
    await insert(`INSERT INTO payment_records(type,order_id,order_no,party_name,total_amount,balance,created_at) VALUES (2,?,?,'跨期回归客户',100,100,'2097-08-01')`, [orderId,orderNo])
    const tasks = []
    for (const date of ['2097-08-15 10:00:00','2097-09-15 10:00:00']) {
      const id = await insert(`INSERT INTO warehouse_tasks(task_no,sale_order_id,customer_name,warehouse_id,warehouse_name,status,shipped_at)
        VALUES (?,?,'跨期回归客户',?,'跨期回归仓',7,?)`, [unique(),orderId,wh,date])
      await insert(`INSERT INTO warehouse_task_items(task_id,product_id,product_code,product_name,unit,required_qty,picked_qty)
        VALUES (?,?,'F04','跨期回归商品','个',50,50)`, [id,prod])
      tasks.push(id)
    }
    const generate = (period = null) => engine.generateVouchers(conn,{companyId,period})
    const net = async (period, code='1122') => Number((await conn.query(`SELECT COALESCE(SUM(IF(e.direction=1,e.amount,-e.amount)),0) n FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
      WHERE v.company_id=? AND v.period=? AND v.source_no=? AND e.account_code=?`,[companyId,period,orderNo,code]))[0][0].n)
    saved = {conn,insert,companyId,wh,prod,orderId,orderNo,itemId,tasks,generate,net}
    if (persist) await conn.commit()
    await fn(saved)
  } finally {
    await conn.rollback()
    try {
      if (persist && saved) {
        const {companyId,orderId,prod,wh} = saved
        await conn.query('DELETE FROM acct_closing_details WHERE company_id=?',[companyId])
        await conn.query('DELETE FROM acct_voucher_entries WHERE voucher_id IN (SELECT id FROM acct_vouchers WHERE company_id=?)',[companyId])
        await conn.query('DELETE FROM acct_vouchers WHERE company_id=?',[companyId])
        await conn.query('DELETE FROM acct_periods WHERE company_id=?',[companyId])
        await conn.query('DELETE FROM acct_accounts WHERE company_id=?',[companyId])
        await conn.query('DELETE FROM acct_companies WHERE id=?',[companyId])
        await conn.query('DELETE FROM warehouse_task_items WHERE task_id IN (SELECT id FROM warehouse_tasks WHERE sale_order_id=?)',[orderId])
        await conn.query('DELETE FROM warehouse_tasks WHERE sale_order_id=?',[orderId])
        await conn.query('DELETE FROM payment_records WHERE type=2 AND order_id=?',[orderId])
        await conn.query('DELETE FROM party_ledger_events WHERE type=2 AND order_id=?',[orderId])
        await conn.query('DELETE FROM sale_order_items WHERE order_id=?',[orderId])
        await conn.query('DELETE FROM sale_orders WHERE id=?',[orderId])
        await conn.query('DELETE FROM product_items WHERE id=?',[prod])
        await conn.query('DELETE FROM inventory_warehouses WHERE id=?',[wh])
      }
    } finally { conn.release() }
  }
}
after(() => pool.end())

test('两期各发50，收入/成本必须分别记在实际出库月', () => fixture(async f => {
  const rev = (await engine.buildSaleRevenue(f.conn,new Map())).filter(s => Number(s.sourceId) === f.orderId)
  assert.equal(rev.length,2,'跨期销售不能累计进首次应收月')
  await f.generate()
  assert.equal(await f.net('209708'),50)
  assert.equal(await f.net('209709'),50)
  assert.equal(await f.net('209708','6401'),15)
  assert.equal(await f.net('209709','6401'),15)
  const second = await f.generate()
  assert.equal(second.created + second.updated,0)
}))

async function oldRoot(f, amount, type='sale_revenue') {
  const legs = type === 'sale_revenue' ? [
    {code:'1122',direction:1,amount,auxType:1,auxId:1,auxName:'跨期回归客户'},
    {code:'6001',direction:2,amount},
  ] : [{code:'6401',direction:1,amount},{code:'1405',direction:2,amount}]
  return engine.upsertVoucher(f.conn,{sourceType:type,sourceId:f.orderId,sourceNo:f.orderNo,voucherDate:'2097-08-15',legs},
    await engine.loadAccountMap(f.conn,f.companyId),await engine.makeSeqAllocator(f.conn,f.companyId),null,f.companyId)
}
async function snapshot(f,id) {
  return { voucher:(await f.conn.query('SELECT * FROM acct_vouchers WHERE id=?',[id]))[0], entries:(await f.conn.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=?',[id]))[0] }
}
async function closeAugust(f) {
  await f.conn.query("INSERT INTO acct_periods(company_id,period,status) VALUES (?,'209708',2)",[f.companyId])
}
async function manualReverse(f, id) {
  const [r] = await f.conn.query(`INSERT INTO acct_vouchers(company_id,voucher_no,voucher_date,period,source_type,source_id,source_no,total_debit,total_credit,is_reversal,reversed_id)
    SELECT company_id,?,voucher_date,period,'manual',NULL,source_no,total_credit,total_debit,1,id FROM acct_vouchers WHERE id=?`,[unique(),id])
  await f.conn.query(`INSERT INTO acct_voucher_entries(voucher_id,line_no,account_id,account_code,account_name,direction,amount,aux_type,aux_id,aux_name)
    SELECT ?,line_no,account_id,account_code,account_name,IF(direction=1,2,1),amount,aux_type,aux_id,aux_name FROM acct_voucher_entries WHERE voucher_id=?`,[r.insertId,id])
  await f.conn.query('UPDATE acct_vouchers SET status=3 WHERE id=?',[id])
}

test('八月已生成后关账，九月追加仍记50，八月原行与分录不变', () => fixture(async f => {
  await f.conn.query('UPDATE warehouse_tasks SET status=6,shipped_at=NULL WHERE id=?',[f.tasks[1]])
  await f.conn.query('UPDATE sale_order_items SET shipped_qty=50 WHERE id=?',[f.itemId])
  await f.generate('209708')
  const [[root]] = await f.conn.query("SELECT id FROM acct_vouchers WHERE company_id=? AND source_type='sale_revenue' AND source_id=?",[f.companyId,f.orderId])
  const before = await snapshot(f,root.id)
  await closeAugust(f)
  await f.conn.query("UPDATE warehouse_tasks SET status=7,shipped_at='2097-09-15' WHERE id=?",[f.tasks[1]])
  await f.conn.query('UPDATE sale_order_items SET shipped_qty=100 WHERE id=?',[f.itemId])
  await f.generate('209709')
  assert.equal(await f.net('209708'),50)
  assert.equal(await f.net('209709'),50)
  assert.deepEqual(await snapshot(f,root.id),before)
}))

test('旧八月累计50保持原样，闭期后九月只补50', () => fixture(async f => {
  const r = await oldRoot(f,50)
  await oldRoot(f,15,'sale_cogs')
  const before = await snapshot(f,r.id)
  await closeAugust(f)
  await f.generate('209709')
  assert.equal(await f.net('209708'),50)
  assert.equal(await f.net('209709'),50)
  assert.deepEqual(await snapshot(f,r.id),before)
  assert.equal((await f.conn.query("SELECT COUNT(*) n FROM acct_vouchers WHERE company_id=? AND source_period='209708'",[f.companyId]))[0][0].n,0)
}))

test('旧八月累计100：开放时追加八月负50和九月正50，不改旧行', () => fixture(async f => {
  const r = await oldRoot(f,100), before = await snapshot(f,r.id)
  await f.generate()
  assert.equal(await f.net('209708'),50)
  assert.equal(await f.net('209709'),50)
  assert.deepEqual(await snapshot(f,r.id),before)
  const [[adjustment]] = await f.conn.query("SELECT id FROM acct_vouchers WHERE company_id=? AND source_type='sale_revenue' AND source_period='209708'",[f.companyId])
  const [[leg]] = await f.conn.query("SELECT direction,amount FROM acct_voucher_entries WHERE voucher_id=? AND account_code='1122'",[adjustment.id])
  assert.equal(leg.direction,2)
  assert.equal(Number(leg.amount),50)
  const again = await f.generate()
  assert.equal(again.created + again.updated,0)
}))

test('旧八月累计100且已闭期：即使只生成九月，也必须409报告八月冲突', () => fixture(async f => {
  const r = await oldRoot(f,100), before = await snapshot(f,r.id)
  await closeAugust(f)
  await assert.rejects(f.generate('209709'),e => e.code==='ACCT_SALE_CLOSED_PERIOD_CONFLICT' && e.statusCode===409 && e.data.orderId===f.orderId && e.data.period==='209708')
  assert.deepEqual(await snapshot(f,r.id),before)
  assert.equal(await f.net('209709'),0)
}))

test('旧累计根人工红冲后不自动复活收入；独立成本仍可生成', () => fixture(async f => {
  const r = await oldRoot(f,100)
  await manualReverse(f,r.id)
  await f.generate()
  assert.equal(await f.net('209708'),0)
  assert.equal(await f.net('209709'),0)
  assert.equal(await f.net('209709','6401'),15)
}))

test('期间根人工红冲仅停止该期间收入，后月不重复补回', () => fixture(async f => {
  await f.generate()
  const [[r]] = await f.conn.query("SELECT id FROM acct_vouchers WHERE company_id=? AND source_type='sale_revenue' AND source_period='209708'",[f.companyId])
  await manualReverse(f,r.id)
  await f.generate()
  assert.equal(await f.net('209708'),0)
  assert.equal(await f.net('209709'),50)
}))

test('自动修订金额变化/归零/恢复保留旧分录，并且每次重算幂等', () => fixture(async f => {
  await f.generate()
  const [[r]] = await f.conn.query("SELECT id FROM acct_vouchers WHERE company_id=? AND source_type='sale_revenue' AND source_period='209709'",[f.companyId])
  const originalEntries = (await snapshot(f,r.id)).entries
  await f.conn.query('UPDATE sale_order_items SET unit_price=2 WHERE id=?',[f.itemId])
  await f.generate()
  assert.equal(await f.net('209709'),100)
  await f.conn.query('UPDATE sale_order_items SET unit_price=0,cost_snapshot=0 WHERE id=?',[f.itemId])
  await f.generate()
  assert.equal(await f.net('209709'),0)
  assert.equal(await f.net('209709','6401'),0)
  await f.conn.query('UPDATE sale_order_items SET unit_price=1,cost_snapshot=.3 WHERE id=?',[f.itemId])
  await f.generate()
  assert.equal(await f.net('209709'),50)
  assert.equal(await f.net('209709','6401'),15)
  assert.deepEqual((await snapshot(f,r.id)).entries,originalEntries)
  const again = await f.generate()
  assert.equal(again.created + again.updated,0)
}))

for (const [name, mutate] of [
  ['缺出库日期', f => f.conn.query('UPDATE warehouse_tasks SET shipped_at=NULL WHERE id=?',[f.tasks[0]])],
  ['错误来源商品', f => f.conn.query('UPDATE warehouse_task_items SET product_id=0 WHERE task_id=?',[f.tasks[0]])],
  ['累计数量错位', f => f.conn.query('UPDATE sale_order_items SET shipped_qty=99 WHERE id=?',[f.itemId])],
  ['历史累计量没有任务事实', f => f.conn.query('UPDATE warehouse_tasks SET deleted_at=NOW() WHERE sale_order_id=?',[f.orderId])],
  ['重复销售行关联', f => f.conn.query(`INSERT INTO sale_order_items(order_id,product_id,product_code,product_name,unit,quantity,warehouse_id)
    VALUES (?,?,'F04','重复行','个',1,?)`,[f.orderId,f.prod,f.wh])],
]) test(`${name}必须fail-loud且不能吞成跳过`, () => fixture(async f => {
  await mutate(f)
  await assert.rejects(f.generate('209709'), e => e.code==='ACCT_SALE_SOURCE_INVALID' && e.data.orderId===f.orderId)
}))

test('折扣、整单税额、成本尾差按累计差额分配，三期合计精确等于整单', () => fixture(async f => {
  await f.conn.query('UPDATE sale_orders SET total_amount=1,discount_amount=.1 WHERE id=?',[f.orderId])
  await f.conn.query('UPDATE sale_order_items SET quantity=3,shipped_qty=3,unit_price=.3333,cost_snapshot=.1667 WHERE id=?',[f.itemId])
  await f.conn.query('UPDATE warehouse_task_items SET required_qty=1,picked_qty=1 WHERE task_id IN (?,?)',f.tasks)
  const taskId = await f.insert(`INSERT INTO warehouse_tasks(task_no,sale_order_id,customer_name,warehouse_id,warehouse_name,status,shipped_at)
    VALUES (?,?,'跨期回归客户',?,'跨期回归仓',7,'2097-10-15')`,[unique(),f.orderId,f.wh])
  await f.insert(`INSERT INTO warehouse_task_items(task_id,product_id,product_code,product_name,unit,required_qty,picked_qty)
    VALUES (?,?,'F04','跨期回归商品','个',1,1)`,[taskId,f.prod])
  const rev = (await engine.buildSaleRevenue(f.conn,new Map([[f.orderId,.5]]))).filter(s => Number(s.sourceId)===f.orderId)
  const amt = (s,c) => s.legs.filter(l=>l.code===c).reduce((n,l)=>n+Number(l.amount),0)
  assert.deepEqual(rev.map(s=>amt(s,'1122')),[.3,.3,.3])
  assert.deepEqual(rev.map(s=>amt(s,'222102')),[.3,.2,0])
  const cogs = (await engine.buildSaleCogs(f.conn)).filter(s=>Number(s.sourceId)===f.orderId)
  assert.deepEqual(cogs.map(s=>amt(s,'6401')),[.17,.16,.17])
}))

test('结账前必须检查销售源凭证完整性：漏生成拒绝，生成后允许，事实变化再拒绝', () => fixture(async f => {
  await assert.rejects(() => engine.assertSalePeriodCurrent(f.conn,'209708',f.companyId),e => e.code==='ACCT_SALE_VOUCHER_REQUIRED')
  await f.generate('209708')
  await engine.assertSalePeriodCurrent(f.conn,'209708',f.companyId)
  await f.conn.query('UPDATE sale_order_items SET unit_price=2 WHERE id=?',[f.itemId])
  await assert.rejects(() => engine.assertSalePeriodCurrent(f.conn,'209708',f.companyId),e => e.code==='ACCT_SALE_VOUCHER_REQUIRED')
}))

test('真实结账入口拒绝未生成销售；完整投影与结转完成后才允许', () => fixture(async f => {
  const periods = require('../backend/src/modules/accounting/accounting.period.service')
  await assert.rejects(periods.closePeriod('209708',null,f.companyId),e=>e.code==='ACCT_SALE_VOUCHER_REQUIRED')
  await transactionalGenerate(f.companyId,'209708')
  await periods.generateClosingVouchers('209708',null,f.companyId)
  assert.equal((await periods.closePeriod('209708',null,f.companyId)).status,2)
}, { persist: true }))

async function transactionalGenerate(companyId, period = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const stats = await engine.generateVouchers(conn,{companyId,period})
    await conn.commit()
    return stats
  } catch(e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

test('同账套并发全量生成：只生成一次，无重复期间来源和凭证号', () => fixture(async f => {
  const result = await Promise.all([transactionalGenerate(f.companyId),transactionalGenerate(f.companyId)])
  assert.equal(result.reduce((n,s)=>n+s.updated,0),0)
  const [rows] = await f.conn.query("SELECT source_type,source_id,source_period,voucher_no FROM acct_vouchers WHERE company_id=? AND source_no=? AND source_type IN ('sale_revenue','sale_cogs')",[f.companyId,f.orderNo])
  assert.equal(rows.length,4)
  const [[all]] = await f.conn.query('SELECT COUNT(*) n FROM acct_vouchers WHERE company_id=?',[f.companyId])
  assert.equal(result.reduce((n,s)=>n+s.created,0),Number(all.n))
  assert.equal(new Set(rows.map(r=>r.voucher_no)).size,4)
  assert.equal(new Set(rows.map(r=>`${r.source_type}/${r.source_id}/${r.source_period}`)).size,4)
  assert.ok(rows.every(r=>Number(r.source_id)===f.orderId))
}, { persist: true }))

test('同一业务在不同账套独立生成，闭期和历史根不跨账套抵扣', () => fixture(async f => {
  await oldRoot(f,50)
  await oldRoot(f,15,'sale_cogs')
  await closeAugust(f)
  const other = await f.insert('INSERT INTO acct_companies(code,name) VALUES (?,?)',[unique(),'另一个跨期账套'])
  await f.conn.query(`INSERT INTO acct_accounts(company_id,code,name,category,balance_dir,is_leaf)
    SELECT ?,code,name,category,balance_dir,is_leaf FROM acct_accounts WHERE company_id=?`,[other,f.companyId])
  const stats = await engine.generateVouchers(f.conn,{companyId:other})
  assert.ok(stats.created>=4)
  await f.generate('209709')
  const [rows] = await f.conn.query(`SELECT v.company_id,v.period,SUM(IF(e.direction=1,e.amount,-e.amount)) amount FROM acct_vouchers v
    JOIN acct_voucher_entries e ON e.voucher_id=v.id WHERE v.company_id IN (?,?) AND v.source_no=? AND e.account_code='1122' GROUP BY v.company_id,v.period`,[f.companyId,other,f.orderNo])
  assert.equal(rows.length,4)
  assert.ok(rows.every(r=>Number(r.amount)===50))
}))

test('销售退货单独冲收入和成本，不从出库期间毛额重复扣减', () => fixture(async f => {
  const sr = await f.insert(`INSERT INTO sale_returns(return_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name,status)
    VALUES (?,1,'跨期回归客户',?,'跨期回归仓',1,'回归',3)`,[unique(),f.wh])
  const sri = await f.insert(`INSERT INTO sale_return_items(return_id,product_id,product_code,product_name,unit,quantity,sale_item_id,unit_price)
    VALUES (?,?,'F04','回归商品','个',20,?,1)`,[sr,f.prod,f.itemId])
  const rt = await f.insert(`INSERT INTO return_tasks(task_no,return_type,return_id,return_no,warehouse_id,status)
    VALUES (?,'sale',?,'F04',?,5)`,[unique(),sr,f.wh])
  await f.insert(`INSERT INTO return_task_items(task_id,product_id,product_code,product_name,unit,return_item_id,checked_qty,rejected_qty)
    VALUES (?,?,'F04','回归商品','个',?,20,0)`,[rt,f.prod,sri])
  await f.conn.query('UPDATE payment_records SET total_amount=80,balance=80 WHERE type=2 AND order_id=?',[f.orderId])
  await f.generate()
  assert.equal(await f.net('209708'),50)
  assert.equal(await f.net('209709'),50)
  const ret = (await engine.buildSaleReturn(f.conn)).find(s=>Number(s.sourceId)===sr)
  assert.equal(ret.legs.find(l=>l.code==='1122').amount,20)
  assert.equal(ret.legs.find(l=>l.code==='6401').amount,6)
}))

test('期间根经过自动修订后再人工红冲，仍停止自动恢复', () => fixture(async f => {
  await f.generate('209709')
  await f.conn.query('UPDATE sale_order_items SET unit_price=2 WHERE id=?',[f.itemId])
  await f.generate('209709')
  const [[latest]] = await f.conn.query("SELECT id FROM acct_vouchers WHERE company_id=? AND source_type='sale_revenue' AND period='209709' AND is_reversal=0 ORDER BY id DESC LIMIT 1",[f.companyId])
  await manualReverse(f,latest.id)
  await f.generate('209709')
  assert.equal(await f.net('209709'),0)
}))

test('已有期间投影的闭期金额变化，在只生成后期时也不可绕过', () => fixture(async f => {
  await f.generate()
  await closeAugust(f)
  await f.conn.query('UPDATE sale_order_items SET unit_price=2 WHERE id=?',[f.itemId])
  await assert.rejects(f.generate('209709'),e=>e.code==='ACCT_SALE_CLOSED_PERIOD_CONFLICT' && e.data.period==='209708')
  assert.equal(await f.net('209708'),50)
  assert.equal(await f.net('209709'),50)
}))

test('旧事务快照之后写入的历史累计根也必须被抵扣', () => fixture(async f => {
  const stale = await pool.getConnection()
  try {
    await stale.beginTransaction()
    await stale.query('SELECT id FROM acct_vouchers WHERE company_id=?',[f.companyId])
    await f.conn.beginTransaction()
    await oldRoot(f,50)
    await oldRoot(f,15,'sale_cogs')
    await f.conn.commit()
    await engine.generateVouchers(stale,{companyId:f.companyId,period:'209708'})
    const [[r]] = await stale.query("SELECT COUNT(*) n FROM acct_vouchers WHERE company_id=? AND source_id=? AND source_period='209708' FOR UPDATE",[f.companyId,f.orderId])
    assert.equal(Number(r.n),0,'应抵扣刚提交的旧累计根，不能再造一份八月期间凭证')
  } finally { await stale.rollback(); stale.release() }
}, { persist:true }))

test('销售金额在DECIMAL(16,2)全域精确写入、修订及抵扣一分钱', () => fixture(async f => {
  const max = '99999999999999.99', less = '99999999999999.98'
  const make = amount => ({sourceType:'sale_revenue',sourceId:f.orderId,sourceNo:f.orderNo,sourcePeriod:'209708',voucherDate:'2097-08-15',legs:[
    {code:'1122',direction:1,amount,auxType:1,auxId:1,auxName:'跨期回归客户'},
    {code:'6001',direction:2,amount},
  ]})
  const accountMap = await engine.loadAccountMap(f.conn,f.companyId)
  const alloc = await engine.makeSeqAllocator(f.conn,f.companyId)
  const root = await engine.upsertVoucher(f.conn,make(max),accountMap,alloc,null,f.companyId)
  const first = await snapshot(f,root.id)
  assert.equal(first.voucher[0].total_debit,max)
  assert.equal(first.voucher[0].total_credit,max)
  assert.ok(first.entries.every(e=>e.amount===max))
  await engine.upsertVoucher(f.conn,make(less),accountMap,alloc,null,f.companyId)
  const [[net]] = await f.conn.query(`SELECT SUM(IF(e.direction=1,e.amount,-e.amount)) amount FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
    WHERE v.company_id=? AND e.account_code='1122'`,[f.companyId])
  assert.equal(net.amount,less)
  const {reconcileSalePeriods}=require('../backend/src/modules/accounting/voucher-sale-periods')
  await assert.rejects(reconcileSalePeriods(f.conn,[make(max)],{companyId:f.companyId,closedPeriods:new Set(['209708'])}),e=>e.code==='ACCT_SALE_CLOSED_PERIOD_CONFLICT')
  await reconcileSalePeriods(f.conn,[make(less)],{companyId:f.companyId,closedPeriods:new Set(['209708'])})
  assert.deepEqual((await snapshot(f,root.id)).entries,first.entries)
}))

test('勾稽包含直接冲销业务来源的人工红字，排除无关手工凭证及其红字', () => fixture(async f => {
  const service=require('../backend/src/modules/accounting/accounting.voucher.service')
  await f.conn.beginTransaction()
  const accountMap=await engine.loadAccountMap(f.conn,f.companyId), alloc=await engine.makeSeqAllocator(f.conn,f.companyId)
  const sources=[
    ['sale_revenue','1122','6001',100],
    ['purchase_settle','1405','2202',50],
    ['receipt_in','1002','1122',30],
  ]
  const roots=[]
  for(const [sourceType,debit,credit,amount] of sources) roots.push(await engine.upsertVoucher(f.conn,{
    sourceType,sourceId:f.orderId,sourceNo:f.orderNo,voucherDate:'2097-08-15',legs:[{code:debit,direction:1,amount},{code:credit,direction:2,amount}],
  },accountMap,alloc,null,f.companyId))
  await f.conn.commit()
  const manual=await service.createManualVoucher({companyId:f.companyId,voucherDate:'2097-08-15',entries:[
    {accountId:accountMap.get('1122').id,direction:1,amount:777},
    {accountId:accountMap.get('1001').id,direction:2,amount:777},
  ]},null)
  const before=await service.reconciliation(f.companyId)
  assert.deepEqual(before.items.map(i=>i.voucher),[30,50,100])
  for(const root of roots) await service.reverseVoucher(root.id,null,f.companyId)
  const after=await service.reconciliation(f.companyId)
  assert.deepEqual(after.items.map(i=>i.voucher),[0,0,0])
  await service.reverseVoucher(manual.id,null,f.companyId)
  assert.deepEqual((await service.reconciliation(f.companyId)).items.map(i=>i.voucher),[0,0,0])
}, {persist:true}))

test('八位单价的大额真实来源生成与再次重算均不丢分', () => fixture(async f => {
  await f.conn.query('UPDATE sale_orders SET total_amount=? WHERE id=?',['9999999999.9999',f.orderId])
  await f.conn.query('UPDATE sale_order_items SET quantity=?,shipped_qty=?,unit_price=?,cost_snapshot=0 WHERE id=?',['9999999.99','9999999.99','10000000.00999999',f.itemId])
  await f.conn.query('UPDATE warehouse_task_items SET required_qty=?,picked_qty=? WHERE task_id=?',['9999999.99','9999999.99',f.tasks[0]])
  await f.conn.query('UPDATE warehouse_tasks SET status=6,shipped_at=NULL WHERE id=?',[f.tasks[1]])
  await f.generate('209708')
  const [[v]]=await f.conn.query("SELECT id,total_debit,total_credit FROM acct_vouchers WHERE company_id=? AND source_id=? AND source_type='sale_revenue' AND source_period='209708'",[f.companyId,f.orderId])
  assert.equal(v.total_debit,'99999999999999.90')
  assert.equal(v.total_credit,'99999999999999.90')
  const [entries]=await f.conn.query('SELECT amount FROM acct_voucher_entries WHERE voucher_id=?',[v.id])
  assert.ok(entries.every(e=>e.amount==='99999999999999.90'))
  const again=await f.generate('209708')
  assert.equal(again.created+again.updated,0)
}))

test('最大合法销售金额人工红冲也精确复制头金额与分录', () => fixture(async f => {
  const service=require('../backend/src/modules/accounting/accounting.voucher.service')
  await f.conn.beginTransaction()
  const root=await oldRoot(f,'99999999999999.99')
  await f.conn.commit()
  const reversal=await service.reverseVoucher(root.id,null,f.companyId)
  const [[v]]=await f.conn.query('SELECT total_debit,total_credit FROM acct_vouchers WHERE id=?',[reversal.id])
  assert.equal(v.total_debit,'99999999999999.99')
  assert.equal(v.total_credit,'99999999999999.99')
  const [[net]]=await f.conn.query(`SELECT SUM(IF(e.direction=1,e.amount,-e.amount)) amount FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
    WHERE v.company_id=? AND e.account_code='1122'`,[f.companyId])
  assert.equal(net.amount,'0.00')
}, {persist:true}))
