'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const REPAIR_ID = 'legacy-purchases-20260908-v1'
const EVENT_TYPE = 'LEGACY_PURCHASE_REPAIRED'
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const guard = (ok, message) => { if (!ok) throw new Error(`REPAIR_GUARD: ${message}`) }
const eq = (value, expected) => Number(value) === expected
const suffixes = ['20260324001', '20260324002', '20260325001', '20260328001']

function buildPlan(s) {
  guard(Object.values(s.dependencies).every(rows => rows.length === 0), '出现下游引用或待执行打印')
  const done = s.events.length === 4 && s.events.every(e => e.event_type === EVENT_TYPE)
    && new Set(s.events.map(e => Number(e.task_id))).size === 4
    && s.paymentEvents.length === 1 && s.paymentEvents[0].request_id === REPAIR_ID
    && s.paymentEvents[0].event_type === EVENT_TYPE
  guard(done || (s.events.length === 0 && s.paymentEvents.length === 0), '审计记录已变化或修复不完整')
  guard(s.tasks.length === 4 && s.purchases.length === 4 && s.purchaseItems.length === 4 && s.items.length === 4, '目标单据集合变化')
  for (let i = 0; i < 4; i++) {
    const id = i + 1, t = s.tasks[i], p = s.purchases[i], pi = s.purchaseItems[i], item = s.items[i]
    guard(eq(p.id, id) && p.order_no === 'PO' + suffixes[i] && eq(p.status, i === 0 ? 3 : 4)
      && eq(p.total_amount, 33.13) && eq(p.warehouse_id, 1) && p.deleted_at === null, '采购身份/状态/金额变化')
    guard(eq(pi.id, id) && eq(pi.order_id, id) && eq(pi.product_id, 1) && eq(pi.quantity, 1)
      && eq(pi.unit_price, 33.13) && eq(pi.amount, 33.13), '采购明细变化')
    guard(eq(t.id, id) && t.task_no === 'IT' + suffixes[i] && eq(t.purchase_order_id, id)
      && t.purchase_order_no === p.order_no && eq(t.warehouse_id, 1) && t.deleted_at === null
      && eq(t.status, done ? (i === 0 ? 4 : 5) : 3) && eq(t.audit_status, done && i === 0 ? 1 : 0), '收货身份/状态变化')
    guard(eq(item.id, id) && eq(item.task_id, id) && eq(item.product_id, 1) && eq(item.ordered_qty, 1)
      && eq(item.received_qty, done && i > 0 ? 0 : 1) && eq(item.putaway_qty, done && i === 0 ? 1 : 0), '收货数量变化')
    guard(done ? (eq(item.purchase_order_id, id) && eq(item.purchase_item_id, id) && item.purchase_order_no === p.order_no)
      : (item.purchase_order_id === null && item.purchase_item_id === null && item.purchase_order_no === null), '收货来源变化')
  }
  guard(s.containers.length === 5, '容器集合变化（含衍生容器）')
  const barcodes = ['CNT001001', 'CNT010011', 'CNT100111', 'CNT1001111', 'CNT10011111']
  for (let i = 0; i < 5; i++) {
    const c = s.containers[i], taskId = i === 4 ? 1 : i + 1
    guard(eq(c.id, 101 + i) && c.barcode === barcodes[i] && eq(c.product_id, 1) && eq(c.warehouse_id, 1)
      && eq(c.initial_qty, 1) && eq(c.remaining_qty, done && i > 0 ? 0 : 1)
      && eq(c.status, i === 0 ? 1 : (done ? 3 : 4)) && c.deleted_at === null
      && c.parent_id === null && c.locked_by_task_id === null && c.location_id === null, '容器已改变或被后续动作使用')
    guard(i === 0 && !done ? c.inbound_task_id === null && c.inbound_task_item_id === null
      : eq(c.inbound_task_id, taskId) && eq(c.inbound_task_item_id, taskId), '容器收货归属变化')
    guard(c.source_ref_type === (i === 0 ? 'purchase_order' : 'inbound_task') && eq(c.source_ref_id, taskId)
      && c.source_ref_no === (i === 0 ? 'PO' : 'IT') + suffixes[taskId - 1], '容器历史来源变化')
  }
  guard(s.stock.length === 1 && eq(s.stock[0].product_id, 1) && eq(s.stock[0].warehouse_id, 1)
    && eq(s.stock[0].quantity, 100) && eq(s.stock[0].reserved, 0), '库存维度变化')
  guard(s.logs.length === 1 && eq(s.logs[0].id, 108) && s.logs[0].ref_type === 'purchase_order'
    && eq(s.logs[0].ref_id, 1) && s.logs[0].ref_no === 'PO20260324001' && eq(s.logs[0].quantity, 1)
    && eq(s.logs[0].unit_price, 33.13) && eq(s.logs[0].move_type, 1) && eq(s.logs[0].product_id, 1)
    && eq(s.logs[0].warehouse_id, 1), '原始入库证据变化')
  guard(s.payments.length === 1, '应付集合变化')
  const payment = s.payments[0]
  guard(eq(payment.id, 6) && eq(payment.type, 1) && eq(payment.order_id, 1)
    && payment.order_no === 'PO20260324001' && payment.party_name === s.purchases[0].supplier_name
    && eq(payment.total_amount, 33.13) && eq(payment.balance, 33.13) && eq(payment.paid_amount, 0), '应付来源或金额变化')
  return { repairId: REPAIR_ID, alreadyApplied: done, payable: 33.13,
    completeTaskIds: done ? [] : [1], cancelTaskIds: done ? [] : [2, 3, 4], voidContainerIds: done ? [] : [102, 103, 104, 105] }
}

