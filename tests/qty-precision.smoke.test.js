'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const mysql = require('../backend/node_modules/mysql2/promise')
const engine = require('../backend/src/engine/containerEngine')

test('MySQL 两位数量：拒绝 .005 拆分且库存守恒，合法 .01 拆分准确', async () => {
  const conn = await mysql.createConnection(validateTestEnvironment())
  try {
    await conn.beginTransaction()
    const suffix = Date.now().toString(36)
    const [wh] = await conn.query("INSERT INTO inventory_warehouses(code,name) VALUES (?,'数量精度测试仓')", [`QTY-${suffix}`])
    const [p] = await conn.query("INSERT INTO product_items(code,name,unit,allow_decimal_qty) VALUES (?,'数量精度测试商品','件',1)", [`QTY-${suffix}`])
    const common = { productId: p.insertId, warehouseId: wh.insertId, sourceType: engine.SOURCE_TYPE.RETURN, sourceRefId: 1, containerType: 2 }
    const source = await engine.createContainer(conn, { ...common, initialQty: 1, containerStatus: engine.CONTAINER_STATUS.PENDING_PUTAWAY, barcode: `BQS${suffix}` })
    await engine.promotePendingContainerToActive(conn, source.containerId, p.insertId, wh.insertId)
    const target = await engine.createContainer(conn, { ...common, initialQty: 0, barcode: `BQT${suffix}`, containerStatus: engine.CONTAINER_STATUS.EMPTY })
    await engine.syncStockFromContainers(conn, p.insertId, wh.insertId)
    const state = async () => (await conn.query('SELECT id, remaining_qty, status FROM inventory_containers WHERE product_id=? ORDER BY id', [p.insertId]))[0]
    const before = await state()
    await assert.rejects(engine.splitContainer(conn, { containerId: source.containerId, targetContainerId: target.containerId, qty: 0.005 }), { code: 'QTY_DECIMALS_EXCEEDED' })
    assert.deepEqual(await state(), before, '不得分别舍入后凭空增加0.01库存')
    const split = await engine.splitContainer(conn, { containerId: source.containerId, targetContainerId: target.containerId, qty: 0.01 })
    assert.equal(split.sourceRemainingAfter, 0.99)
    assert.equal(split.targetQtyAfter, 0.01)
    const after = await state()
    assert.deepEqual(after.map(row => Number(row.remaining_qty)), [0.99, 0.01])
    const [[stock]] = await conn.query('SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [p.insertId, wh.insertId])
    assert.equal(Number(stock.quantity), 1)
    await conn.query('UPDATE product_items SET allow_decimal_qty=0 WHERE id=?', [p.insertId])
    await assert.rejects(engine.splitContainer(conn, { containerId: source.containerId, targetContainerId: target.containerId, qty: 0.5 }), { code: 'QTY_INTEGER_REQUIRED' })
    assert.deepEqual(await state(), after)
    await conn.query('UPDATE product_items SET allow_decimal_qty=1 WHERE id=?', [p.insertId])
    const small = await engine.createContainer(conn, { ...common, initialQty: 0.3, barcode: `BQU${suffix}`, containerStatus: engine.CONTAINER_STATUS.PENDING_PUTAWAY })
    await engine.promotePendingContainerToActive(conn, small.containerId, p.insertId, wh.insertId)
    const full = await engine.splitContainer(conn, { containerId: small.containerId, targetContainerId: target.containerId, qty: 0.1 + 0.2 })
    assert.equal(full.sourceRemainingAfter, 0)
    const [[empty]] = await conn.query('SELECT remaining_qty, status FROM inventory_containers WHERE id=?', [small.containerId])
    assert.equal(Number(empty.remaining_qty), 0)
    assert.equal(empty.status, engine.CONTAINER_STATUS.EMPTY)

  } finally {
    await conn.rollback()
    await conn.end()
    await require('../backend/src/config/db').pool.end()
  }
})

test('迁移255的70个数量列实际为两位，原SQL可重放且不缩减单价/换算率', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
  const sql = fs.readFileSync(path.resolve(__dirname, '../backend/src/database/255_qty_precision_two_decimals.sql'), 'utf8')
  const targets = [...sql.matchAll(/ALTER TABLE `([^`]+)` MODIFY COLUMN `([^`]+)` DECIMAL\(\d+,2\)/g)].map(m => `${m[1]}.${m[2]}`)
  assert.equal(new Set(targets).size, 70)
  const conn = await mysql.createConnection(validateTestEnvironment())
  try {
    const columns = async () => (await conn.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION'))[0]
    const before = await columns()
    const byName = new Map(before.map(r => [`${r.TABLE_NAME}.${r.COLUMN_NAME}`, r]))
    for (const key of targets) assert.equal(byName.get(key)?.NUMERIC_SCALE, 2, key)
    for (const key of ['product_items.cost_price', 'purchase_order_items.unit_price', 'sale_order_items.unit_price', 'product_units.conversion_rate']) {
      assert.ok(byName.get(key)?.NUMERIC_SCALE >= 4, `${key}必须保留原有高精度`)
    }
    for (const statement of splitSqlStatements(sql)) await conn.query(statement)
    assert.deepEqual(await columns(), before, '已迁移测试库重放不应改变任何列')
  } finally { await conn.end() }
})
