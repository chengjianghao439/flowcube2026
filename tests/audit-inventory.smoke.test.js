/** F01–F05: actual MySQL 8 services; rollback fixtures, exact-ID cleanup for two-connection tests. */
const assert = require('node:assert/strict')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const path = require('node:path')
const root = path.resolve(__dirname, '..', 'backend', 'src')
const mysql = require('../backend/node_modules/mysql2/promise')

async function main() {
  const databaseOptions = {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    timezone: '+08:00', charset: 'utf8mb4',
  }
  const conn = await mysql.createConnection(databaseOptions)
  const [[server]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS databaseName')
  assert.equal(server.databaseName, process.env.DB_NAME)
  console.log(`Testing ${server.databaseName}, MySQL ${server.version}`)
  assert.match(server.version, /^8\./)
  await conn.query("SET time_zone = '+08:00'")
  await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci')
  // Keep actual business queries and transaction rollbacks, while retaining outer fixture rollback.
  const serviceConn = {
    query: (...args) => conn.query(...args),
    beginTransaction: () => conn.query('SAVEPOINT service_transaction'),
    commit: () => conn.query('RELEASE SAVEPOINT service_transaction'),
    rollback: () => conn.query('ROLLBACK TO SAVEPOINT service_transaction'), release() {},
  }
  let serviceOverride = null
  require.cache[require.resolve(path.join(root, 'config/db'))] = {
    exports: { pool: { query: (...args) => conn.query(...args), getConnection: async () => serviceOverride || serviceConn } },
  }
  const ce = require('../backend/src/engine/containerEngine')
  const re = require('../backend/src/engine/reservationEngine')
  const ie = require('../backend/src/engine/inventoryEngine')
  const expected = require('../backend/src/utils/expectedStock')
  const rt = require('../backend/src/modules/return-tasks/return-tasks.service')
  const purchase = require('../backend/src/modules/purchase/purchase.service')
  const inbound = require('../backend/src/modules/inbound-tasks/inbound-tasks.putaway')
  const receipt = require('../backend/src/modules/inbound-tasks/inbound-tasks.void')
  let wh
  const operator = { userId: 2, realName: '库存回归' }
  let seq = 0
  const prefix = 'FIX' + Date.now().toString(36)
  const unique = kind => prefix + kind + (++seq)
  const insert = async (sql, params) => Number((await conn.query(sql, params))[0].insertId)
  async function fixture() {
    wh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'库存回归仓')", [unique('W')])
    const code = unique('P')
    const productId = await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price) VALUES (?,'库存回归','个',20,10)", [code])
    const poId = await insert(`INSERT INTO purchase_orders
      (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,1,'测试供应商',?,'测试仓库',2,1,'测试')`, [unique('PO'), wh])
    const poiId = await insert(`INSERT INTO purchase_order_items
      (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,?,'库存回归','个',10,10,100)`, [poId, productId, code])
    async function sale(qty) {
      const saleId = await insert(`INSERT INTO sale_orders
        (order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
        VALUES (?,1,'测试客户',?,'测试仓库',2,1,'测试')`, [unique('SO'), wh])
      const itemId = await insert(`INSERT INTO sale_order_items
        (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,quantity,unit_price,amount)
        VALUES (?,?,'测试仓库',?,?,'库存回归','个',?,20,?)`, [saleId, wh, productId, code, qty, qty * 20])
      return { saleId, itemId }
    }
    const pairs = [{ productId, warehouseId: wh }]
    async function reserve(s, qty, staleItems, transaction = conn) {
      const exp = await expected.getExpectedStock(transaction, pairs)
      return re.reserve(transaction, { productId, warehouseId: wh, qty, refType: 'sale_order', refId: s.saleId,
        refItemId: s.itemId, refNo: '测试销售', includeExpected: true, expectedItems: staleItems || exp.items })
    }
    async function container(qty, status = ce.CONTAINER_STATUS.ACTIVE, options = {}) {
      const created = await ce.createContainer(conn, { productId, warehouseId: wh, initialQty: qty, unit: '个',
        sourceType: ce.SOURCE_TYPE.IMPORT, sourceRefId: poId, sourceRefType: 'audit', barcode: unique('C'),
        containerStatus: status === ce.CONTAINER_STATUS.ACTIVE ? ce.CONTAINER_STATUS.PENDING_PUTAWAY : status, ...options })
      if (status === ce.CONTAINER_STATUS.ACTIVE) await ce.promotePendingContainerToActive(conn, created.containerId, productId, wh)
      return created.containerId
    }
    async function ship(s, containerId, qty) {
      await conn.query('UPDATE inventory_containers SET locked_by_task_id=? WHERE id=?', [s.saleId, containerId])
      await ie.moveStock(conn, { moveType: ie.MOVE_TYPE.TASK_OUT, productId, warehouseId: wh, qty,
        refType: 'warehouse_task', refId: s.saleId, refNo: '测试出库', reservationRefType: 'sale_order',
        reservationRefId: s.saleId, lockedByTaskId: s.saleId })
    }
    async function bindingQty(s = null) {
      const [[r]] = await conn.query(`SELECT COALESCE(SUM(qty),0) AS qty FROM sale_order_expected_bindings
        WHERE product_id=? AND released_at IS NULL${s ? ' AND sale_order_id=?' : ''}`, s ? [productId, s.saleId] : [productId])
      return Number(r.qty)
    }
    async function stock() { return ce.getStockProjection(conn, { productId, warehouseId: wh, includeExpected: true }) }
    async function receive(qty, packages = [qty], orderedQty = qty) {
      const taskId = await insert(`INSERT INTO inbound_tasks
        (task_no,purchase_order_id,purchase_order_no,warehouse_id,warehouse_name,status,audit_status,submitted_at)
        VALUES (?,?,'测试采购',?,'测试仓库',3,0,NOW())`, [unique('IT'), poId, wh])
      const taskItemId = await insert(`INSERT INTO inbound_task_items
        (task_id,purchase_order_id,purchase_item_id,product_id,product_code,product_name,unit,ordered_qty,received_qty,putaway_qty)
        VALUES (?,?,?,?,?,'库存回归','个',?,?,0)`, [taskId, poId, poiId, productId, code, orderedQty, qty])
      const locationId = await insert("INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)", [wh, unique('L')])
      const containers = []
      for (const q of packages) containers.push(await container(q, ce.CONTAINER_STATUS.PENDING_PUTAWAY,
        { inboundTaskId: taskId, inboundTaskItemId: taskItemId, sourceType: ce.SOURCE_TYPE.INBOUND_TASK, sourceRefId: taskId }))
      return { taskId, taskItemId, containers, putaway: containerId => inbound.putaway(taskId, { containerId, locationId }, operator) }
    }
    return { code, productId, poId, poiId, sale, reserve, container, ship, bindingQty, stock, receive }
  }
  const tests = []
  const test = (name, run) => tests.push({ name, run })
  for (const [passed, rejected] of [[1, 1], [5, 0], [0, 5], [0.1, 0.2]]) {
    test(`F01 部分质检 ${passed}/${rejected} 保留未检量并可继续`, async f => {
      const taskId = await insert(`INSERT INTO return_tasks (task_no,return_type,return_id,return_no,warehouse_id,warehouse_name,status)
        VALUES (?,'sale',0,'测试退货',?,'测试仓库',3)`, [unique('RT'), wh])
      await insert(`INSERT INTO return_task_items (task_id,product_id,product_code,product_name,unit,expected_qty,received_qty)
        VALUES (?,?,?,'库存回归','个',10,10)`, [taskId, f.productId, f.code])
      await f.container(10, ce.CONTAINER_STATUS.PENDING_QA, { sourceRefType: 'sale_return', sourceRefId: taskId })
      await rt.check(conn, taskId, { productId: f.productId, passedQty: passed, rejectedQty: rejected })
      const [rows] = await conn.query(`SELECT status, SUM(remaining_qty) AS qty FROM inventory_containers
        WHERE source_ref_type='sale_return' AND source_ref_id=? GROUP BY status`, [taskId])
      const qty = new Map(rows.map(r => [Number(r.status), Number(r.qty)]))
      assert.equal(qty.get(5) || 0, Number((10 - passed - rejected).toFixed(4)))
      assert.equal(qty.get(4) || 0, passed)
      assert.equal(qty.get(6) || 0, rejected)
      await rt.check(conn, taskId, { productId: f.productId, passedQty: Number((10 - passed - rejected).toFixed(4)) })
      const [[task]] = await conn.query('SELECT status FROM return_tasks WHERE id=?', [taskId])
      assert.equal(Number(task.status), 4)
    })
  }
  async function returnFixture(f) {
    const taskId = await insert(`INSERT INTO return_tasks (task_no,return_type,return_id,return_no,warehouse_id,warehouse_name,status)
      VALUES (?,'sale',0,'测试退货',?,'测试仓库',1)`, [unique('RT'), wh])
    await insert(`INSERT INTO return_task_items (task_id,product_id,product_code,product_name,unit,expected_qty)
      VALUES (?,?,?,'库存回归','个',10)`, [taskId, f.productId, f.code])
    return taskId
  }
  async function labelPrinter() {
    const id = await insert("INSERT INTO printers (code,name,type,status) VALUES (?,'测试标签机',1,1)", [unique('PR')])
    // 迁移历史可能仍保留 print_type 单列唯一键；基线冒烟也会留下有效绑定。
    // 只在本用例事务内临时覆盖，外层 rollback 恢复既有绑定，不删除其它测试数据。
    const [[binding]] = await conn.query("SELECT id FROM printer_bindings WHERE print_type='container_label' ORDER BY id LIMIT 1 FOR UPDATE")
    if (binding) {
      await conn.query('UPDATE printer_bindings SET printer_id=?,warehouse_id=?,printer_code=? WHERE id=?', [id, wh, 'TEST', binding.id])
    } else {
      await insert("INSERT INTO printer_bindings (printer_id,warehouse_id,print_type,printer_code) VALUES (?,?,'container_label','TEST')", [id, wh])
    }
  }
  test('F01 退货收货及质检分箱在同事务入队ZPL，重放不重复标签', async f => {
    await labelPrinter()
    const taskId = await returnFixture(f)
    const received = await rt.receive(conn, taskId, { productId: f.productId, packages: [{ qty: 10 }], userId: 1, requestKey: unique('RECEIVE') })
    assert.equal(received.printJobIds.length, 1)
    const checkArgs = { productId: f.productId, passedQty: 1, rejectedQty: 1, userId: 1, requestKey: unique('QA') }
    const checked = await rt.check(conn, taskId, checkArgs)
    assert.equal(checked.printJobIds.length, 3)
    assert.deepEqual(checked.containers.map(c => c.qty).sort((a,b) => a-b), [1,1,8])
    const [jobs] = await conn.query('SELECT content_type,content,ref_code FROM print_jobs WHERE id IN (?)', [checked.printJobIds])
    for (const job of jobs) {
      assert.equal(job.content_type, 'zpl')
      assert(job.content.includes(job.ref_code))
    }
    assert.deepEqual(await rt.check(conn, taskId, checkArgs), checked)
    const [[count]] = await conn.query('SELECT COUNT(*) AS n FROM print_jobs WHERE warehouse_id=?', [wh])
    assert.equal(Number(count.n), 4)
  })
  test('F01 暂无打印机仍完成质检，返回未入队数量及所有新条码', async f => {
    await conn.query('UPDATE printers SET status=2')
    const taskId = await returnFixture(f)
    const received = await rt.receive(conn, taskId, { productId: f.productId, packages: [{ qty: 10 }] })
    assert.equal(received.noPrinterCount, 1)
    const checked = await rt.check(conn, taskId, { productId: f.productId, passedQty: 1, rejectedQty: 1 })
    assert.equal(checked.noPrinterCount, 3)
    assert.deepEqual(checked.printJobIds, [])
    assert.equal(checked.containers.length, 3)
  })
  test('F01 标签入队异常回滚质检及分箱，同键可安全重试', async f => {
    await labelPrinter()
    const taskId = await returnFixture(f)
    await rt.receive(conn, taskId, { productId: f.productId, packages: [{ qty: 10 }], userId: 1 })
    await conn.query('SAVEPOINT label_failure')
    const failingConnection = { query: (sql, args) => {
      if (String(sql).includes('INSERT INTO print_jobs')) throw new Error('injected label queue failure')
      return conn.query(sql, args)
    } }
    const args = { productId: f.productId, passedQty: 1, rejectedQty: 1, userId: 1, requestKey: unique('RETRY') }
    await assert.rejects(rt.check(failingConnection, taskId, args), /injected label queue failure/)
    await conn.query('ROLLBACK TO SAVEPOINT label_failure')
    const [[item]] = await conn.query('SELECT checked_qty FROM return_task_items WHERE task_id=?', [taskId])
    assert.equal(Number(item.checked_qty), 0)
    const [[represented]] = await conn.query("SELECT COUNT(*) n,SUM(remaining_qty) qty FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=?", [taskId])
    assert.equal(Number(represented.n), 1)
    assert.equal(Number(represented.qty), 10)
    assert.equal((await rt.check(conn, taskId, args)).printJobIds.length, 3)
  })
  for (const action of ['lookup', 'putaway']) {
    test(`F11 软删待上架容器不能${action}且无数量副作用`, async f => {
      const taskId = await returnFixture(f)
      await conn.query('UPDATE return_tasks SET status=4 WHERE id=?', [taskId])
      await conn.query('UPDATE return_task_items SET received_qty=10,checked_qty=10 WHERE task_id=?', [taskId])
      const containerId = await f.container(5, ce.CONTAINER_STATUS.PENDING_PUTAWAY,
        { sourceRefType: 'sale_return', sourceRefId: taskId })
      await conn.query('UPDATE inventory_containers SET deleted_at=NOW() WHERE id=?', [containerId])
      const [[container]] = await conn.query('SELECT barcode FROM inventory_containers WHERE id=?', [containerId])
      const locationId = await insert('INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [wh, unique('RL')])
      const access = { pdaWarehouseId: wh, scopeWarehouseIds: [wh] }
      const beforeStock = await f.stock()
      const call = action === 'lookup'
        ? () => rt.findPutawayContainer(taskId, container.barcode, access)
        : () => rt.putaway(conn, taskId, { containerId, locationId, userId: 1, ...access })
      await assert.rejects(call(), error => error.statusCode === 404 && /容器/.test(error.message))
      const [[afterContainer]] = await conn.query('SELECT status,remaining_qty,location_id,deleted_at FROM inventory_containers WHERE id=?', [containerId])
      assert.equal(Number(afterContainer.status), ce.CONTAINER_STATUS.PENDING_PUTAWAY)
      assert.equal(Number(afterContainer.remaining_qty), 5)
      assert.equal(afterContainer.location_id, null)
      assert(afterContainer.deleted_at)
      const [[item]] = await conn.query('SELECT checked_qty,putaway_qty FROM return_task_items WHERE task_id=?', [taskId])
      assert.equal(Number(item.checked_qty), 10)
      assert.equal(Number(item.putaway_qty), 0)
      const [[task]] = await conn.query('SELECT status FROM return_tasks WHERE id=?', [taskId])
      assert.equal(Number(task.status), 4)
      assert.deepEqual(await f.stock(), beforeStock)
    })
  }
  test('F02 部分上架5后采购总供应仍为10，拒绝15预占', async f => {
    const arrival = await f.receive(10, [5, 5])
    await arrival.putaway(arrival.containers[0])
    assert.deepEqual(await f.stock(), { quantity: 5, reserved: 0, expected: 5, available: 10 })
    await assert.rejects(f.reserve(await f.sale(15), 15), /库存不足/)
  })
  test('F03 出库保留其它销售预计预占并与明细一致', async f => {
    const containerId = await f.container(5)
    const a = await f.sale(5), b = await f.sale(5)
    await f.reserve(a, 5)
    await f.reserve(b, 5)
    await f.ship(a, containerId, 5)
    const stock = await f.stock()
    assert.equal(stock.reserved, 5)
    const [[active]] = await conn.query('SELECT SUM(qty) AS qty FROM stock_reservations WHERE product_id=? AND status=1', [f.productId])
    assert.equal(stock.reserved, Number(active.qty))
  })
  for (const action of ['withdrawConfirm', 'reject']) {
    test(`F04 ${action} 拦截有效销售绑定`, async f => {
      if (action === 'reject') await conn.query('UPDATE purchase_orders SET status=5 WHERE id=?', [f.poId])
      await f.reserve(await f.sale(5), 5)
      const call = () => action === 'reject' ? purchase.reject(f.poId, { reason: '测试驳回' }, operator) : purchase.withdrawConfirm(f.poId, operator)
      await assert.rejects(call(), error => error.code === 'BINDING_SALE_DEPENDENCY')
    })
  }
  test('F04 旧草稿绑定不能被采购改量/重建明细抹除', async f => {
    await f.reserve(await f.sale(5), 5)
    // 模拟旧版本撤回绕过保护留下的草稿+绑定，不允许改量或换仓掩盖该依赖。
    await conn.query('UPDATE purchase_orders SET status=1 WHERE id=?', [f.poId])
    await assert.rejects(purchase.update(f.poId, {
      supplierId: 1, supplierName: '测试供应商', warehouseId: wh, warehouseName: '测试仓库', items: [],
    }), error => error.code === 'BINDING_SALE_DEPENDENCY')
    const [[item]] = await conn.query('SELECT quantity FROM purchase_order_items WHERE id=?', [f.poiId])
    assert.equal(Number(item.quantity), 10)
  })
  test('F05 多销售顺序预占5+5耗尽10供应，第三单被拒绝', async f => {
    await f.reserve(await f.sale(5), 5)
    assert.equal((await f.stock()).available, 5)
    await f.reserve(await f.sale(5), 5)
    assert.equal(await f.bindingQty(), 10)
    assert.equal((await f.stock()).available, 0)
    await assert.rejects(f.reserve(await f.sale(1), 1), /库存不足/)
  })
  test('F05 部分到货兑现绑定、释放剩余后允许采购短装结案', async f => {
    const a = await f.sale(6), b = await f.sale(4)
    await f.reserve(a, 6)
    await f.reserve(b, 4)
    const arrival = await f.receive(5)
    await arrival.putaway(arrival.containers[0])
    assert.equal(await f.bindingQty(a), 1)
    assert.equal(await f.bindingQty(b), 4)
    assert.equal((await f.stock()).reserved, 10)
    await f.ship(a, arrival.containers[0], 3)
    assert.equal((await f.stock()).reserved, 7)
    assert.equal(await f.bindingQty(a), 1)
    await re.partialReleaseByProduct(conn, { refType: 'sale_order', refId: a.saleId, productId: f.productId, warehouseId: wh, qty: 1 })
    await re.partialReleaseByProduct(conn, { refType: 'sale_order', refId: b.saleId, productId: f.productId, warehouseId: wh, qty: 2 })
    assert.equal(await f.bindingQty(b), 2)
    await assert.rejects(purchase.closeRemaining(f.poId, operator), error => error.code === 'BINDING_SALE_DEPENDENCY')
    await re.releaseByRef(conn, 'sale_order', b.saleId)
    assert.equal(await f.bindingQty(), 0)
    await purchase.closeRemaining(f.poId, operator)
    assert.equal((await f.stock()).expected, 0)
  })
  test('F05 预计占库出库不能消耗其它销售的现货份额', async f => {
    const a = await f.sale(5), b = await f.sale(5)
    await f.reserve(a, 5)
    const containerId = await f.container(5)
    await f.reserve(b, 5)
    assert.equal(await f.bindingQty(b), 0)
    await assert.rejects(f.ship(a, containerId, 5), /现货.*预占|预占.*现货/)
    assert.equal((await f.stock()).reserved, 10)
  })
  test('F05 有未占现货时履约可按量关闭本销售采购依赖', async f => {
    const a = await f.sale(5)
    await f.reserve(a, 5)
    const containerId = await f.container(5)
    await f.ship(a, containerId, 3)
    assert.equal(await f.bindingQty(a), 2)
    await f.ship(a, containerId, 2)
    assert.equal(await f.bindingQty(a), 0)
    await purchase.cancel(f.poId, operator)
  })
  test('F05 上架兑现后撤回收货不能移除现货预占支撑', async f => {
    const a = await f.sale(5)
    await f.reserve(a, 5)
    const arrival = await f.receive(5)
    await arrival.putaway(arrival.containers[0])
    assert.equal(await f.bindingQty(), 0)
    await assert.rejects(receipt.voidReceipt(arrival.taskId, operator), /预占/)
    assert.equal((await f.stock()).quantity, 5)
  })
  test('F05 两采购明细快照不能把第二销售重复绑定到已满采购行', async f => {
    await conn.query('UPDATE purchase_order_items SET quantity=5 WHERE id=?', [f.poiId])
    const po2 = await insert(`INSERT INTO purchase_orders
      (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,1,'测试供应商',?,'测试仓库',2,1,'测试')`, [unique('PO'), wh])
    await insert(`INSERT INTO purchase_order_items
      (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,?,'库存回归','个',5,10,50)`, [po2, f.productId, f.code])
    const stale = await expected.getExpectedStock(conn, [{ productId: f.productId, warehouseId: wh }])
    await f.reserve(await f.sale(5), 5, stale.items)
    await f.reserve(await f.sale(5), 5, stale.items)
    const [rows] = await conn.query(`SELECT purchase_item_id,SUM(qty) AS qty FROM sale_order_expected_bindings
      WHERE product_id=? AND released_at IS NULL GROUP BY purchase_item_id`, [f.productId])
    assert.deepEqual(rows.map(r => Number(r.qty)).sort(), [5, 5])
  })
  async function cleanCommittedFixture(f) {
    const [sales] = await conn.query('SELECT order_id FROM sale_order_items WHERE product_id=?', [f.productId])
    await conn.query('DELETE FROM sale_order_expected_bindings WHERE product_id=?', [f.productId])
    await conn.query('DELETE FROM stock_reservations WHERE product_id=?', [f.productId])
    await conn.query('DELETE FROM sale_order_items WHERE product_id=?', [f.productId])
    for (const row of sales) await conn.query('DELETE FROM sale_orders WHERE id=?', [row.order_id])
    await conn.query('DELETE FROM purchase_order_items WHERE order_id=?', [f.poId])
    await conn.query('DELETE FROM purchase_orders WHERE id=?', [f.poId])
    await conn.query('DELETE FROM inventory_stock WHERE product_id=?', [f.productId])
    await conn.query('DELETE FROM product_items WHERE id=?', [f.productId])
    await conn.query('DELETE FROM inventory_warehouses WHERE id=?', [wh])
  }
  test('F05 并发预占在旧事务快照下也不能超配', async f => {
    const a = await f.sale(6), b = await f.sale(6)
    await conn.commit()
    const other = await mysql.createConnection(databaseOptions)
    try {
      await other.beginTransaction()
      // 固定 B 的旧快照（尚无 A 的绑定）。实际占库必须重新当前读。
      await expected.getExpectedStock(other, [{ productId: f.productId, warehouseId: wh }])
      await conn.beginTransaction()
      await f.reserve(a, 6)
      const pending = f.reserve(b, 6, null, other).then(() => null, error => error)
      await conn.commit()
      const rejection = await pending
      assert.match(rejection?.message || '', /库存不足/)
      await other.rollback()
      assert.equal((await f.stock()).reserved, 6)
      assert.equal(await f.bindingQty(), 6)
    } finally {
      await other.rollback()
      await other.end()
      await conn.rollback()
      await cleanCommittedFixture(f)
    }
  })
  test('F04 撤回与销售占库交错时，采购锁后能看到刚提交绑定', async f => {
    const a = await f.sale(5)
    await conn.commit()
    const other = await mysql.createConnection(databaseOptions)
    try {
      await conn.beginTransaction()
      await f.reserve(a, 5)
      let snapshotTaken
      const snapshot = new Promise(resolve => { snapshotTaken = resolve })
      serviceOverride = {
        query: async (...args) => {
          const result = await other.query(...args)
          if (String(args[0]).includes('SELECT DISTINCT task_id')) snapshotTaken()
          return result
        },
        beginTransaction: () => other.beginTransaction(), commit: () => other.commit(),
        rollback: () => other.rollback(), release() {},
      }
      const pending = purchase.withdrawConfirm(f.poId, operator).then(() => null, error => error)
      await snapshot
      await conn.commit()
      const rejection = await pending
      assert.equal(rejection?.code, 'BINDING_SALE_DEPENDENCY')
      const [[po]] = await conn.query('SELECT status FROM purchase_orders WHERE id=?', [f.poId])
      assert.equal(Number(po.status), 2)
    } finally {
      serviceOverride = null
      await other.rollback()
      await other.end()
      await conn.rollback()
      await cleanCommittedFixture(f)
    }
  })
  test('F05 整单释放发现旧快照漏掉的新维度时安全拒绝', async f => {
    const sale = await f.sale(5)
    await conn.commit()
    const other = await mysql.createConnection(databaseOptions)
    try {
      await conn.beginTransaction()
      await conn.query("SELECT id FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=?", [sale.saleId])
      await other.beginTransaction()
      await f.reserve(sale, 5, null, other)
      await other.commit()
      await assert.rejects(re.releaseByRef(conn, 'sale_order', sale.saleId), /预占维度已变化/)
      await conn.rollback()
      assert.equal((await f.stock()).reserved, 5)
    } finally {
      await other.rollback()
      await other.end()
      await conn.rollback()
      await cleanCommittedFixture(f)
    }
  })
  for (const mode of ['all', 'partial']) {
    test(`F05 ${mode}释放与上架/履约按同一库存锁序执行`, async f => {
      const bCode = unique('PB')
      const bId = await insert("INSERT INTO product_items (code,name,unit) VALUES (?,'锁序测试B','个')", [bCode])
      const bPoi = await insert(`INSERT INTO purchase_order_items
        (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
        VALUES (?,?,?,'锁序测试B','个',10,10,100)`, [f.poId, bId, bCode])
      const sale = await f.sale(5)
      const bItem = await insert(`INSERT INTO sale_order_items
        (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,quantity,unit_price,amount)
        VALUES (?,?,'测试仓库',?,?,'锁序测试B','个',5,20,100)`, [sale.saleId, wh, bId, bCode])
      await f.reserve(sale, 5)
      await re.reserve(conn, { productId: bId, warehouseId: wh, qty: 5, refType: 'sale_order',
        refId: sale.saleId, refItemId: bItem, refNo: '锁序测试', includeExpected: true })
      await conn.commit()
      const puttingAway = await mysql.createConnection(databaseOptions)
      let releasing
      try {
        await puttingAway.beginTransaction()
        await puttingAway.query('SELECT quantity FROM inventory_stock FORCE INDEX (uk_product_wh) WHERE product_id=? AND warehouse_id=? FOR UPDATE', [bId, wh])
        await conn.beginTransaction()
        let attemptedStock
        const attempt = new Promise(resolve => { attemptedStock = resolve })
        const releasingConnection = { query: (sql, params) => {
          if (String(sql).includes('inventory_stock') && Number(params?.[0]) === bId) attemptedStock()
          return conn.query(sql, params)
        } }
        const release = mode === 'all'
          ? re.releaseByRef(releasingConnection, 'sale_order', sale.saleId)
          : re.partialReleaseByProduct(releasingConnection, { refType: 'sale_order', refId: sale.saleId,
            productId: bId, warehouseId: wh, qty: 4 })
        releasing = release.then(() => null, error => error)
        await Promise.race([attempt, new Promise((_, reject) => setTimeout(() => reject(new Error('未到达目标库存锁')), 2000))])
        // 上架在已持库存锁后兑现该采购明细；必须不被释放方先持有的绑定/预占行反锁。
        const concurrentOperation = mode === 'all'
          ? expected.reduceExpectedBindings(puttingAway, { purchaseItemId: bPoi }, 1)
          : re.markFulfilled(puttingAway, 'sale_order', sale.saleId, bId, wh, 1)
        const putawayError = await concurrentOperation.then(() => null, error => error)
        if (putawayError) await puttingAway.rollback()
        else await puttingAway.commit()
        const releaseError = await releasing
        assert.equal(putawayError, null)
        assert.equal(releaseError, null)
        await conn.commit()
      } finally {
        await puttingAway.rollback()
        await puttingAway.end()
        if (releasing) await releasing
        await conn.rollback()
        await conn.query('DELETE FROM sale_order_expected_bindings WHERE product_id=?', [bId])
        await conn.query('DELETE FROM stock_reservations WHERE product_id=?', [bId])
        await conn.query('DELETE FROM sale_order_items WHERE product_id=?', [bId])
        await conn.query('DELETE FROM inventory_stock WHERE product_id=?', [bId])
        await conn.query('DELETE FROM product_items WHERE id=?', [bId])
        await cleanCommittedFixture(f)
      }
    })
  }
  let failed = 0
  const [printerBindingsBefore] = await conn.query('SELECT * FROM printer_bindings ORDER BY id')
  try {
    for (const { name, run } of tests) {
      await conn.beginTransaction()
      try { await run(await fixture()); console.log('PASS', name) }
      catch (error) { failed++; console.error('FAIL', name, error.stack) }
      finally { await conn.rollback() }
    }
    const [printerBindingsAfter] = await conn.query('SELECT * FROM printer_bindings ORDER BY id')
    assert.deepEqual(printerBindingsAfter, printerBindingsBefore, '打印夹具必须完整恢复运行前已有绑定')
  } finally { await conn.end() }
  console.log(`inventory audit: ${tests.length - failed} passed / ${failed} failed; MySQL ${server.version}; fixtures rolled back or exact-ID cleanup`)
  process.exit(failed ? 1 : 0)
}
main().catch(error => { console.error(error); process.exit(1) })
