'use strict'

// 真实 RR 连接与 reserveStock：相邻单据的范围当前读不得在可变仓索引上
// 持 gap S 后等待客户 X，否则前单占库改仓的索引插入会反向等待该 gap。
// 只控制真实查询交错，不伪造结果、不 retry；旧授信 smoke 保持独立原字节。
const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const sales = require('../backend/src/modules/sale/sale.service')
const { createContainer, syncStockFromContainers, SOURCE_TYPE } = require('../backend/src/engine/containerEngine')
const { assertSqlIdentifier } = require('../backend/src/utils/sqlIdentifier')

test('RR 同客户占库改仓：范围当前读不与客户锁形成索引 gap 死锁', async () => {
  const prefix = `FCW${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const insert = async (sql, params) => Number((await pool.query(sql, params))[0].insertId)
  const orders = []
  const originalGetConnection = pool.getConnection.bind(pool)
  const trace = []
  let owner, warehouse, targetWarehouse, product, customer, releaseFirst, first, second, failure
  const cleanupErrors = []
  try {
    owner = await insert("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,'!','改仓授信测试',1,'管理员',1)", [prefix])
    warehouse = await insert("INSERT INTO inventory_warehouses(code,name) VALUES(?,'改仓授信原仓')", [prefix])
    targetWarehouse = await insert("INSERT INTO inventory_warehouses(code,name) VALUES(?,'改仓授信目标仓')", [`${prefix}B`])
    product = await insert("INSERT INTO product_items(code,name,unit) VALUES(?,'改仓授信商品','件')", [prefix])
    customer = await insert("INSERT INTO sale_customers(code,name,credit_limit) VALUES(?,'改仓授信客户',15)", [prefix])
    const operator = { userId: owner, roleId: 1, realName: '改仓授信测试' }
    const conn = await originalGetConnection()
    try {
      await conn.beginTransaction()
      for (const warehouseId of [warehouse, targetWarehouse]) {
        await createContainer(conn, { productId: product, warehouseId, initialQty: 2,
          sourceType: SOURCE_TYPE.TRANSFER, sourceRefId: owner, sourceRefType: 'credit_warehouse_test', sourceRefNo: prefix })
        await syncStockFromContainers(conn, product, warehouseId)
      }
      await conn.commit()
    } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
    for (let n = 0; n < 2; n++) {
      const items = n === 0 ? [{ productId: product, warehouseId: warehouse, quantity: 1, unitPrice: 10 }]
        : [warehouse, targetWarehouse].map(warehouseId => ({ productId: product, warehouseId, quantity: 1, unitPrice: 5 }))
      orders.push((await sales.create({ customerId: customer, warehouseId: warehouse,
        items, operator, requestKey: `${prefix}create${n}` })).id)
    }
    const [[item]] = await pool.query('SELECT id FROM sale_order_items WHERE order_id=?', [orders[0]])
    const requested = [{ id: item.id, qty: 1, warehouseId: targetWarehouse }]
    let firstLocked, secondWaiting, number = 0
    const locked = new Promise(resolve => { firstLocked = resolve })
    const waiting = new Promise(resolve => { secondWaiting = resolve })
    const holdFirst = new Promise(resolve => { releaseFirst = resolve })
    pool.getConnection = async () => {
      const connection = await originalGetConnection()
      const index = ++number
      return {
        beginTransaction: async () => {
          await connection.query('SET SESSION innodb_lock_wait_timeout=5')
          await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
          await connection.beginTransaction()
        },
        commit: () => connection.commit(), rollback: () => connection.rollback(), release: () => connection.release(),
        query: async (sql, ...params) => {
          const scope = /^SELECT warehouse_id FROM sale_order_items/.test(sql)
          const customerLock = sql.includes('SELECT id, credit_limit FROM sale_customers') && sql.includes('FOR UPDATE')
          if (scope || customerLock || /UPDATE sale_order_items SET warehouse_id/.test(sql)) trace.push({ index, sql, params })
          if (customerLock && index === 2) secondWaiting()
          const result = await connection.query(sql, ...params)
          if (customerLock && index === 1) { firstLocked(); await holdFirst }
          return result
        },
      }
    }
    async function waitForSignal(signal, outcome, label) {
      let timeout
      try {
        await Promise.race([signal, outcome.then(result => { throw result.error || new Error(`${label}未进入等待`) }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label}等待超过5秒`)), 5000) })])
      } finally { clearTimeout(timeout) }
    }
    const scopeWarehouseIds = [warehouse, targetWarehouse]
    first = sales.reserveStock(orders[0], operator, requested, { scopeWarehouseIds, requestKey: `${prefix}reserve0` })
      .then(() => ({ ok: true }), error => ({ error }))
    await waitForSignal(locked, first, '第一单客户锁')
    second = sales.reserveStock(orders[1], operator, [], { scopeWarehouseIds, requestKey: `${prefix}reserve1` })
      .then(() => ({ ok: true }), error => ({ error }))
    await waitForSignal(waiting, second, '第二单客户锁')
    releaseFirst()
    const [a, b] = await Promise.all([first, second])
    console.log(JSON.stringify({ orders, result: { first: { ok: a.ok, code: a.error?.code },
      second: { ok: b.ok, code: b.error?.code } }, trace }))
    // 先核业务结果，再核 plan：去 hint 会真实死锁；退回普通 SELECT 会真实超授信。
    assert.equal(a.ok, true, a.error?.message)
    assert.equal(b.error?.code, 'CREDIT_LIMIT_EXCEEDED', '第二单必须按授信拒绝，不能死锁或使用旧快照放行')
    const [statuses] = await pool.query('SELECT id,status FROM sale_orders WHERE id IN (?) ORDER BY id', [orders])
    assert.deepEqual(statuses.map(row => Number(row.status)), [2, 1])
    const [[saved]] = await pool.query('SELECT warehouse_id,reserved_qty FROM sale_order_items WHERE id=?', [item.id])
    assert.equal(Number(saved.warehouse_id), targetWarehouse)
    assert.equal(Number(saved.reserved_qty), 1)
    const scopeQuery = trace.find(row => row.index === 2 && /^SELECT warehouse_id/.test(row.sql))
    assert.ok(scopeQuery, '必须观察到第二连接实际范围查询')
    const [plan] = await pool.query(`EXPLAIN ${scopeQuery.sql}`, ...scopeQuery.params)
    assert.equal(plan[0].key, 'idx_order_id', '范围锁必须使用不含可变仓库的既有 order_id 索引')
    console.log(JSON.stringify({ orders, scopePlan: plan }))
    pool.getConnection = originalGetConnection
    const [[before]] = await pool.query('SELECT COUNT(*) n FROM sale_order_events WHERE sale_order_id=?', [orders[0]])
    await sales.reserveStock(orders[0], operator, requested, { scopeWarehouseIds, requestKey: `${prefix}reserve0` })
    await assert.rejects(() => sales.reserveStock(orders[0], operator, requested,
      { scopeWarehouseIds: [warehouse], requestKey: `${prefix}reserve0` }), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' })
    const [[after]] = await pool.query('SELECT COUNT(*) n FROM sale_order_events WHERE sale_order_id=?', [orders[0]])
    assert.equal(Number(after.n), Number(before.n), '重放与撤销目标仓范围不得重复执行')
    const [[reservation]] = await pool.query("SELECT COUNT(*) n,SUM(qty) qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [orders[0]])
    assert.equal(Number(reservation.n), 1)
    assert.equal(Number(reservation.qty), 1)
  } catch (error) { failure = error } finally {
    releaseFirst?.()
    await Promise.allSettled([first, second].filter(Boolean))
    pool.getConnection = originalGetConnection
    // 保留业务证据，正常取消仅本轮订单；基础夹具停用，绝不全表清理。
    for (const id of orders) {
      try { await sales.cancel(id, { userId: owner, roleId: 1, realName: '改仓授信测试' }) } catch (error) { cleanupErrors.push(error) }
    }
    if (orders.length) {
      try {
        const [rows] = await pool.query('SELECT id,status FROM sale_orders WHERE id IN (?) ORDER BY id', [orders])
        assert.ok(rows.every(row => Number(row.status) === 5), '自有单据必须正常取消')
        const [[active]] = await pool.query("SELECT COUNT(*) n FROM stock_reservations WHERE ref_type='sale_order' AND ref_id IN (?) AND status=1", [orders])
        assert.equal(Number(active.n), 0, '自有单据不得遗留有效预占')
      } catch (error) { cleanupErrors.push(error) }
    }
    for (const [table, id] of [['sys_users', owner], ['sale_customers', customer], ['product_items', product],
      ['inventory_warehouses', warehouse], ['inventory_warehouses', targetWarehouse]]) {
      if (!id) continue
      try {
        // 固定表名单，精确本轮插入ID；这些主档均有 is_active。
        assertSqlIdentifier(table)
        await pool.query(`UPDATE ${table} SET is_active=0 WHERE id=?`, [id])
      } catch (error) { cleanupErrors.push(error) }
    }
    try { await pool.end() } catch (error) { cleanupErrors.push(error) }
  }
  if (failure && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], '业务断言失败且自有资源收尾失败')
  if (failure) throw failure
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, '自有资源收尾失败')
})
