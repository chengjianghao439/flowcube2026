'use strict'

// 一次性、精确范围的历史修复。默认只读；不调用出库业务，不触碰库存或资金流水。
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const REPAIR_ID = 'legacy-receivables-20260908-v1'
const EVENT_TYPE = 'LEGACY_RECEIVABLE_REPAIRED'
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const guard = (ok, message) => { if (!ok) throw new Error(`REPAIR_GUARD: ${message}`) }
const eq = (actual, expected) => Number(actual) === expected

function buildPlan(s) {
  guard(Object.values(s.dependencies).every(rows => rows.length === 0), '存在下游财务引用或退货，停止定向修复')
  guard(s.orders.length === 2 && s.items.length === 3 && s.payments.length === 2, '目标行集合变化')
  const done = s.paymentEvents.length === 2 && s.saleEvents.length === 1
    && s.paymentEvents.every(e => e.request_id === REPAIR_ID && e.event_type === EVENT_TYPE)
    && s.saleEvents[0].event_type === EVENT_TYPE
    && s.saleEvents[0].sale_order_id === 1
    && new Set(s.paymentEvents.map(e => Number(e.payment_record_id))).size === 2
  guard(done || (s.paymentEvents.length === 0 && s.saleEvents.length === 0), '审计事件变化或修复状态不完整')
  const orderNos = ['SO20260315001', 'SO20260326001']
  for (let i = 0; i < 2; i++) {
    const o = s.orders[i], p = s.payments[i]
    guard(eq(o.id, i + 1) && o.order_no === orderNos[i] && eq(o.warehouse_id, 1), '订单身份变化')
    guard(eq(o.status, i === 0 ? 4 : 5) && (i === 0 ? o.deleted_at === null : !!o.deleted_at), '订单状态变化')
    guard(eq(o.total_amount, i === 0 ? 358.43 : 190.48) && eq(o.discount_amount, 0), '订单金额变化')
    guard(eq(p.id, i + 1) && eq(p.type, 2) && eq(p.order_id, o.id) && p.order_no === o.order_no && p.party_name === o.customer_name, '账款来源变化')
    const amount = done ? [358.43, 0][i] : [379.8, 122.27][i]
    guard(eq(p.total_amount, amount) && eq(p.balance, amount) && eq(p.paid_amount, 0), '账款金额变化')
    guard(eq(p.status, done && i === 1 ? 3 : 1) && eq(p.confirm_status, 1) && eq(p.settlement_type, 2), '账款状态变化')
  }
  for (let i = 0; i < 3; i++) {
    const row = s.items[i]
    guard(eq(row.id, i + 1) && eq(row.order_id, i < 2 ? 1 : 2) && eq(row.warehouse_id, 1)
      && eq(row.product_id, [11, 14, 1][i]) && eq(row.quantity, 1)
      && eq(row.unit_price, [164.62, 193.81, 190.48][i]) && eq(row.amount, [164.62, 193.81, 190.48][i])
      && eq(row.shipped_qty, done && i < 2 ? 1 : 0), '销售明细变化')
  }
  guard(s.tasks.length === 1 && s.taskItems.length === 2, '仓库任务集合变化')
  const t = s.tasks[0]
  guard(eq(t.id, 1) && t.task_no === 'WT20260315001' && t.task_type === 'sale_out'
    && eq(t.sale_order_id, 1) && t.sale_order_no === orderNos[0] && eq(t.warehouse_id, 1)
    && eq(t.status, 7) && !!t.shipped_at && t.deleted_at === null, '出库事实变化')
  for (const productId of [11, 14]) {
    const rows = s.taskItems.filter(r => eq(r.product_id, productId))
    guard(rows.length === 1 && eq(rows[0].task_id, 1) && eq(rows[0].required_qty, 1)
      && eq(rows[0].picked_qty, 1) && eq(rows[0].checked_qty, 1), '出库商品或数量不匹配')
  }
  return {
    repairId: REPAIR_ID, alreadyApplied: done,
    shipped: done ? [] : [{ id: 1, before: 0, after: 1 }, { id: 2, before: 0, after: 1 }],
    payments: done ? [] : [{ id: 1, before: 379.8, after: 358.43 }, { id: 2, before: 122.27, after: 0 }],
  }
}

