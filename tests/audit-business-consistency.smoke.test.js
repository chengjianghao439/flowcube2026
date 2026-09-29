'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const config = validateTestEnvironment()
assert.equal(config.database, 'flowcube_repair20260908_test')
const mysql = require('../backend/node_modules/mysql2/promise')
const { assertOwnedRepairInstance } = require('./helpers/repairInstanceOwnership')
const { audit, checks } = require('../backend/scripts/audit-business-consistency.cjs')

test('一致性扫描：状态口径、真实异常与完整计数', async t => {
  const c = await mysql.createConnection(config)
  // 归属门：本套件在复合命令 smoke:legacy-receivable-repair 内与本批专属库共享连接并写入，
  // 必须在任何写入（含下方 INSERT）之前证明目标库属本批新建的临时容器。
  // 未通过即抛出；此时 `authorized` 仍为 false，finally 只关闭连接，**绝不执行定向删除**。
  let authorized = false
  try {
    await assertOwnedRepairInstance(c, { config })
    authorized = true
    await t.test('所有检查在当前迁移结构上可执行', async () => {
      const r = await audit(c)
      assert.deepEqual(r.checks.filter(x => x.error), [])
    })
    await c.query("INSERT INTO inbound_tasks(id,task_no,warehouse_id,status,audit_status) VALUES(9001,'TEST-AUDIT-9001',9001,3,0)")
    await c.query("INSERT INTO inbound_task_items(id,task_id,product_id,product_name,ordered_qty,received_qty,putaway_qty) VALUES(9001,9001,9001,'模拟商品',1,1,0)")
    await t.test('待上架且已收未上架，不误报已完成数量缺失', async () => {
      const [rows] = await c.query(checks.find(x => x.id === 'inbound_completed_projection').sql)
      assert.equal(rows.filter(x => x.id === 9001).length, 0)
    })
    await c.query('UPDATE inbound_tasks SET status=4 WHERE id=9001')
    await t.test('已完成却未上架或未结算会被检出', async () => {
      const [rows] = await c.query(checks.find(x => x.id === 'inbound_completed_projection').sql)
      assert.equal(rows.filter(x => x.id === 9001).length, 1)
    })
    await t.test('超过样本上限仍返回完整异常数，扫描不改库存', async () => {
      for (let i = 0; i < 105; i++) await c.query('INSERT INTO inventory_stock(product_id,warehouse_id,quantity,reserved) VALUES(?,9001,1,0)', [9100 + i])
      const result = (await audit(c)).checks.find(x => x.id === 'inventory_stock_projection')
      assert.equal(result.count, 105)
      assert.equal(result.samples.length, 100)
      const [[row]] = await c.query('SELECT SUM(quantity) qty FROM inventory_stock WHERE warehouse_id=9001 AND product_id BETWEEN 9100 AND 9204')
      assert.equal(Number(row.qty), 105)
    })
  } finally {
    // 定向删除失败也必须关连接：嵌套 try/finally，仍尝试后续收尾，任一收尾失败保持非 0、不静默吞。
    try {
      if (authorized) {
        await c.query('DELETE FROM inbound_task_items WHERE id=9001')
        await c.query('DELETE FROM inbound_tasks WHERE id=9001')
        await c.query('DELETE FROM inventory_stock WHERE warehouse_id=9001 AND product_id BETWEEN 9100 AND 9204')
      }
    } finally {
      await c.end()
    }
  }
})
