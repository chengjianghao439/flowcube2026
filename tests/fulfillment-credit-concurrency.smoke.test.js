const assert = require('node:assert/strict')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const sales = require('../backend/src/modules/sale/sale.service')
const { createContainer, syncStockFromContainers, SOURCE_TYPE } = require('../backend/src/engine/containerEngine')

async function main() {
  const prefix = `FCR${Date.now().toString(36)}`
  const insert = async (sql, params) => Number((await pool.query(sql, params))[0].insertId)
  let owner, warehouse, product, customer, containerId
  const orders = []
  const originalGetConnection = pool.getConnection.bind(pool)
  let releaseFirst, first, second
  try {
    owner = await insert("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,'!','并发授信测试',1,'管理员',1)", [prefix])
    warehouse = await insert("INSERT INTO inventory_warehouses(code,name) VALUES(?,'并发授信仓')", [prefix])
    product = await insert("INSERT INTO product_items(code,name,unit) VALUES(?,'并发授信商品','件')", [prefix])
    customer = await insert("INSERT INTO sale_customers(code,name,credit_limit) VALUES(?,'并发授信客户',15)", [prefix])
    const operator = { userId: owner, roleId: 1, realName: '并发授信测试' }
    const conn = await originalGetConnection()
    try {
      await conn.beginTransaction()
      containerId = (await createContainer(conn, { productId: product, warehouseId: warehouse, initialQty: 2, sourceType: SOURCE_TYPE.TRANSFER, sourceRefId: 1, sourceRefType: 'test_seed', sourceRefNo: prefix })).containerId
      await syncStockFromContainers(conn, product, warehouse)
      await conn.commit()
    } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
    for (let n = 0; n < 2; n++) orders.push((await sales.create({ customerId: customer, warehouseId: warehouse,
      items: [{ productId: product, quantity: 1, unitPrice: 10 }], operator, requestKey: `${prefix}create${n}` })).id)

    // 仅控制两个真实连接的交错时序，不伪造任何SQL结果或事务动作。
    // 第一单持有客户锁暂停；第二单已发起同一客户锁查询后，才让第一单完成占库并提交。
    let firstLocked, secondWaiting, number = 0
    const locked = new Promise(resolve => { firstLocked = resolve })
    const waiting = new Promise(resolve => { secondWaiting = resolve })
    const holdFirst = new Promise(resolve => { releaseFirst = resolve })
    pool.getConnection = async () => {
      const connection = await originalGetConnection()
      const index = ++number
      return {
        beginTransaction: async () => { await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await connection.beginTransaction() },
        commit: () => connection.commit(), rollback: () => connection.rollback(), release: () => connection.release(),
        query: async (sql, ...params) => {
          const customerLock = typeof sql === 'string' && sql.includes('SELECT id, credit_limit FROM sale_customers') && sql.includes('FOR UPDATE')
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
        await Promise.race([signal, outcome.then(result => { throw result.error || new Error(`${label}未进入预期等待`) }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label}等待超过5秒`)), 5000) })])
      } finally { clearTimeout(timeout) }
    }
    first = sales.reserveStock(orders[0], operator, [], { requestKey: `${prefix}reserve0` }).then(() => ({ ok: true }), error => ({ error }))
    await waitForSignal(locked, first, '第一单客户锁')
    second = sales.reserveStock(orders[1], operator, [], { requestKey: `${prefix}reserve1` }).then(() => ({ ok: true }), error => ({ error }))
    await waitForSignal(waiting, second, '第二单客户锁')
    releaseFirst()
    const [a, b] = await Promise.all([first, second])
    assert.equal(a.ok, true, a.error?.message)
    assert.equal(b.error?.code, 'CREDIT_LIMIT_EXCEEDED', '第二单必须看见等待客户锁期间第一单提交的10元授信占用，拒绝合计20超过15')
    const [rows] = await pool.query('SELECT id,status FROM sale_orders WHERE id IN (?) ORDER BY id', [orders])
    assert.deepEqual(rows.map(row => Number(row.status)), [2, 1])
    console.log('PASS RR并发授信：同客户两单各10，额度15，仅第一单占库，第二单拒绝且保持草稿')
  } finally {
    releaseFirst?.()
    await Promise.allSettled([first, second].filter(Boolean))
    pool.getConnection = originalGetConnection
    try {
      // 只清理本测试生成的精确ID和请求键前缀，不触碰其他测试业务数据。
      if (orders.length) {
        await pool.query("DELETE FROM stock_reservations WHERE ref_type='sale_order' AND ref_id IN (?)", [orders])
        await pool.query('DELETE FROM sale_order_expected_bindings WHERE sale_order_id IN (?)', [orders])
        await pool.query('DELETE FROM sale_order_events WHERE sale_order_id IN (?)', [orders])
        await pool.query('DELETE FROM sale_order_items WHERE order_id IN (?)', [orders])
        await pool.query('DELETE FROM sale_orders WHERE id IN (?)', [orders])
      }
      await pool.query('DELETE FROM operation_requests WHERE request_key LIKE ?', [`${prefix}%`])
      if (containerId) await pool.query('DELETE FROM inventory_containers WHERE id=?', [containerId])
      if (product) { await pool.query('DELETE FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [product, warehouse]); await pool.query('DELETE FROM product_items WHERE id=?', [product]) }
      if (customer) await pool.query('DELETE FROM sale_customers WHERE id=?', [customer])
      if (warehouse) await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [warehouse])
      if (owner) await pool.query('DELETE FROM sys_users WHERE id=?', [owner])

    } finally { await pool.end() }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
