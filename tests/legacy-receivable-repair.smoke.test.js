'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const config = validateTestEnvironment()
// 固定 ID 仅用于本专项全新测试库，不在其他共享测试库清理数据。
assert.equal(config.database, 'flowcube_repair20260908_test')
const mysql = require('../backend/node_modules/mysql2/promise')
const { fixture } = require('./helpers/legacyReceivableFixture')
const { runRepair, snapshot, digest, buildPlan } = require('../backend/scripts/repair-legacy-receivables-20260908.cjs')

test('真实 MySQL：预检、回滚、漂移拒绝、备份保护、应用与幂等', async t => {
  const conn = await mysql.createConnection({ ...config, dateStrings: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-repair-test-'))
  const cleanup = async () => {
    for (const table of ['payment_entries', 'payment_record_events', 'sale_order_events', 'warehouse_task_items', 'warehouse_tasks', 'sale_order_items', 'payment_records', 'sale_orders']) {
      await conn.query(`DELETE FROM ${table}`)
    }
  }
  const seed = async () => {
    await cleanup()
    const f = fixture()
    const insert = async (table, row) => conn.query(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row))
    for (const row of f.orders) await insert('sale_orders', { ...row, customer_id: row.id, warehouse_name: '独立测试仓', operator_id: 1, operator_name: '回归测试' })
    for (const row of f.items) await insert('sale_order_items', { ...row, product_code: `TEST${row.product_id}`, product_name: '模拟商品', unit: '个' })
    for (const row of f.tasks) await insert('warehouse_tasks', { ...row, customer_id: 1, customer_name: '甲', warehouse_name: '独立测试仓' })
    for (const row of f.taskItems) await insert('warehouse_task_items', { ...row, product_code: `TEST${row.product_id}`, product_name: '模拟商品', unit: '个' })
    for (const row of f.payments) await insert('payment_records', { ...row, due_date: '2026-04-04' })
  }
  try {
    await seed()
    await t.test('默认预检不改变数据', async () => {
      const before = digest(await snapshot(conn))
      assert.equal((await runRepair(conn)).committed, false)
      assert.equal(digest(await snapshot(conn)), before)
    })
    await t.test('备份目录不可写时禁止任何改动', async () => {
      const before = await runRepair(conn)
      await assert.rejects(runRepair(conn, { apply: true, expectedHash: before.snapshotHash, backupFile: path.join(dir, 'missing', 'backup.json') }), /ENOENT/)
      assert.equal((await runRepair(conn)).snapshotHash, before.snapshotHash)
    })
    await t.test('预检后的新业务变化拒绝应用', async () => {
      const before = await runRepair(conn)
      await conn.query("UPDATE sale_orders SET remark='新增备注' WHERE id=1")
      await assert.rejects(runRepair(conn, { apply: true, expectedHash: before.snapshotHash, backupFile: path.join(dir, 'stale.json') }), /快照已变化/)
      assert.equal(fs.existsSync(path.join(dir, 'stale.json')), false)
    })
    await t.test('第二笔账款更新失败时已发数量和第一笔账款也回滚', async () => {
      const before = await runRepair(conn)
      const faulty = new Proxy(conn, { get(target, key) {
        if (key === 'query') return async (sql, values) => {
          if (sql.startsWith('UPDATE payment_records') && values[3] === 2) throw new Error('模拟中途失败')
          return target.query(sql, values)
        }
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
      } })
      await assert.rejects(runRepair(faulty, { apply: true, expectedHash: before.snapshotHash, backupFile: path.join(dir, 'rollback.json') }), /模拟中途失败/)
      assert.equal((await runRepair(conn)).snapshotHash, before.snapshotHash)
    })
    await t.test('依赖存在时拒绝修复', async () => {
      await conn.query("INSERT INTO payment_entries(record_id,amount,payment_date) VALUES(1,1,'2026-09-08')")
      await assert.rejects(runRepair(conn), /下游财务引用/)
      await conn.query('DELETE FROM payment_entries')
    })
    await t.test('应用结果正确且保留快照与审计', async () => {
      const before = await snapshot(conn)
      const result = await runRepair(conn, { apply: true, expectedHash: digest(before), backupFile: path.join(dir, 'applied.json') })
      assert.equal(result.committed, true)
      const after = await snapshot(conn)
      assert.equal(buildPlan(after).alreadyApplied, true)
      assert.deepEqual(after.payments.map(r => [Number(r.total_amount), Number(r.paid_amount), r.due_date]), [[358.43, 0, '2026-04-04'], [0, 0, '2026-04-04']])
      assert.equal(after.paymentEvents.length, 2)
      assert.equal(after.saleEvents.length, 1)
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'applied.json')))
      assert.equal(saved.snapshotHash, digest(before))
      assert.equal(fs.statSync(path.join(dir, 'applied.json')).mode & 0o777, 0o600)
    })
    await t.test('重复执行不重复写账或审计事件', async () => {
      const before = digest(await snapshot(conn))
      const again = await runRepair(conn, { apply: true })
      assert.equal(again.alreadyApplied, true)
      assert.equal(again.committed, false)
      assert.equal(digest(await snapshot(conn)), before)
    })
  } finally { await cleanup(); await conn.end(); fs.rmSync(dir, { recursive: true, force: true }) }
})
