'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const config = validateTestEnvironment()
assert.equal(config.database, 'flowcube_repair20260908_test')
const mysql = require('../backend/node_modules/mysql2/promise')
const { fixture } = require('./helpers/legacyPurchaseFixture')
const repair = require('../backend/scripts/repair-legacy-purchases-20260908.cjs')
const { assertPurchaseOrdersOpen, assertPurchaseSettlementSources } = require('../backend/src/modules/inbound-tasks/inbound-purchase-source')
const { recomputePurchasePayable } = require('../backend/src/modules/inbound-tasks/inbound-tasks.settle')

test('采购修复与来源保护：真实MySQL回归', async t => {
  const c = await mysql.createConnection({ ...config, dateStrings: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-purchase-repair-test-'))
  const cleanup = async () => {
    for (const table of ['payment_entries', 'payment_record_events', 'inbound_task_events', 'inventory_logs', 'inventory_containers',
      'inventory_stock', 'inbound_task_items', 'inbound_tasks', 'purchase_order_items', 'payment_records', 'purchase_orders']) await c.query(`DELETE FROM ${table}`)
  }
  try {
    await cleanup()
    const f = fixture()
    const insert = async (table, row) => c.query(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row))
    for (const row of f.purchases) await insert('purchase_orders', { ...row, supplier_id: 1, warehouse_name: '模拟仓', operator_id: 1, operator_name: '专项测试' })
    for (const row of f.purchaseItems) await insert('purchase_order_items', { ...row, product_code: 'TEST1', product_name: '模拟商品', unit: '个' })
    for (const row of f.tasks) await insert('inbound_tasks', { ...row, warehouse_name: '模拟仓' })
    for (const row of f.items) await insert('inbound_task_items', { ...row, product_name: '模拟商品', product_code: 'TEST1', unit: '个' })
    for (const row of f.containers) await insert('inventory_containers', { ...row, unit: '个' })
    await insert('inventory_containers', { id: 1, barcode: 'BASELINE-TEST', product_id: 1, warehouse_id: 1, unit: '个', initial_qty: 99, remaining_qty: 99, status: 1, source_type: 'legacy' })
    for (const row of f.stock) await insert('inventory_stock', row)
    for (const row of f.payments) await insert('payment_records', { ...row, due_date: '2026-04-23' })
    for (const row of f.logs) await insert('inventory_logs', { ...row, before_qty: 99, after_qty: 100 })

    await t.test('空来源被收货/上架和应付结算拒绝', async () => {
      await c.beginTransaction()
      try {
        await assert.rejects(assertPurchaseOrdersOpen(c, 2, '上架'), { code: 'INBOUND_PURCHASE_SOURCE_INVALID' })
        await assert.rejects(recomputePurchasePayable(c, 1), { code: 'INBOUND_PURCHASE_SOURCE_INVALID' })
      } finally { await c.rollback() }
    })
    await t.test('仅补采购关联仍不足，未归属旧入库禁止重算清账', async () => {
      await c.beginTransaction()
      try {
        await c.query("UPDATE inbound_task_items SET purchase_order_id=1,purchase_item_id=1,purchase_order_no='PO20260324001' WHERE id=1")
        await assert.rejects(assertPurchaseSettlementSources(c, 1), { code: 'PURCHASE_LEGACY_RECEIPT_UNRECONCILED' })
      } finally { await c.rollback() }
    })
    await t.test('预检无写入，备份失败及摘要漂移均禁止提交', async () => {
      const before = repair.digest(await repair.snapshot(c)), pre = await repair.runRepair(c)
      assert.equal(pre.snapshotHash, before)
      await assert.rejects(repair.runRepair(c, { apply: true, expectedHash: 'stale', backupFile: path.join(dir, 'stale.json') }), /摘要或数据/)
      await assert.rejects(repair.runRepair(c, { apply: true, expectedHash: before, backupFile: path.join(dir, 'missing', 'backup.json') }), /ENOENT/)
      assert.equal(repair.digest(await repair.snapshot(c)), before)
    })
    await t.test('容器更新途中失败，已补关联和状态一并回滚', async () => {
      const before = await repair.runRepair(c)
      const faulty = new Proxy(c, { get(target, key) {
        if (key === 'query') return async (sql, args) => {
          if (sql.startsWith('UPDATE inventory_containers SET status=3') && args[0] === 104) throw new Error('模拟容器更新失败')
          return target.query(sql, args)
        }
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
      } })
      await assert.rejects(repair.runRepair(faulty, { apply: true, expectedHash: before.snapshotHash, backupFile: path.join(dir, 'rollback.json') }), /模拟容器更新失败/)
      assert.equal((await repair.runRepair(c)).snapshotHash, before.snapshotHash)
    })
    await t.test('修复后逻辑闭合，库存和应付不变，审计完整', async () => {
      const before = await repair.snapshot(c)
      assert.equal((await repair.runRepair(c, { apply: true, expectedHash: repair.digest(before), backupFile: path.join(dir, 'applied.json') })).committed, true)
      const after = await repair.snapshot(c)
      assert.equal(repair.buildPlan(after).alreadyApplied, true)
      assert.deepEqual(after.tasks.map(x => [x.status, x.audit_status]), [[4, 1], [5, 0], [5, 0], [5, 0]])
      assert.deepEqual(after.containers.map(x => [x.id, x.status, Number(x.remaining_qty)]), [[101, 1, 1], [102, 3, 0], [103, 3, 0], [104, 3, 0], [105, 3, 0]])
      assert.equal(repair.digest(before.stock), repair.digest(after.stock))
      assert.equal(repair.digest(before.payments), repair.digest(after.payments))
      const [[stock]] = await c.query('SELECT SUM(remaining_qty) qty FROM inventory_containers WHERE status=1 AND deleted_at IS NULL')
      assert.equal(Number(stock.qty), 100)
      assert.equal(after.events.length, 4); assert.equal(after.paymentEvents.length, 1)
    })
    await t.test('规范化后真实应付重算仍为33.13，取消采购不能上架', async () => {
      await c.beginTransaction()
      try {
        await recomputePurchasePayable(c, 1)
        const [[p]] = await c.query('SELECT total_amount,paid_amount,confirm_status FROM payment_records WHERE id=6')
        assert.deepEqual([Number(p.total_amount), Number(p.paid_amount), p.confirm_status], [33.13, 0, 1])
        await assert.rejects(assertPurchaseOrdersOpen(c, 2, '上架'), /已取消/)
      } finally { await c.rollback() }
    })
    await t.test('重复执行无额外审计和写入', async () => {
      const before = repair.digest(await repair.snapshot(c))
      assert.equal((await repair.runRepair(c, { apply: true })).alreadyApplied, true)
      assert.equal(repair.digest(await repair.snapshot(c)), before)
    })
  } finally { await cleanup(); await c.end(); fs.rmSync(dir, { recursive: true, force: true }) }
})