async function snapshot(conn, lock = false) {
  const select = async sql => {
    const [rows] = await conn.query(`${sql} LIMIT 1001${lock ? ' FOR UPDATE' : ''}`)
    guard(rows.length <= 1000, '引用数量超过定向修复边界')
    return rows
  }
  return {
    tasks: await select('SELECT * FROM inbound_tasks WHERE id IN (1,2,3,4) OR purchase_order_id IN (1,2,3,4) ORDER BY id'),
    purchases: await select('SELECT * FROM purchase_orders WHERE id IN (1,2,3,4) ORDER BY id'),
    purchaseItems: await select('SELECT * FROM purchase_order_items WHERE order_id IN (1,2,3,4) ORDER BY id'),
    items: await select('SELECT * FROM inbound_task_items WHERE task_id IN (1,2,3,4) OR purchase_order_id IN (1,2,3,4) ORDER BY id'),
    stock: await select('SELECT * FROM inventory_stock WHERE product_id=1 AND warehouse_id=1 ORDER BY id'),
    containers: await select('SELECT * FROM inventory_containers WHERE id BETWEEN 101 AND 105 OR parent_id BETWEEN 101 AND 105 OR inbound_task_id IN (1,2,3,4) ORDER BY id'),
    logs: await select("SELECT * FROM inventory_logs WHERE container_id BETWEEN 101 AND 105 OR (ref_type='purchase_order' AND ref_id IN (1,2,3,4)) ORDER BY id"),
    payments: await select('SELECT * FROM payment_records WHERE (type=1 AND order_id IN (1,2,3,4)) OR id=6 ORDER BY id'),
    events: await select('SELECT * FROM inbound_task_events WHERE task_id IN (1,2,3,4) ORDER BY id'),
    paymentEvents: await select('SELECT * FROM payment_record_events WHERE payment_record_id=6 ORDER BY id'),
    dependencies: {
      returns: await select('SELECT * FROM purchase_returns WHERE purchase_order_id IN (1,2,3,4) ORDER BY id'),
      entries: await select('SELECT * FROM payment_entries WHERE record_id=6 ORDER BY id'),
      refunds: await select('SELECT * FROM refund_orders WHERE payment_record_id=6 ORDER BY id'),
      statements: await select('SELECT * FROM reconciliation_statement_items WHERE record_id=6 ORDER BY id'),
      invoices: await select('SELECT * FROM fin_invoices ORDER BY id'),
      vouchers: await select('SELECT * FROM acct_vouchers ORDER BY id'),
      bindings: await select('SELECT * FROM sale_order_expected_bindings WHERE purchase_order_id IN (1,2,3,4) AND released_at IS NULL ORDER BY id'),
      printJobs: await select("SELECT id,status,ref_type,ref_id,ref_code FROM print_jobs WHERE status IN (0,1) AND ((ref_type='inbound_task' AND ref_id IN (1,2,3,4)) OR (ref_type IN ('container','inventory_container') AND ref_id BETWEEN 101 AND 105) OR ref_code IN ('CNT001001','CNT010011','CNT100111','CNT1001111','CNT10011111')) ORDER BY id"),
    },
  }
}

