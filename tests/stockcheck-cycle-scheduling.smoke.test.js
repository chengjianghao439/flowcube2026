'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
require('./helpers/testEnvironment').configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')
const logger = require('../backend/src/utils/logger')
const stockcheck = require('../backend/src/modules/stockcheck/stockcheck.service')
const cyclePath = require.resolve('../backend/src/modules/stockcheck/stockcheck.cycle')
const restart = () => {
  delete require.cache[cyclePath]
  return require(cyclePath)
}

after(() => pool.end())

test('循环盘同日部分失败可重启补齐，两个调度器只提交一张 B 类盘点单', { timeout: 12_000 }, async () => {
  const tag = `CYC-${randomUUID().slice(0,8)}`
  const today = beijingTodayYmd()
  const products = []
  let warehouseId, outboundId, releaseB, parallel
  const originalQuery = pool.query
  const originalCreate = stockcheck.create
  const originalWarn = logger.warn
  const warnings = []
  const insert = async (sql, params) => (await pool.query(sql, params))[0].insertId
  try {
    warehouseId = await insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [tag, tag])
    outboundId = await insert(
      "INSERT INTO warehouse_tasks(task_no,customer_name,warehouse_id,warehouse_name,task_type,status,shipped_at) VALUES (?,?,?,?,'sale_out',7,?)",
      [tag, tag, warehouseId, tag, `${today} 00:00:00`],
    )
    for (const [cls, qty] of [['A', 70], ['B', 20], ['C', 10]]) {
      const code = `${tag}-${cls}`
      const productId = await insert("INSERT INTO product_items(code,name,unit,cost_price) VALUES (?,?,'件',1)", [code, code])
      products.push(productId)
      await insert("INSERT INTO warehouse_task_items(task_id,product_id,product_code,product_name,unit,required_qty,picked_qty) VALUES (?,?,?,?,'件',?,?)",
        [outboundId, productId, code, code, qty, qty])
      if (cls !== 'C') await insert(
        "INSERT INTO inventory_containers(barcode,product_id,warehouse_id,remaining_qty,initial_qty,container_type,status) VALUES (?,?,?,2,2,2,1)",
        [code, productId, warehouseId],
      )
    }
    // The normal scheduler still owns SQL and transactions. Limit only this test's warehouse discovery.
    pool.query = (sql, params) => typeof sql === 'string' && sql.includes('SELECT DISTINCT w.id, w.name') && sql.includes('inventory_cycle_rules')
      ? originalQuery.call(pool, `SELECT owned.* FROM (${sql}) owned WHERE owned.id=?`, [...(params || []), warehouseId])
      : originalQuery.call(pool, sql, params)
    logger.warn = (message, meta, module) => {
      if (meta?.warehouseId === warehouseId) warnings.push({ message, meta })
      originalWarn(message, meta, module)
    }
    stockcheck.create = async (input, conn) => {
      const result = await originalCreate(input, conn)
      if (input.scopeValue === 'B') throw Object.assign(new Error('合成建单后故障'), { code: 'TEST_CYCLE_FAILURE' })
      return result
    }
    const first = await restart().runAutoCycleScheduling()
    assert.deepEqual(first.created.map(row => row.abcClass), ['A'])
    const [afterFailure] = await pool.query(
      'SELECT scope_value FROM inventory_checks WHERE warehouse_id=? AND check_type=2 ORDER BY id', [warehouseId],
    )
    assert.deepEqual(afterFailure.map(row => row.scope_value), ['A'])
    assert.deepEqual(first.failed?.map(row => row.abcClass), ['B'])
    assert.ok(warnings.some(({ meta }) => meta.abcClass === 'B' && meta.plannedDate === today))
    const [beforeRestart] = await pool.query(
      'SELECT abc_class,outcome,stockcheck_id FROM inventory_cycle_runs WHERE warehouse_id=? AND planned_date=? ORDER BY abc_class', [warehouseId, today],
    )
    assert.deepEqual(beforeRestart.map(row => [row.abc_class, row.outcome]), [['A', 'created'], ['C', 'no_candidates']])
    assert.ok(beforeRestart[0].stockcheck_id)
    assert.equal(beforeRestart[1].stockcheck_id, null)

    let startedB
    const bReady = new Promise(resolve => { startedB = resolve })
    const bGate = new Promise(resolve => { releaseB = resolve })
    stockcheck.create = async (input, conn) => {
      const result = await originalCreate(input, conn)
      if (input.scopeValue === 'B') {
        startedB()
        await bGate
      }
      return result
    }
    const resumed = restart().runAutoCycleScheduling()
    parallel = [resumed]
    await Promise.race([bReady, resumed.then(() => { throw new Error('循环盘重试未进入 B 类建单') })])
    const contender = restart().runAutoCycleScheduling()
    parallel.push(contender)
    const waiting = Symbol('等待 B 类进度交易提交')
    assert.equal(await Promise.race([contender, new Promise(resolve => setTimeout(() => resolve(waiting), 75))]), waiting)
    releaseB()
    const outcomes = await Promise.all(parallel)
    assert.deepEqual(outcomes.flatMap(run => run.created.map(row => row.abcClass)), ['B'])
    assert.deepEqual(outcomes.flatMap(run => run.failed), [])
    const [checks] = await pool.query(
      'SELECT id,scope_value FROM inventory_checks WHERE warehouse_id=? AND check_type=2 ORDER BY id', [warehouseId],
    )
    assert.deepEqual(checks.map(row => row.scope_value), ['A', 'B'])
    const [terminal] = await pool.query(
      'SELECT abc_class,outcome,stockcheck_id FROM inventory_cycle_runs WHERE warehouse_id=? AND planned_date=? ORDER BY abc_class', [warehouseId, today],
    )
    assert.deepEqual(terminal.map(row => [row.abc_class, row.outcome, row.stockcheck_id]),
      [['A', 'created', checks[0].id], ['B', 'created', checks[1].id], ['C', 'no_candidates', null]])
    assert.equal((await restart().runAutoCycleScheduling()).created.length, 0)

    const manual = await stockcheck.create({ warehouseId, warehouseName: tag, operator: { userId: 1, realName: '手工回归' } })
    assert.ok(manual.id)
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM inventory_cycle_runs WHERE warehouse_id=?', [warehouseId])
    assert.equal(Number(count), 3)
  } finally {
    if (releaseB) releaseB()
    if (parallel) await Promise.allSettled(parallel)
    pool.query = originalQuery
    stockcheck.create = originalCreate
    logger.warn = originalWarn
    if (warehouseId) {
      await pool.query('DELETE FROM inventory_cycle_runs WHERE warehouse_id=?', [warehouseId]).catch(error => {
        if (error.code !== 'ER_NO_SUCH_TABLE') throw error
      })
      await pool.query('DELETE FROM inventory_check_items WHERE check_id IN (SELECT id FROM inventory_checks WHERE warehouse_id=?)', [warehouseId])
      await pool.query('DELETE FROM inventory_checks WHERE warehouse_id=?', [warehouseId])
      await pool.query('DELETE FROM product_abc_classes WHERE warehouse_id=?', [warehouseId])
      await pool.query('DELETE FROM inventory_containers WHERE warehouse_id=?', [warehouseId])
      if (outboundId) {
        await pool.query('DELETE FROM warehouse_task_items WHERE task_id=?', [outboundId])
        await pool.query('DELETE FROM warehouse_tasks WHERE id=?', [outboundId])
      }
      await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [warehouseId])
      if (products.length) await pool.query('DELETE FROM product_items WHERE id IN (?)', [products])
    }
  }
})