async function snapshot(conn, lock = false) {
  const select = async sql => {
    const [rows] = await conn.query(`${sql} LIMIT 1001${lock ? ' FOR UPDATE' : ''}`)
    guard(rows.length <= 1000, '引用超过定向修复上限')
    return rows
  }
  // 与业务写入保持先销售单、后明细/任务/账款的锁顺序；锁等待有界。
  return {
    orders: await select('SELECT * FROM sale_orders WHERE id IN (1,2) ORDER BY id'),
    items: await select('SELECT * FROM sale_order_items WHERE order_id IN (1,2) ORDER BY id'),
    tasks: await select('SELECT * FROM warehouse_tasks WHERE sale_order_id IN (1,2) ORDER BY id'),
    taskItems: await select('SELECT * FROM warehouse_task_items WHERE task_id IN (SELECT id FROM warehouse_tasks WHERE sale_order_id IN (1,2)) ORDER BY id'),
    payments: await select('SELECT * FROM payment_records WHERE (type=2 AND order_id IN (1,2)) OR id IN (1,2) ORDER BY id'),
    paymentEvents: await select('SELECT * FROM payment_record_events WHERE payment_record_id IN (1,2) ORDER BY id'),
    saleEvents: await select('SELECT * FROM sale_order_events WHERE sale_order_id IN (1,2) ORDER BY id'),
    dependencies: {
      entries: await select('SELECT * FROM payment_entries WHERE record_id IN (1,2) ORDER BY id'),
      statements: await select('SELECT * FROM reconciliation_statement_items WHERE record_id IN (1,2) ORDER BY id'),
      refunds: await select('SELECT * FROM refund_orders WHERE payment_record_id IN (1,2) ORDER BY id'),
      returns: await select('SELECT * FROM sale_returns WHERE sale_order_id IN (1,2) ORDER BY id'),
      // 本次生产三表为空；任何新增凭证/发票/期间要求重新评估，不自动跨会计期间调整。
      invoices: await select('SELECT * FROM fin_invoices ORDER BY id'),
      vouchers: await select('SELECT * FROM acct_vouchers ORDER BY id'),
      periods: await select('SELECT * FROM acct_periods ORDER BY company_id,period'),
    },
  }
}

function saveBackup(file, value) {
  guard(typeof file === 'string' && path.isAbsolute(file), '必须提供绝对路径备份文件')
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd) }
  finally { fs.closeSync(fd) }
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function runRepair(conn, { apply = false, expectedHash, backupFile } = {}) {
  await conn.query('SET SESSION MAX_EXECUTION_TIME=10000')
  await conn.query('SET SESSION innodb_lock_wait_timeout=5')
  await conn.query(`SET TRANSACTION ISOLATION LEVEL ${apply ? 'SERIALIZABLE' : 'REPEATABLE READ'}`)
  await conn.query(`SET TRANSACTION ${apply ? 'READ WRITE' : 'READ ONLY'}`)
  await conn.beginTransaction()
  try {
    const before = await snapshot(conn, apply)
    const plan = buildPlan(before)
    const hash = digest(before)
    if (!apply || plan.alreadyApplied) {
      await conn.rollback()
      return { ...plan, snapshotHash: hash, committed: false }
    }
    guard(expectedHash === hash, '预检快照已变化或缺少 --expected-hash')
    const backupHash = saveBackup(backupFile, { repairId: REPAIR_ID, snapshotHash: hash, before, plan })
    for (const row of plan.shipped) {
      const [result] = await conn.query('UPDATE sale_order_items SET shipped_qty=? WHERE id=? AND shipped_qty=?', [row.after, row.id, row.before])
      guard(result.affectedRows === 1, '已发数量 CAS 失败')
    }
    for (const row of plan.payments) {
      const [result] = await conn.query('UPDATE payment_records SET total_amount=?,balance=?,status=? WHERE id=? AND total_amount=? AND paid_amount=0',
        [row.after, row.after, row.after === 0 ? 3 : 1, row.id, row.before])
      guard(result.affectedRows === 1, '账款 CAS 失败')
      await conn.query(`INSERT INTO payment_record_events
        (payment_record_id,order_no,event_type,title,description,payload_json,created_by_name,request_id)
        VALUES (?,?,?,?,?,?,?,?)`, [row.id, before.payments.find(p => eq(p.id, row.id)).order_no,
        EVENT_TYPE, '历史应收数据校正', row.id === 1 ? '按已完成出库明细校正应收；未登记收款' : '冲销已取消且无出库依据的历史应收；未登记收款',
        JSON.stringify({ repairId: REPAIR_ID, before: row.before, after: row.after, paidAmount: 0, evidenceTask: row.id === 1 ? 'WT20260315001' : null, snapshotHash: hash, backupHash }),
        '授权数据修复', REPAIR_ID])
    }
    await conn.query(`INSERT INTO sale_order_events
      (sale_order_id,event_type,title,description,payload_json,created_by_name) VALUES (?,?,?,?,?,?)`,
    [1, EVENT_TYPE, '历史已发数量补齐', '依据 WT20260315001 的已完成出库明细补齐两行已发数量；不重复扣减库存',
      JSON.stringify({ repairId: REPAIR_ID, shipped: plan.shipped, snapshotHash: hash, backupHash }), '授权数据修复'])
    guard(buildPlan(await snapshot(conn, true)).alreadyApplied, '提交前复核失败')
    await conn.commit()
    return { ...plan, snapshotHash: hash, backupHash, committed: true }
  } catch (error) {
    await conn.rollback()
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const value = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME']) guard(!!process.env[key], `缺少 ${key}`)
  guard(process.env.DB_PASSWORD !== undefined, '缺少 DB_PASSWORD')
  const mysql = require(require.resolve('mysql2/promise', { paths: [process.cwd(), path.join(__dirname, '..')] }))
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, connectTimeout: 10000 })
  try { console.log(JSON.stringify(await runRepair(c, { apply, expectedHash: value('--expected-hash'), backupFile: value('--backup') }))) }
  finally { await c.end() }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1 })
module.exports = { REPAIR_ID, EVENT_TYPE, buildPlan, digest, snapshot, runRepair }