async function runRepair(conn, { apply = false, expectedHash, backupFile } = {}) {
  await conn.query('SET SESSION MAX_EXECUTION_TIME=10000')
  await conn.query('SET SESSION innodb_lock_wait_timeout=5')
  await conn.query(`SET TRANSACTION ISOLATION LEVEL ${apply ? 'SERIALIZABLE' : 'REPEATABLE READ'}`)
  await conn.query(`SET TRANSACTION ${apply ? 'READ WRITE' : 'READ ONLY'}`)
  await conn.beginTransaction()
  try {
    const before = await snapshot(conn, apply), plan = buildPlan(before), hash = digest(before)
    if (!apply || plan.alreadyApplied) { await conn.rollback(); return { ...plan, snapshotHash: hash, committed: false } }
    guard(hash === expectedHash, '缺少预检摘要或数据已变化')
    guard(typeof backupFile === 'string' && path.isAbsolute(backupFile), '必须提供绝对路径私有备份')
    const fd = fs.openSync(backupFile, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify({ repairId: REPAIR_ID, before, plan, snapshotHash: hash }, null, 2) + '\n'); fs.fsyncSync(fd) }
    finally { fs.closeSync(fd) }
    const backupHash = crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex')
    for (let id = 1; id <= 4; id++) {
      const [r] = await conn.query(`UPDATE inbound_task_items SET purchase_order_id=?,purchase_order_no=?,purchase_item_id=?,received_qty=?,putaway_qty=?
        WHERE id=? AND purchase_order_id IS NULL AND purchase_item_id IS NULL AND received_qty=1 AND putaway_qty=0`,
      [id, 'PO' + suffixes[id - 1], id, id === 1 ? 1 : 0, id === 1 ? 1 : 0, id])
      guard(r.affectedRows === 1, '收货明细 CAS 失败')
    }
    const [active] = await conn.query('UPDATE inventory_containers SET inbound_task_id=1,inbound_task_item_id=1 WHERE id=101 AND status=1 AND inbound_task_id IS NULL AND remaining_qty=1')
    guard(active.affectedRows === 1, '历史在库容器归属 CAS 失败')
    for (const id of plan.voidContainerIds) {
      const [r] = await conn.query('UPDATE inventory_containers SET status=3,remaining_qty=0 WHERE id=? AND status=4 AND remaining_qty=1 AND locked_by_task_id IS NULL', [id])
      guard(r.affectedRows === 1, '待上架条码 CAS 失败')
    }
    const [finished] = await conn.query(`UPDATE inbound_tasks SET status=4,audit_status=1,audited_at=NOW(),audited_by_name='历史入库核对',
      audit_remark='按原始入库流水108及在库容器101补齐结算事实',lock_version=lock_version+1 WHERE id=1 AND status=3 AND audit_status=0`)
    guard(finished.affectedRows === 1, '完成收货 CAS 失败')
    for (const id of plan.cancelTaskIds) {
      const [r] = await conn.query("UPDATE inbound_tasks SET status=5,closed_reason='legacy_reconcile',lock_version=lock_version+1 WHERE id=? AND status=3 AND audit_status=0", [id])
      guard(r.affectedRows === 1, '取消收货 CAS 失败')
    }
    for (let id = 1; id <= 4; id++) {
      const description = id === 1 ? '按原始入库流水和在库容器补齐历史结算，作废重复未上架记录；不新增库存或应付'
        : '按用户授权随已取消采购关闭遗留收货，作废未上架条码；未执行实物退货或扣减在库库存'
      await conn.query(`INSERT INTO inbound_task_events(task_id,event_type,title,description,payload_json,created_by_name) VALUES(?,?,?,?,?,?)`,
        [id, EVENT_TYPE, '历史采购收货数据校正', description,
          JSON.stringify({ repairId: REPAIR_ID, beforeTask: before.tasks[id - 1], beforeItem: before.items[id - 1],
            voidContainerIds: id === 1 ? [105] : [100 + id], sourceContainerId: id === 1 ? 101 : null, snapshotHash: hash, backupHash }), '授权数据修复'])
    }
    await conn.query(`INSERT INTO payment_record_events(payment_record_id,order_no,event_type,title,description,payload_json,created_by_name,request_id)
      VALUES(6,'PO20260324001',?,?,?,?,?,?)`, [EVENT_TYPE, '历史应付来源补齐', '补齐原入库的收货结算来源，应付33.13及已付0保持不变',
      JSON.stringify({ repairId: REPAIR_ID, sourceLogId: 108, sourceContainerId: 101, before: 33.13, after: 33.13, snapshotHash: hash, backupHash }), '授权数据修复', REPAIR_ID])
    const after = await snapshot(conn, true)
    guard(buildPlan(after).alreadyApplied, '修复后状态复核失败')
    for (const field of ['stock', 'payments', 'purchases', 'purchaseItems', 'logs']) guard(digest(before[field]) === digest(after[field]), `${field}不应改变`)
    await conn.commit()
    return { ...plan, committed: true, snapshotHash: hash, backupHash }
  } catch (error) { await conn.rollback(); throw error }
}

async function main() {
  const args = process.argv.slice(2), value = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME', 'DB_PASSWORD']) guard(process.env[key] !== undefined, `缺少 ${key}`)
  const mysql = require(require.resolve('mysql2/promise', { paths: [process.cwd(), path.join(__dirname, '..')] }))
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, connectTimeout: 10000 })
  try { console.log(JSON.stringify(await runRepair(c, { apply: args.includes('--apply'), expectedHash: value('--expected-hash'), backupFile: value('--backup') }))) }
  finally { await c.end() }
}
if (require.main === module) main().catch(e => { console.error(e.code || e.message); process.exitCode = 1 })
module.exports = { REPAIR_ID, EVENT_TYPE, digest, buildPlan, snapshot, runRepair }
