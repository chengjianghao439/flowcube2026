/** 2026-09-18 深审计 P0 回归：撤回收货 × 在途调拨、盘点扫码 × 拣货锁定容器。
 *
 * 这两条都属于「静默出错」：不报错、界面正常，错误直接落进库存。靠人工点测发现不了。
 *
 * P0-5 整箱调拨复用同一容器行（只改 warehouse_id/status/transfer_order_id，数量不动），
 *      因此撤回收货既有的两道守卫（locked_by_task_id、remaining_qty≠initial_qty）全部放行。
 *      修复前：在途货被整只置 VOID → 源仓已减、目的仓未入，货从账上消失且不留流水；
 *      调拨单因容器被作废而永久卡在「在途」。
 *
 * P0-1 PDA 扫码盘点自拼批量 UPDATE，绕开了 containerEngine.deductFromContainers 里的
 *      「排除 locked_by_task_id」闸门。修复前：已被拣出货、放在料箱里的容器因盘点员在
 *      货架上扫不到而被判整只盘亏 → 清零并置 EMPTY；随后持锁任务出库时找不到可用锁定
 *      容器，400 永久卡在待出库（货就在料箱里，系统却拒绝出库）。
 *
 * 运行：node tests/audit-2026-09-18.smoke.test.js
 * 需要第 3 节独立测试库（NODE_ENV=test + flowcube_*_test）。
 */
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
  assert.equal(server.databaseName, process.env.DB_NAME, '必须连接独立测试库')
  assert.match(server.version, /^8\./)
  console.log(`Testing ${server.databaseName}, MySQL ${server.version}`)
  await conn.query("SET time_zone = '+08:00'")
  await conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci')

  // 服务层事务映射到 SAVEPOINT，外层事务在用例结束时整体回滚 → 夹具零残留
  // 故障注入开关：用于复现「吊销失败后重试」这类场景（见 PDA 改绑仓用例）
  let failNextSessionRevoke = false
  const serviceConn = {
    query: (sql, params) => {
      if (failNextSessionRevoke && /^\s*UPDATE\s+pda_device_sessions/i.test(String(sql))) {
        failNextSessionRevoke = false
        return Promise.reject(new Error('注入的会话吊销失败'))
      }
      return conn.query(sql, params)
    },
    beginTransaction: () => conn.query('SAVEPOINT service_transaction'),
    commit: () => conn.query('RELEASE SAVEPOINT service_transaction'),
    rollback: () => conn.query('ROLLBACK TO SAVEPOINT service_transaction'),
    release() {},
  }
  require.cache[require.resolve(path.join(root, 'config/db'))] = {
    exports: {
      pool: {
        // 故障注入要**同时**挂在 pool 与事务连接上：修复前吊销走 pool.query、修复后走事务连接，
        // 只拦一边的话旧代码根本不会失败，测试就变成「证明代码路径变了」而不是「证明行为修好了」。
        query: (sql, params) => {
          if (failNextSessionRevoke && /^\s*UPDATE\s+pda_device_sessions/i.test(String(sql))) {
            failNextSessionRevoke = false
            return Promise.reject(new Error('注入的会话吊销失败'))
          }
          return conn.query(sql, params)
        },
        getConnection: async () => serviceConn,
      },
    },
  }

  const ce = require('../backend/src/engine/containerEngine')
  const voidSvc = require('../backend/src/modules/inbound-tasks/inbound-tasks.void')
  const stockcheckSvc = require('../backend/src/modules/stockcheck/stockcheck.service')
  const saleSvc = require('../backend/src/modules/sale/sale.service')
  const inventorySvc = require('../backend/src/modules/inventory/inventory.service')
  const usersSvc = require('../backend/src/modules/users/users.service')
  const wtSvc = require('../backend/src/modules/warehouse-tasks/warehouse-tasks.service')
  const scanLogSvc = require('../backend/src/modules/scan-logs/scan-logs.service')
  const prodSvc = require('../backend/src/modules/products/products.service')
  const ctrSvc = require('../backend/src/modules/containers/containers.service')
  const apprSvc = require('../backend/src/modules/approvals/approvals.service')
  const rpSvc = require('../backend/src/modules/returns/returns-purchase.service')
  const rsSvc = require('../backend/src/modules/returns/returns-sale.service')
  const printJobsSvc = require('../backend/src/modules/print-jobs/print-jobs.service')
  const invoiceSvc = require('../backend/src/modules/accounting/accounting.invoice.service')

  const operator = { userId: 2, realName: '审计回归' }
  let seq = 0
  const prefix = 'AUD' + Date.now().toString(36)
  const unique = kind => prefix + kind + (++seq)
  const insert = async (sql, params) => Number((await conn.query(sql, params))[0].insertId)

  async function fixture() {
    const wh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计回归仓')", [unique('W')])
    const wh2 = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计调入仓')", [unique('W')])
    const customerId = await insert("INSERT INTO sale_customers (code,name) VALUES (?, '审计客户')", [unique('CUST')])
    const code = unique('P')
    const productId = await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price) VALUES (?,'审计回归','个',20,10)", [code])
    const poId = await insert(`INSERT INTO purchase_orders
      (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,1,'测试供应商',?,'审计回归仓',2,1,'测试')`, [unique('PO'), wh])
    const poiId = await insert(`INSERT INTO purchase_order_items
      (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,?,'审计回归','个',10,10,100)`, [poId, productId, code])

    // 收货任务 + 明细（来源完整，assertPurchaseOrdersOpen 才能通过）
    async function inboundTask(status = 3) {
      const taskId = await insert(`INSERT INTO inbound_tasks
        (task_no,purchase_order_id,purchase_order_no,warehouse_id,warehouse_name,status,audit_status,submitted_at)
        VALUES (?,?,'审计采购',?,'审计回归仓',?,0,NOW())`, [unique('IT'), poId, wh, status])
      const taskItemId = await insert(`INSERT INTO inbound_task_items
        (task_id,purchase_order_id,purchase_item_id,product_id,product_code,product_name,unit,ordered_qty,received_qty,putaway_qty)
        VALUES (?,?,?,?,?,'审计回归','个',10,10,10)`, [taskId, poId, poiId, productId, code])
      return { taskId, taskItemId }
    }

    async function activeContainer(qty, opts = {}) {
      // 引擎禁止以 ACTIVE 直接创建入库任务容器（必须「先待上架再上架」），
      // 这里照真实收货路径：先建待上架，再 promote。
      const targetWh = opts.warehouseId != null ? Number(opts.warehouseId) : wh
      const hasInbound = opts.inboundTaskId != null
      const created = await ce.createContainer(conn, {
        productId, warehouseId: targetWh, initialQty: qty, unit: '个', barcode: unique('C'),
        sourceType: hasInbound ? ce.SOURCE_TYPE.INBOUND_TASK : ce.SOURCE_TYPE.IMPORT,
        sourceRefId: hasInbound ? opts.inboundTaskId : poId,
        containerStatus: ce.CONTAINER_STATUS.PENDING_PUTAWAY,
        ...opts,
      })
      await ce.promotePendingContainerToActive(conn, created.containerId, productId, targetWh)
      return created.containerId
    }

    async function saleOrder(qty = 10, warehouseId = wh) {
      const saleId = await insert(`INSERT INTO sale_orders
        (order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
        VALUES (?,?,'审计客户',?,'审计回归仓',1,1,'测试')`, [unique('SO'), customerId, warehouseId])
      const itemId = await insert(`INSERT INTO sale_order_items
        (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,quantity,unit_price,amount)
        VALUES (?,?,'审计回归仓',?,?,'审计回归','个',?,20,?)`, [saleId, warehouseId, productId, code, qty, qty * 20])
      return { saleId, itemId }
    }

    const saleItem = async (itemId) => {
      const [[r]] = await conn.query('SELECT warehouse_id,reserved_qty,dispatched_qty FROM sale_order_items WHERE id=?', [itemId])
      return r
    }
    const ledgerQty = async (warehouseId) => {
      const [[r]] = await conn.query(
        'SELECT COALESCE(SUM(qty),0) q FROM stock_reservations WHERE ref_type=\'sale_order\' AND product_id=? AND warehouse_id=? AND status=1',
        [productId, warehouseId])
      return Number(r.q)
    }

    const containerRow = async (id) => {
      const [[r]] = await conn.query(
        'SELECT id,status,remaining_qty,initial_qty,warehouse_id,locked_by_task_id,transfer_order_id FROM inventory_containers WHERE id=?', [id])
      return r
    }
    const stockQty = async (warehouseId = wh) => {
      const [[r]] = await conn.query('SELECT COALESCE(quantity,0) q FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [productId, warehouseId])
      return Number(r?.q ?? 0)
    }
    return { wh, wh2, code, productId, poId, poiId, inboundTask, activeContainer, containerRow, stockQty, saleOrder, saleItem, ledgerQty }
  }

  const tests = []
  const test = (name, run) => tests.push({ name, run })

  // ── P0-5 ────────────────────────────────────────────────────────────────
  test('★P0-5 在途调拨容器必须让撤回收货整单拒绝（修复前会被整只置 VOID）', async f => {
    const { taskId, taskItemId } = await f.inboundTask(3)
    const containerId = await f.activeContainer(10, { inboundTaskId: taskId, inboundTaskItemId: taskItemId })
    const before = await f.containerRow(containerId)

    // 复刻 transfer.service.js scanOut 对容器的写入：整箱移仓 + 置待上架 + 标记在途，数量不动
    const transferId = await insert(`INSERT INTO transfer_orders
      (order_no,from_warehouse_id,from_warehouse_name,to_warehouse_id,to_warehouse_name,status,operator_id,operator_name)
      VALUES (?,?, '审计回归仓',?, '审计调入仓',3,1,'测试')`, [unique('TR'), f.wh, f.wh2])
    await conn.query(
      'UPDATE inventory_containers SET warehouse_id=?, status=?, location_id=NULL, transfer_order_id=? WHERE id=?',
      [f.wh2, ce.CONTAINER_STATUS.PENDING_PUTAWAY, transferId, containerId])

    await assert.rejects(
      () => voidSvc.voidReceipt(taskId, operator),
      (err) => {
        assert.equal(err.statusCode, 409, '必须是 409 业务拒绝而不是 500')
        assert.match(err.message, /调拨在途/, '错误信息要点明在途调拨，现场才知道去哪处理')
        return true
      },
    )

    const after = await f.containerRow(containerId)
    assert.equal(Number(after.status), ce.CONTAINER_STATUS.PENDING_PUTAWAY, '容器状态不得被改动')
    assert.equal(Number(after.remaining_qty), Number(before.remaining_qty), '在途数量不得被清零')
    assert.equal(Number(after.transfer_order_id), transferId, '在途标记必须保留，调拨单才能继续扫入')
    const [[task]] = await conn.query('SELECT status FROM inbound_tasks WHERE id=?', [taskId])
    assert.equal(Number(task.status), 3, '收货订单必须停在原状态，整单拒绝而不是部分撤销')
  })

  test('P0-5 反向：没有在途调拨时撤回收货仍然正常工作（修复不能误伤）', async f => {
    const { taskId, taskItemId } = await f.inboundTask(3)
    const containerId = await f.activeContainer(10, { inboundTaskId: taskId, inboundTaskItemId: taskItemId })

    await voidSvc.voidReceipt(taskId, operator)

    const after = await f.containerRow(containerId)
    assert.equal(Number(after.status), ce.CONTAINER_STATUS.VOID, '正常撤回应把容器置 VOID')
    assert.equal(Number(after.remaining_qty), 0, '正常撤回应清零数量')
    assert.equal(await f.stockQty(), 0, '缓存应同步下调到 0')
  })

  // ── P0-1 ────────────────────────────────────────────────────────────────
  test('★P0-1 盘点扫码不得核销「已被拣货任务锁定」的容器（修复前会被当未扫到清零）', async f => {
    const { taskId } = await f.inboundTask(3)
    // 货架上还剩 5，另 10 已被拣出货放进料箱并锁定
    const binId = await f.activeContainer(5, { inboundTaskId: taskId })
    const lockedId = await f.activeContainer(10, { inboundTaskId: taskId })
    const warehouseTaskId = await insert(`INSERT INTO warehouse_tasks
      (task_no,task_type,sale_order_id,customer_name,warehouse_id,warehouse_name,status)
      VALUES (?, 'sale_out', NULL, '审计客户', ?, '审计回归仓', 2)`, [unique('WT'), f.wh])
    await conn.query('UPDATE inventory_containers SET locked_by_task_id=? WHERE id=?', [warehouseTaskId, lockedId])

    assert.equal(await f.stockQty(), 15, '前置：账面含货架上 5 + 料箱里 10')

    const check = await stockcheckSvc.create({
      warehouseId: f.wh, warehouseName: '审计回归仓', operator, productIds: [f.productId],
    })
    const checkId = check.id ?? check.checkId
    const [[item]] = await conn.query(
      'SELECT id, book_qty FROM inventory_check_items WHERE check_id=? AND product_id=?', [checkId, f.productId])
    assert.equal(Number(item.book_qty), 15)

    // 盘点员在货架上只能扫到 binId；料箱里的 lockedId 物理上扫不到
    const [[binRow]] = await conn.query('SELECT barcode FROM inventory_containers WHERE id=?', [binId])
    await stockcheckSvc.saveItemContainerScans(checkId, item.id, [{ barcode: binRow.barcode, countedQty: 5 }], operator)
    await stockcheckSvc.submit(checkId, operator)

    const lockedAfter = await f.containerRow(lockedId)
    assert.equal(Number(lockedAfter.status), ce.CONTAINER_STATUS.ACTIVE, '被锁定容器必须保持 ACTIVE')
    assert.equal(Number(lockedAfter.remaining_qty), 10, '被锁定容器数量不得被清零')
    assert.equal(Number(lockedAfter.locked_by_task_id), warehouseTaskId, '任务锁定必须保留，否则该任务将永久无法出库')

    const binAfter = await f.containerRow(binId)
    assert.equal(Number(binAfter.remaining_qty), 5, '扫到的容器数量一致时不应产生调整')
    assert.equal(await f.stockQty(), 15, '账面必须仍是 15（料箱里的货不能被凭空核销）')
  })

  test('★P0-1 对照：真正未扫到的未锁定容器仍然要按盘亏核销（修复不能放过真盘亏）', async f => {
    const { taskId } = await f.inboundTask(3)
    const keepId = await f.activeContainer(5, { inboundTaskId: taskId })
    const lostId = await f.activeContainer(7, { inboundTaskId: taskId })

    const check = await stockcheckSvc.create({
      warehouseId: f.wh, warehouseName: '审计回归仓', operator, productIds: [f.productId],
    })
    const checkId = check.id ?? check.checkId
    const [[item]] = await conn.query(
      'SELECT id FROM inventory_check_items WHERE check_id=? AND product_id=?', [checkId, f.productId])

    const [[keepRow]] = await conn.query('SELECT barcode FROM inventory_containers WHERE id=?', [keepId])
    await stockcheckSvc.saveItemContainerScans(checkId, item.id, [{ barcode: keepRow.barcode, countedQty: 5 }], operator)
    await stockcheckSvc.submit(checkId, operator)

    const lostAfter = await f.containerRow(lostId)
    assert.equal(Number(lostAfter.remaining_qty), 0, '真盘亏（未扫到且未锁定）必须照常清零')
    assert.equal(Number(lostAfter.status), ce.CONTAINER_STATUS.EMPTY, '清零后应置 EMPTY')
    const keepAfter = await f.containerRow(keepId)
    assert.equal(Number(keepAfter.remaining_qty), 5, '扫到的容器不受影响')
    assert.equal(await f.stockQty(), 5, '账面应只保留扫到的 5')
  })

  // ── P0-4 ────────────────────────────────────────────────────────────────
  test('★P0-4 补占时不得更换发货仓库（修复前会孤儿化旧仓预占并截断新仓他人预占）', async f => {
    await f.activeContainer(10, {})
    await f.activeContainer(10, { warehouseId: f.wh2 })
    const { saleId, itemId } = await f.saleOrder(10, f.wh)

    await saleSvc.reserveStock(saleId, operator, [{ id: itemId, warehouseId: f.wh, qty: 5 }], { requestKey: unique('RK') })
    assert.equal(await f.ledgerQty(f.wh), 5, '前置：A 仓应有 5 的预占账')

    await assert.rejects(
      () => saleSvc.reserveStock(saleId, operator, [{ id: itemId, warehouseId: f.wh2, qty: 5 }], { requestKey: unique('RK') }),
      (err) => {
        assert.equal(err.statusCode, 400, '必须是 400 业务拒绝而不是 500')
        assert.equal(err.code, 'RESERVE_WAREHOUSE_CHANGE_NOT_ALLOWED')
        return true
      },
    )

    assert.equal(await f.ledgerQty(f.wh), 5, 'A 仓预占账必须原样保留（不得成为孤儿预占）')
    assert.equal(await f.ledgerQty(f.wh2), 0, 'B 仓不得凭空出现预占')
    const it = await f.saleItem(itemId)
    assert.equal(Number(it.warehouse_id), f.wh, '明细行仓库不得被改写')
    assert.equal(Number(it.reserved_qty), 5, '已占量不得变化')
  })

  test('P0-4 反向：同仓补占仍然正常工作（修复不能误伤）', async f => {
    await f.activeContainer(10, {})
    const { saleId, itemId } = await f.saleOrder(10, f.wh)
    await saleSvc.reserveStock(saleId, operator, [{ id: itemId, warehouseId: f.wh, qty: 4 }], { requestKey: unique('RK') })
    await saleSvc.reserveStock(saleId, operator, [{ id: itemId, warehouseId: f.wh, qty: 6 }], { requestKey: unique('RK') })
    const it = await f.saleItem(itemId)
    assert.equal(Number(it.reserved_qty), 10, '同仓补占应累计到 10')
    assert.equal(await f.ledgerQty(f.wh), 10, '预占账应同步到 10')
  })

  // ── P0-2 / 自我提权 ─────────────────────────────────────────────────────
  test('★P0-2 库存容器移库与拆分必须做仓库范围校验，且库位须与容器同仓', async f => {
    const { taskId } = await f.inboundTask(3)
    const containerId = await f.activeContainer(5, { inboundTaskId: taskId })
    const otherWh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计他仓')", [unique('W')])
    const locSame = await insert('INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [f.wh, unique('L')])
    const locOther = await insert('INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [otherWh, unique('L')])

    // 越权：调用方范围只含他仓，而容器在 f.wh
    await assert.rejects(
      () => inventorySvc.assignContainerLocation(containerId, locSame, [otherWh]),
      (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'WAREHOUSE_SCOPE_DENIED'); return true },
    )
    await assert.rejects(
      () => inventorySvc.splitContainerOp(containerId, { qty: 1, userId: 1, userName: 'x' }, [otherWh]),
      (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'WAREHOUSE_SCOPE_DENIED'); return true },
    )
    // 跨仓库位：容器在 f.wh，库位在他仓
    await assert.rejects(
      () => inventorySvc.assignContainerLocation(containerId, locOther, null),
      (e) => { assert.equal(e.statusCode, 400); assert.match(e.message, /库位不属于/); return true },
    )
    const [[unmoved]] = await conn.query('SELECT location_id FROM inventory_containers WHERE id=?', [containerId])
    assert.equal(unmoved.location_id, null, '被拒的调用不得改动容器库位')

    // 反向：同仓且在范围内时必须仍然成功
    const ok = await inventorySvc.assignContainerLocation(containerId, locSame, [f.wh])
    assert.equal(Number(ok.containerId), containerId)
    const [[moved]] = await conn.query('SELECT location_id FROM inventory_containers WHERE id=?', [containerId])
    assert.equal(Number(moved.location_id), Number(locSame))
  })

  test('★P1 仓库范围自我提权必须被拒（清空自己那行即等于不限仓）', async f => {
    const attackerId = await insert(`INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active)
      VALUES (?, 'x', '审计提权者', 2, '仓库管理员', 1)`, [unique('U')])
    // 先给他一个受限范围，再尝试自己清空
    await conn.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [attackerId, f.wh])

    await assert.rejects(
      () => usersSvc.setWarehouseScope(attackerId, [], { userId: attackerId }),
      (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'USER_SCOPE_SELF_FORBIDDEN'); return true },
    )
    const [[kept]] = await conn.query('SELECT COUNT(*) n FROM user_warehouse_scope WHERE user_id=?', [attackerId])
    assert.equal(Number(kept.n), 1, '失败调用必须回滚，原范围行保留')

    // 非超管改别人是允许的（不能把守卫做成"谁都不能改"）
    const otherId = await insert(`INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active)
      VALUES (?, 'x', '审计被改者', 3, '仓管员', 1)`, [unique('U')])
    const r = await usersSvc.setWarehouseScope(otherId, [f.wh2], { userId: attackerId })
    assert.deepEqual(r.warehouseIds, [f.wh2])
  })

  // ── 同形态 P1：仓库范围缺口 ──────────────────────────────────────────────
  test('★P1 warehouse-tasks 任务池与统计必须按仓库范围过滤', async f => {
    const otherWh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计他仓')", [unique('W')])
    const taskId = await insert(`INSERT INTO warehouse_tasks
      (task_no,task_type,sale_order_id,customer_name,warehouse_id,warehouse_name,status)
      VALUES (?, 'sale_out', NULL, '审计客户', ?, '审计回归仓', 2)`, [unique('WT'), f.wh])
    // SKU 汇总走 INNER JOIN warehouse_task_items，必须建明细行才看得出范围过滤
    await insert(`INSERT INTO warehouse_task_items
      (task_id,product_id,product_code,product_name,unit,required_qty,picked_qty)
      VALUES (?,?,?,'审计回归','个',10,0)`, [taskId, f.productId, f.code])

    const mine = await wtSvc.findMyTasks([f.wh])
    assert.ok(mine.some(t => Number(t.id) === taskId), '本仓任务应可见')
    const others = await wtSvc.findMyTasks([otherWh])
    assert.ok(!others.some(t => Number(t.id) === taskId), '他仓任务不得出现在任务池里')
    assert.equal((await wtSvc.findMyTasks([])).length, 0, '空范围必须返回空结果而不是全量')

    assert.equal((await wtSvc.getTaskStats([otherWh])).picking, 0, '统计不得计入范围外的拣货中任务')
    assert.ok((await wtSvc.getTaskStats([f.wh])).picking >= 1, '本仓统计应计入')

    const skuMine = await wtSvc.findMyTaskSkuSummary([f.wh])
    assert.ok(skuMine.some(r => Number(r.productId) === Number(f.productId)), '本仓 SKU 汇总应包含')
    assert.ok(!(await wtSvc.findMyTaskSkuSummary([otherWh])).some(r => Number(r.productId) === Number(f.productId)),
      '他仓 SKU 汇总不得包含本仓商品')
  })

  test('★P1 scan-logs 四条写路径都必须做仓库范围校验', async f => {
    const otherWh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计他仓')", [unique('W')])
    const taskId = await insert(`INSERT INTO warehouse_tasks
      (task_no,task_type,sale_order_id,customer_name,warehouse_id,warehouse_name,status)
      VALUES (?, 'sale_out', NULL, '审计客户', ?, '审计回归仓', 2)`, [unique('WT'), f.wh])

    const deny = (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'WAREHOUSE_SCOPE_DENIED'); return true }
    await assert.rejects(() => scanLogSvc.createScanLog({
      taskId, barcode: 'AUDIT-BC', productId: f.productId, qty: 1,
      operatorId: 1, operatorName: 'x', requestKey: unique('RK'), scopeWarehouseIds: [otherWh],
    }), deny)
    await assert.rejects(() => scanLogSvc.createCheckScanLog({
      taskId, barcode: 'AUDIT-BC', operatorId: 1, operatorName: 'x',
      requestKey: unique('RK'), scopeWarehouseIds: [otherWh],
    }), deny)
    await assert.rejects(() => scanLogSvc.createCancelReturnScanLog({
      taskId, containerId: 1, barcode: 'AUDIT-BC', locationId: 1,
      operatorId: 1, operatorName: 'x', requestKey: unique('RK'), scopeWarehouseIds: [otherWh],
    }), deny)
    await assert.rejects(() => scanLogSvc.createCancelReturnBoxScanLog({
      taskId, packageId: 1, barcode: 'AUDIT-BC',
      operatorId: 1, operatorName: 'x', requestKey: unique('RK'), scopeWarehouseIds: [otherWh],
    }), deny)

    // 反向：范围正确时不得被这部分拦住（后续业务校验另说，这里只断言不是范围错误）
    const err = await scanLogSvc.createScanLog({
      taskId, barcode: 'AUDIT-BC', productId: f.productId, qty: 1,
      operatorId: 1, operatorName: 'x', requestKey: unique('RK'), scopeWarehouseIds: [f.wh],
    }).then(() => null, e => e)
    if (err) assert.notEqual(err.code, 'WAREHOUSE_SCOPE_DENIED', '范围正确时不应报范围错误')
  })

  // ── P2 同形态：跨仓读取/查询收口 ────────────────────────────────────────
  test('★P2 五处跨仓读取与查询必须被拦截（products/finder、containers/overdue、returns 来源单、approvals）', async f => {
    const otherWh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计他仓')", [unique('W')])
    const denyScope = (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'WAREHOUSE_SCOPE_DENIED'); return true }

    // ① products/finder：warehouseId 不在调用方范围内
    await assert.rejects(
      () => prodSvc.findForFinder({ warehouseId: otherWh, scopeWarehouseIds: [f.wh] }), denyScope)
    const okFinder = await prodSvc.findForFinder({ warehouseId: f.wh, scopeWarehouseIds: [f.wh] })
    assert.ok(Array.isArray(okFinder.list ?? okFinder), '范围内查询应正常返回')

    // ② containers/overdue：他仓超期容器不得出现在本仓范围的列表里
    const shell = await ce.createContainer(conn, {
      productId: f.productId, warehouseId: otherWh, initialQty: 1, unit: '个',
      sourceType: ce.SOURCE_TYPE.IMPORT, sourceRefId: f.poId, barcode: unique('C'),
      containerStatus: ce.CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    await conn.query('UPDATE inventory_containers SET putaway_flagged_overdue=1 WHERE id=?', [shell.containerId])
    const seenInOwnScope = await ctrSvc.listOverduePending([otherWh])
    assert.ok(seenInOwnScope.some(r => Number(r.id) === Number(shell.containerId)), '在他仓范围内应能看到')
    const seenInOtherScope = await ctrSvc.listOverduePending([f.wh])
    assert.ok(!seenInOtherScope.some(r => Number(r.id) === Number(shell.containerId)), '本仓范围不得看到他仓超期容器')

    // ③④ returns 来源单按单号直查：跨仓必须拒
    const [[po]] = await conn.query('SELECT order_no FROM purchase_orders WHERE id=?', [f.poId])
    await assert.rejects(() => rpSvc.loadPurchaseSourceOrderByNo(po.order_no, [otherWh]), denyScope)
    assert.ok(await rpSvc.loadPurchaseSourceOrderByNo(po.order_no, [f.wh]), '本仓范围内应能读到来源采购单')

    const { saleId } = await f.saleOrder(3, f.wh)
    const [[so]] = await conn.query('SELECT order_no FROM sale_orders WHERE id=?', [saleId])
    await assert.rejects(() => rsSvc.loadSaleSourceOrderByNo(so.order_no, [otherWh]), denyScope)
    assert.ok(await rsSvc.loadSaleSourceOrderByNo(so.order_no, [f.wh]), '本仓范围内应能读到来源销售单')

    // ⑤ approvals/biz：超管虽跳过权限码，仓库范围仍必须拦
    await assert.rejects(
      () => apprSvc.getBizApproval({
        bizType: 'purchase_order', bizId: f.poId, user: { roleId: 1 }, scopeWarehouseIds: [otherWh],
      }), denyScope)
    // 未知业务类型必须明确 400，不能透传给引擎
    await assert.rejects(
      () => apprSvc.getBizApproval({ bizType: 'no_such_biz', bizId: 1, user: { roleId: 1 } }),
      (e) => { assert.equal(e.statusCode, 400); return true })
  })

  test('★P2 print-jobs 列表 / 详情 / 条码查询必须按仓库范围过滤', async f => {
    const otherWh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计他仓')", [unique('W')])
    const jobId = await insert(
      `INSERT INTO print_jobs (title, content, warehouse_id, status) VALUES ('审计标签','^XA^FDTEST^FS^XZ',?,0)`,
      [f.wh])

    const mine = await printJobsSvc.findAll({ scopeWarehouseIds: [f.wh], pageSize: 200 })
    assert.ok(mine.list.some(j => Number(j.id) === jobId), '本仓打印任务应可见')
    const others = await printJobsSvc.findAll({ scopeWarehouseIds: [otherWh], pageSize: 200 })
    assert.ok(!others.list.some(j => Number(j.id) === jobId), '他仓打印任务不得可见（含完整 ZPL 内容）')
    assert.equal((await printJobsSvc.findAll({ scopeWarehouseIds: [], pageSize: 200 })).list.length, 0,
      '空范围必须返回空列表而不是全量')

    await assert.rejects(() => printJobsSvc.findById(jobId, [otherWh]),
      (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'WAREHOUSE_SCOPE_DENIED'); return true })
    assert.equal(Number((await printJobsSvc.findById(jobId, [f.wh])).id), jobId, '本仓范围内详情应可读')

    // 条码补打中心三个分类：空范围一律为空（同时验证三张 SQL 的参数绑定顺序没被插错位）
    for (const category of ['inbound', 'outbound', 'logistics']) {
      const r = await printJobsSvc.findBarcodeRecords({ category, scopeWarehouseIds: [] })
      assert.equal(r.list.length, 0, `${category} 空范围应为空`)
      const unrestricted = await printJobsSvc.findBarcodeRecords({ category, scopeWarehouseIds: null })
      assert.ok(Array.isArray(unrestricted.list), `${category} 不限仓应正常返回`)
    }
  })

  test('★P1 销售退货可退量必须按行仓库统计，不得跨仓汇总（分仓同商品超退）', async f => {
    const otherWh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计他仓')", [unique('W')])
    const orderNo = unique('SO')
    const saleId = await insert(`INSERT INTO sale_orders
      (order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,1,'审计客户',?,'审计回归仓',4,1,'测试')`, [orderNo, f.wh])
    // 同一商品分两仓各发 10：两行 product_id 相同、warehouse_id 不同
    const lineA = await insert(`INSERT INTO sale_order_items
      (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,'审计回归仓',?,?,'审计回归','个',10,20,200)`, [saleId, f.wh, f.productId, f.code])
    const lineB = await insert(`INSERT INTO sale_order_items
      (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,'审计他仓',?,?,'审计回归','个',10,20,200)`, [saleId, otherWh, f.productId, f.code])
    for (const whId of [f.wh, otherWh]) {
      const taskId = await insert(`INSERT INTO warehouse_tasks
        (task_no,task_type,sale_order_id,customer_name,warehouse_id,warehouse_name,status)
        VALUES (?, 'sale_out', ?, '审计客户', ?, '审计仓库', 7)`, [unique('WT'), saleId, whId])
      await insert(`INSERT INTO warehouse_task_items
        (task_id,product_id,product_code,product_name,unit,required_qty,picked_qty)
        VALUES (?,?,?,'审计回归','个',10,10)`, [taskId, f.productId, f.code])
    }

    const src = await rsSvc.loadSaleSourceOrderByNo(orderNo, [f.wh, otherWh])
    const byLine = new Map(src.items.map(i => [Number(i.sourceItemId), Number(i.shippedQty)]))
    assert.equal(byLine.get(lineA), 10, 'A 行只能算本仓发出的 10，不能把 B 仓的也算进来')
    assert.equal(byLine.get(lineB), 10, 'B 行同理')
    const total = [...byLine.values()].reduce((s, n) => s + n, 0)
    assert.equal(total, 20, `可退量合计必须是实发 20；修复前每行各算 20、合计 40（超退 20）`)
  })

  test('★P1 发票查询/详情/红冲/删除必须按账套过滤（单边过滤可跨账套改数）', async f => {
    const otherCompany = 9001 + (Number(String(Date.now()).slice(-3)) % 90)
    await conn.query('INSERT INTO acct_companies (id, code, name) VALUES (?, ?, ?)',
      [otherCompany, unique('CO'), '审计他账套'])
    const invId = await insert(
      `INSERT INTO fin_invoices (invoice_type, party_name, invoice_date, amount_with_tax, status, company_id)
       VALUES (2, '审计客户', CURDATE(), 113, 1, ?)`, [otherCompany])

    // 本账套既看不到、也读不到他账套的发票
    const mine = await invoiceSvc.listInvoices({}, 1)
    assert.ok(!mine.list.some(r => Number(r.id) === invId), '本账套列表不得出现他账套发票')
    const theirs = await invoiceSvc.listInvoices({}, otherCompany)
    assert.ok(theirs.list.some(r => Number(r.id) === invId), '本账套内应能查到自己的发票')

    await assert.rejects(() => invoiceSvc.getInvoice(invId, 1),
      (e) => { assert.equal(e.statusCode, 404, '账套不符必须按 404，不泄露「存在但非本账套」'); return true })
    assert.equal(Number((await invoiceSvc.getInvoice(invId, otherCompany)).id), invId)

    // 跨账套红冲/删除必须被拒，且不得留下任何改动
    await assert.rejects(() => invoiceSvc.changeStatus(invId, 'reverse', { userId: 1 }, 1),
      (e) => { assert.equal(e.statusCode, 404); return true })
    await assert.rejects(() => invoiceSvc.removeInvoice(invId, { userId: 1 }, 1),
      (e) => { assert.equal(e.statusCode, 404); return true })
    const [[still]] = await conn.query('SELECT status, deleted_at FROM fin_invoices WHERE id=?', [invId])
    assert.equal(Number(still.status), 1, '状态不得被跨账套红冲')
    assert.equal(still.deleted_at, null, '不得被跨账套软删')
  })

  test('★P1 占库期改单（状态 2/6 无任务）必须拦下重复 (商品,仓库) 明细行', async f => {
    // 占库期分支在 `if (!orderRow.task_id)` 处提前 return，而重复行校验原先只写在执行期分支内，
    // 对状态 2/6 的订单完全不可达 → 重建明细时 reserved_qty 合计被逐行放大。
    const { saleId, itemId } = await f.saleOrder(10, f.wh)
    await conn.query('UPDATE sale_orders SET status=6 WHERE id=?', [saleId])
    await conn.query('UPDATE sale_order_items SET reserved_qty=4 WHERE id=?', [itemId])

    await assert.rejects(
      () => saleSvc.requestAdjustment(saleId, {
        items: [
          { productId: f.productId, quantity: 5, unitPrice: 20, amount: 100 },
          { productId: f.productId, quantity: 5, unitPrice: 20, amount: 100 },
        ],
        operator, requestKey: unique('RK'), scopeWarehouseIds: null,
      }),
      (e) => { assert.equal(e.statusCode, 400); assert.match(e.message, /重复明细行/); return true },
    )

    const [[agg]] = await conn.query(
      'SELECT COALESCE(SUM(reserved_qty),0) q, COUNT(*) n FROM sale_order_items WHERE order_id=?', [saleId])
    assert.equal(Number(agg.n), 1, '被拒的改单不得把明细重建出两行')
    assert.equal(Number(agg.q), 4, '已占量不得被放大')
  })

  test('★P1 改单挂起期间拣货/复核扫码必须被拦下（否则任务永久无法推进）', async f => {
    const mkTask = async (status) => insert(`INSERT INTO warehouse_tasks
      (task_no,task_type,sale_order_id,customer_name,warehouse_id,warehouse_name,status,adjustment_requested_at)
      VALUES (?, 'sale_out', NULL, '审计客户', ?, '审计回归仓', ?, NOW())`, [unique('WT'), f.wh, status])

    const checkTask = await mkTask(4)
    await assert.rejects(() => scanLogSvc.createCheckScanLog({
      taskId: checkTask, barcode: 'AUDIT-BC', operatorId: 1, operatorName: 'x',
      requestKey: unique('RK'), scopeWarehouseIds: [f.wh],
    }), (e) => { assert.equal(e.statusCode, 409); assert.match(e.message, /改单/); return true })

    const pickTask = await mkTask(2)
    await assert.rejects(() => scanLogSvc.createScanLog({
      taskId: pickTask, barcode: 'AUDIT-BC', productId: f.productId, qty: 1,
      operatorId: 1, operatorName: 'x', requestKey: unique('RK'), scopeWarehouseIds: [f.wh],
    }), (e) => { assert.equal(e.statusCode, 409); assert.match(e.message, /改单/); return true })
  })

  test('★P1 采购退货出库必须按行取单价（同商品多行不得 JOIN 放大卡死）', async f => {
    const returnNo = unique('PR')
    const returnId = await insert(`INSERT INTO purchase_returns
      (return_no,supplier_id,supplier_name,warehouse_id,warehouse_name,operator_id,operator_name)
      VALUES (?,1,'审计供应商',?,'审计回归仓',1,'测试')`, [returnNo, f.wh])
    // 同一商品两行、不同单价：这正是原先按 product_id 关联会 JOIN 放大的场景
    const lineA = await insert(`INSERT INTO purchase_return_items
      (return_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,?,'审计回归','个',5,10,50)`, [returnId, f.productId, f.code])
    const lineB = await insert(`INSERT INTO purchase_return_items
      (return_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,?,'审计回归','个',3,25,75)`, [returnId, f.productId, f.code])

    const { taskId } = await wtSvc.createForPurchaseReturn({
      returnId, returnNo, supplierName: '审计供应商',
      warehouseId: f.wh, warehouseName: '审计回归仓',
      items: [
        { returnItemId: lineA, productId: f.productId, productCode: f.code, productName: '审计回归', unit: '个', quantity: 5 },
        { returnItemId: lineB, productId: f.productId, productCode: f.code, productName: '审计回归', unit: '个', quantity: 3 },
      ],
      conn,
    })

    const [linked] = await conn.query(
      'SELECT purchase_return_item_id FROM warehouse_task_items WHERE task_id=? ORDER BY id', [taskId])
    assert.deepEqual(linked.map(r => Number(r.purchase_return_item_id)), [lineA, lineB],
      '任务明细必须记录来源退货行（迁移 247 的行级关联）')

    // 出库上下文按 picked_qty 计价，先模拟「已拣完」再取出库上下文
    await conn.query('UPDATE warehouse_task_items SET picked_qty = required_qty WHERE task_id=?', [taskId])

    // 修复前：LEFT JOIN 按 product_id 关联会得到 2 明细 × 2 退货行 = 4 行，
    // assertNoShipItemFanout 抛 409 → 出库永久卡死、库存与应付永不冲减。
    const ctx = await wtSvc.getShipContext(taskId)
    assert.equal(ctx.items.length, 2, '出库上下文必须是 2 条，不得被 JOIN 放大')
    assert.deepEqual(ctx.items.map(i => Number(i.unitPrice)).sort((a, b) => a - b), [10, 25],
      '每一行都必须取到**本行**的退货单价，不能串价')
    assert.equal(Number(ctx.totalAmount), 5 * 10 + 3 * 25, '金额按行精确计算，不得翻倍')
  })

  test('★P2 演示用 mock 平台不得在未显式开启时启用（生产会签出假快递单号）', async f => {
    const carrierSvc = require('../backend/src/modules/carriers/carriers.service')
    // mock 适配器无 HTTP、无凭据即可签出「假单号 + 假面单」并推进运单状态，必须默认关闭
    await assert.rejects(
      () => carrierSvc.create({ name: unique('审计承运商'), type: 'express', platformCode: 'mock', waybillEnabled: true }),
      (e) => { assert.equal(e.code, 'CARRIER_MOCK_NOT_ALLOWED'); assert.equal(e.statusCode, 400); return true },
    )
    // 显式开启（仅非生产）后放行，保证本地调试不受影响
    process.env.ALLOW_MOCK_CARRIER = '1'
    try {
      const created = await carrierSvc.create({ name: unique('审计承运商'), type: 'express', platformCode: 'mock', waybillEnabled: true })
      assert.ok(created?.id, '显式开启 ALLOW_MOCK_CARRIER 后应能创建 mock 承运商')
    } finally {
      delete process.env.ALLOW_MOCK_CARRIER
    }
  })

  test('★P2 承运商管理页不得成为绕过绑定页闸门的第二条写路径', async () => {
    const carrierSvc = require('../backend/src/modules/carriers/carriers.service')
    const base = { name: unique('审计承运商'), type: 'express' }
    // ① 顺丰/德邦的账号资料（月结账号、凭据引用、取号开关）必须拒绝——应走绑定页的
    //    revision CAS + 暂停前置 + 待处理运单 + canEnable 四道闸门。
    //    修复前：这个 create 会成功，月结账号和「已开通取号」被一次写进去。
    await assert.rejects(
      () => carrierSvc.create({ ...base, platformCode: 'sf', monthlyAccount: 'M001', waybillEnabled: true }),
      e => { assert.equal(e.code, 'CARRIER_ACCOUNT_FIELDS_MOVED'); assert.equal(e.statusCode, 400); return true },
    )
    // 只声明「这是顺丰」是允许的：绑定页需要 carrier 行先存在
    const created = await carrierSvc.create({ ...base, platformCode: 'sf' })
    await conn.query('UPDATE carriers SET monthly_account=?, credential_ref=?, waybill_enabled=1 WHERE id=?', ['M001', 'sf_main', created.id])
    await assert.rejects(
      () => carrierSvc.update(created.id, { ...base, monthlyAccount: 'M002', isActive: true }),
      e => { assert.equal(e.code, 'CARRIER_ACCOUNT_FIELDS_MOVED'); return true },
    )
    // ② 只改基本资料的 PUT 不得顺手把平台/账号/取号开关整块归零。
    //    修复前：normPlatform(未提交的平台字段)=全默认 → platform_code/monthly_account/credential_ref
    //    全变 NULL、waybill_enabled 变 0，等于静默解绑并暂停取号。
    await carrierSvc.update(created.id, { ...base, isActive: true })
    const [[kept]] = await conn.query('SELECT platform_code, monthly_account, credential_ref, waybill_enabled FROM carriers WHERE id=?', [created.id])
    assert.deepEqual([kept.platform_code, kept.monthly_account, kept.credential_ref, Number(kept.waybill_enabled)],
      ['sf', 'M001', 'sf_main', 1], '只改基本资料不得静默解绑并暂停取号')
    // ③ 换快递公司仍受共用闸门约束（启用中必须先暂停），且不得顺手清掉月结账号
    await assert.rejects(
      () => carrierSvc.update(created.id, { ...base, platformCode: 'kdniao', isActive: true }),
      e => { assert.equal(e.statusCode, 409); return true },
    )
    await conn.query('UPDATE carriers SET waybill_enabled=0 WHERE id=?', [created.id])
    await carrierSvc.update(created.id, { ...base, platformCode: 'kdniao', isActive: true })
    const [[switched]] = await conn.query('SELECT platform_code, monthly_account FROM carriers WHERE id=?', [created.id])
    assert.equal(switched.platform_code, 'kdniao')
    assert.equal(switched.monthly_account, 'M001', '换平台不得顺手清掉月结账号（解绑要走去绑定页）')
    // ④ 对照组：非直连平台（快递鸟）的高级入口必须保持可用，不能被一刀切收紧
    const kd = await carrierSvc.create({ name: unique('审计快递鸟'), type: 'express', platformCode: 'kdniao', credentialRef: 'KD_REF', monthlyAccount: 'KD001', waybillEnabled: true })
    const [[kdRow]] = await conn.query('SELECT platform_code, credential_ref, waybill_enabled FROM carriers WHERE id=?', [kd.id])
    assert.deepEqual([kdRow.platform_code, kdRow.credential_ref, Number(kdRow.waybill_enabled)], ['kdniao', 'KD_REF', 1])
    await carrierSvc.update(kd.id, { name: unique('审计快递鸟'), type: 'express', platformCode: 'kdniao', credentialRef: 'KD_REF2', waybillEnabled: true, isActive: true })
    const [[kdRow2]] = await conn.query('SELECT credential_ref, monthly_account, waybill_enabled FROM carriers WHERE id=?', [kd.id])
    assert.deepEqual([kdRow2.credential_ref, kdRow2.monthly_account, Number(kdRow2.waybill_enabled)], ['KD_REF2', 'KD001', 1])
  })

  test('★P2 呆滞处置单不得自行审批（approve 是库存注销的唯一闸门）', async f => {
    const disposalSvc = require('../backend/src/modules/disposal/disposal.service')
    const makerId = 990001
    const id = await insert(`INSERT INTO inventory_disposal_orders
      (disposal_no,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,?,'审计回归仓',2,?,'审计制单人')`, [unique('DP'), f.wh, makerId])

    // 制单人自己审批 → 必须 403（无 allow_self_approve 豁免时）
    await assert.rejects(
      () => disposalSvc.approve(id, { userId: makerId, realName: '审计制单人' }, null),
      (e) => { assert.equal(e.statusCode, 403); assert.equal(e.code, 'SELF_APPROVAL_DENIED'); return true },
    )
    // 换个人审批 → 放行
    await disposalSvc.approve(id, { userId: makerId + 1, realName: '审计审批人' }, null)
    const [[row]] = await conn.query('SELECT status FROM inventory_disposal_orders WHERE id=?', [id])
    assert.equal(Number(row.status), 3, '他人审批后应进入已批准(3)')

    // 驳回同样不得自审
    const id2 = await insert(`INSERT INTO inventory_disposal_orders
      (disposal_no,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,?,'审计回归仓',2,?,'审计制单人')`, [unique('DP'), f.wh, makerId])
    await assert.rejects(
      () => disposalSvc.reject(id2, { reason: '测试驳回', operator: { userId: makerId, realName: '审计制单人' } }, null),
      (e) => { assert.equal(e.code, 'SELF_APPROVAL_DENIED'); return true },
    )
  })

  test('★P2 软删后必须能用同一编码重建（active_unique_guard 由生成列推导）', async f => {
    const code = unique('LOC')
    const first = await insert(
      'INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [f.wh, code])

    // 活跃行仍然唯一：同码再建必须被拒
    await assert.rejects(
      () => conn.query('INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [f.wh, code]),
      (e) => { assert.equal(e.code, 'ER_DUP_ENTRY'); return true },
    )

    // 软删后 guard 必须自动变 NULL（修复前是普通列、恒定 1，仍占着编码）
    await conn.query('UPDATE warehouse_locations SET deleted_at=NOW() WHERE id=?', [first])
    const [[row]] = await conn.query('SELECT active_unique_guard FROM warehouse_locations WHERE id=?', [first])
    assert.equal(row.active_unique_guard, null, '软删行的 guard 必须由生成列推导为 NULL')

    // 因此同码可以重建（修复前这里会 ER_DUP_ENTRY，前端显示成「数据已存在，请勿重复提交」）
    const second = await insert(
      'INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [f.wh, code])
    assert.ok(second > 0, '软删后应能用同一编码重建库位')

    // 多条软删同码也允许（唯一键把 NULL 视为互不相同）
    await conn.query('UPDATE warehouse_locations SET deleted_at=NOW() WHERE id=?', [second])
    const third = await insert(
      'INSERT INTO warehouse_locations (warehouse_id,code,status) VALUES (?,?,1)', [f.wh, code])
    assert.ok(third > 0, '多条软删同码应共存')
  })

  test('★P2 商品/供应商编码：活跃唯一由生成列守护，软删后同码可重建', async () => {
    // 修复前两种库是两种错法（2026-09-18 审计 [16]，已在生产库核对过索引）：
    //   · 演化库/dev/生产：只有 uk_code(code, deleted_at)，对活跃行零约束 → 两条同码活跃行共存；
    //   · 新库/CI：只有 004 声明的裸唯一 uk_product_code(code) → 软删后同码再也建不回来。
    // 迁移 252 把两条血脉收敛成「生成列 + (code, active_unique_guard) 唯一键」。
    const pcode = unique('PCR')
    const first = await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price) VALUES (?,'审计同码商品','个',20,10)", [pcode])
    await assert.rejects(
      () => conn.query("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price) VALUES (?,'审计同码商品2','个',20,10)", [pcode]),
      e => { assert.equal(e.code, 'ER_DUP_ENTRY'); return true },
    )
    await conn.query('UPDATE product_items SET deleted_at=NOW() WHERE id=?', [first])
    const [[guarded]] = await conn.query('SELECT active_unique_guard FROM product_items WHERE id=?', [first])
    assert.equal(guarded.active_unique_guard, null, '软删行的 guard 必须由生成列推导为 NULL')
    assert.ok(await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price) VALUES (?,'审计同码商品重建','个',20,10)", [pcode]) > 0,
      '软删后必须能用同一编码重建商品（新库血脉修复前这里会 ER_DUP_ENTRY）')

    const scode = unique('SUP')
    const supplier = await insert("INSERT INTO supply_suppliers (code,name) VALUES (?,'审计同码供应商')", [scode])
    await assert.rejects(
      () => conn.query("INSERT INTO supply_suppliers (code,name) VALUES (?,'审计同码供应商2')", [scode]),
      e => { assert.equal(e.code, 'ER_DUP_ENTRY'); return true },
    )
    await conn.query('UPDATE supply_suppliers SET deleted_at=NOW() WHERE id=?', [supplier])
    assert.ok(await insert("INSERT INTO supply_suppliers (code,name) VALUES (?,'审计同码供应商重建')", [scode]) > 0)
  })

  test('★P0 新建商品必须真的能落库（占位符多一个 ? 曾让 POST /api/products 全线 500）', async () => {
    // 修 [16] 时顺手发现的**线上 P0**：products.service.create 的 INSERT 列了 19 列却写了 20 个 ?，
    // commit 34ef329「去序列化」漏删一个占位符 → 运行期 ER_PARSE_ERROR，新建商品全线不可用。
    // 现有冒烟测试都用裸 SQL 直插 product_items，没有一条走 service.create，所以一直没被发现。
    // 这条用例就是那个缺口：走真实 service 创建，断言落库成功且编码/名称正确。
    const categoryId = await insert("INSERT INTO product_categories (name) VALUES (?)", [unique('审计分类')])
    const name = unique('审计新建商品')
    const created = await prodSvc.create({ name, unit: '个', costPrice: 10, categoryId })
    assert.ok(created.id > 0, 'service.create 必须返回新商品 id（修复前这里直接 ER_PARSE_ERROR）')
    const [[row]] = await conn.query('SELECT code, name, unit FROM product_items WHERE id=?', [created.id])
    assert.equal(row.name, name)
    assert.equal(row.unit, '个')
    assert.match(String(row.code), /^P\d{6}$/, '商品编码由 generateMasterCode 生成')
    assert.equal(row.code, created.code)
  })

  test('★P2 销售退货的成本冲回只反转当初已确认的成本（1405/6401 必须严格对称）', async f => {
    // 修复前：出库凭证 buildSaleCogs 用 COALESCE(cost_snapshot, 0)，而退货凭证 buildSaleReturn 用
    // COALESCE(cost_snapshot, p.avg_cost, p.cost_price, 0)。cost_snapshot 为空时出库记 0、
    // 退货却按商品主档均值记一笔正数 → 1405/6401 两边不等，账被单边写歪（2026-09-18 审计 [36]）。
    // cost_snapshot 确实可能为空：warehouse-tasks.ship.js 只在能算出成本时才写入。
    const ve = require('../backend/src/modules/accounting/voucher-engine')
    const cust = await insert("INSERT INTO sale_customers (code,name) VALUES (?, '审计退货客户')", [unique('CUST')])
    const pcode = unique('P')
    // avg_cost=10 就是「回退主档」那条老路会读到的值，用来把不对称放大成可判定差异
    const productId = await insert(
      "INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,avg_cost) VALUES (?,'审计退货商品','个',20,12,10)", [pcode])

    async function shipSale({ snapshot, shipped }) {
      const orderNo = unique('SO')
      const saleId = await insert(`INSERT INTO sale_orders
        (order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
        VALUES (?,?,'审计退货客户',?,'审计回归仓',4,1,'测试')`, [orderNo, cust, f.wh])
      const itemId = await insert(`INSERT INTO sale_order_items
        (order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,quantity,shipped_qty,unit_price,amount,cost_snapshot)
        VALUES (?,?,'审计回归仓',?,?,'审计退货商品','个',?,?,20,?,?)`,
        [saleId, f.wh, productId, pcode, shipped, shipped, shipped * 20, snapshot])
      // buildSaleCogs 以「已落库的应收(payment_records.type=2)」为出库凭证的来源表
      await insert(`INSERT INTO payment_records
        (type,order_id,order_no,party_name,total_amount,paid_amount,balance,status,confirm_status)
        VALUES (2,?,?,'审计退货客户',?,0,?,1,1)`, [saleId, orderNo, shipped * 20, shipped * 20])
      return { saleId, itemId, orderNo }
    }
    async function returnOf({ itemId, qty }) {
      const returnId = await insert(`INSERT INTO sale_returns
        (return_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name,status)
        VALUES (?,?,'审计退货客户',?,'审计回归仓',1,'测试',3)`, [unique('SR'), cust, f.wh])
      const itemLine = await insert(`INSERT INTO sale_return_items
        (return_id,product_id,product_code,product_name,unit,quantity,sale_item_id,unit_price)
        VALUES (?,?,?,'审计退货商品','个',?,?,20)`, [returnId, productId, pcode, qty, itemId])
      const taskId = await insert(`INSERT INTO return_tasks
        (task_no,return_type,return_id,return_no,warehouse_id,status)
        VALUES (?,'sale',?,? ,? ,5)`, [unique('RT'), returnId, 'SR', f.wh])
      await insert(`INSERT INTO return_task_items
        (task_id,product_id,product_code,product_name,unit,return_item_id,checked_qty,rejected_qty)
        VALUES (?,?,?,'审计退货商品','个',?,?,0)`, [taskId, productId, pcode, itemLine, qty])
      return returnId
    }

    // ① 成本未知（cost_snapshot IS NULL）：出库结转 0，退货冲回也必须 0 —— 不得凭主档均价记账
    const unknown = await shipSale({ snapshot: null, shipped: 5 })
    const cogsSpecs = await ve.buildSaleCogs(conn)
    assert.equal(cogsSpecs.find(s => Number(s.sourceId) === unknown.saleId), undefined,
      'cost_snapshot 为空时出库成本为 0，不应生成成本结转凭证')
    const returnUnknown = await returnOf({ itemId: unknown.itemId, qty: 5 })
    const unknownSpec = (await ve.buildSaleReturn(conn)).find(s => Number(s.sourceId) === returnUnknown)
    const legsOf = (spec, code) => (spec?.legs || []).filter(l => l.code === code)
    const debit1405 = legsOf(unknownSpec, '1405').reduce((a, l) => a + Number(l.amount), 0)
    const credit6401 = legsOf(unknownSpec, '6401').reduce((a, l) => a + Number(l.amount), 0)
    assert.equal(debit1405, 0, '成本未知时必须冲回 0（修复前会按主档 avg_cost=10 记出 5×10=50）')
    assert.equal(credit6401, 0, '1405/6401 两边必须同时为 0，不能单边记账')

    // ② 成本已知（cost_snapshot=8）：退货冲回额 = 合格量 × 原出库快照，两侧严格相等
    const known = await shipSale({ snapshot: 8, shipped: 5 })
    const knownCogs = (await ve.buildSaleCogs(conn)).find(s => Number(s.sourceId) === known.saleId)
    assert.equal(legsOf(knownCogs, '6401').reduce((a, l) => a + Number(l.amount), 0), 40, '出库结转 = 5×8')
    const returnKnown = await returnOf({ itemId: known.itemId, qty: 3 })
    const knownSpec = (await ve.buildSaleReturn(conn)).find(s => Number(s.sourceId) === returnKnown)
    const d = legsOf(knownSpec, '1405').reduce((a, l) => a + Number(l.amount), 0)
    const c = legsOf(knownSpec, '6401').reduce((a, l) => a + Number(l.amount), 0)
    assert.equal(d, 24, '退货冲回 = 3×8（必须用原出库快照，不是退货时点的主档均值 3×10=30）')
    assert.equal(d, c, '1405 借方必须等于 6401 贷方')
  })

  test('★P3 采购结算凭证不得把来源错位的收货静默算成 0（会触发自动红冲）', async f => {
    // 修复前：毛额子查询只按 `poi.id = iti.purchase_item_id` JOIN，不校验来源归属。来源错位
    // （purchase_item_id 为空/指向别的单）时该行静默不参与求和 → 毛额 0 → 产出 0 金额凭证 →
    // upsertVoucher 的 PURCHASE_SETTLE 分支自动红冲，账面应付被写掉而 payment_records 仍在。
    const ve = require('../backend/src/modules/accounting/voucher-engine')
    const poId = await insert(`INSERT INTO purchase_orders
      (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,1,'审计供应商',?,'审计回归仓',2,1,'测试')`, [unique('PO'), f.wh])
    await insert(`INSERT INTO payment_records
      (type,order_id,order_no,party_name,total_amount,paid_amount,balance,status,confirm_status)
      VALUES (1,?,'审计采购','审计供应商',100,0,100,1,1)`, [poId])
    const taskId = await insert(`INSERT INTO inbound_tasks
      (task_no,purchase_order_id,purchase_order_no,warehouse_id,warehouse_name,status,audit_status,submitted_at)
      VALUES (?,?,'审计采购',?,'审计回归仓',4,1,NOW())`, [unique('IT'), poId, f.wh])
    // 来源干净：purchase_item_id 指向本单的采购明细 → 毛额 = 10×10 = 100
    const itemId = await insert(`INSERT INTO purchase_order_items
      (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
      VALUES (?,?,?,'审计回归','个',10,10,100)`, [poId, f.productId, f.code])
    await insert(`INSERT INTO inbound_task_items
      (task_id,purchase_order_id,purchase_item_id,product_id,product_code,product_name,unit,ordered_qty,received_qty,putaway_qty)
      VALUES (?,?,?,?,?,'审计回归','个',10,10,10)`, [taskId, poId, itemId, f.productId, f.code])
    const clean = (await ve.buildPurchaseSettle(conn, new Map())).find(s => Number(s.sourceId) === poId)
    assert.ok(clean, '来源完整的采购单必须产出结算凭证规格')
    assert.equal(clean.legs.filter(l => l.code === '2202').reduce((a, l) => a + Number(l.amount), 0), 100,
      '毛额 = 上架 10 × 采购价 10')

    // 来源错位：另一张单的收货明细把 purchase_item_id 置空（历史脏数据形态）
    const poId2 = await insert(`INSERT INTO purchase_orders
      (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
      VALUES (?,1,'审计供应商',?,'审计回归仓',2,1,'测试')`, [unique('PO'), f.wh])
    await insert(`INSERT INTO payment_records
      (type,order_id,order_no,party_name,total_amount,paid_amount,balance,status,confirm_status)
      VALUES (1,?,'审计采购2','审计供应商',100,0,100,1,1)`, [poId2])
    const taskId2 = await insert(`INSERT INTO inbound_tasks
      (task_no,purchase_order_id,purchase_order_no,warehouse_id,warehouse_name,status,audit_status,submitted_at)
      VALUES (?,?,'审计采购2',?,'审计回归仓',4,1,NOW())`, [unique('IT'), poId2, f.wh])
    await insert(`INSERT INTO inbound_task_items
      (task_id,purchase_order_id,purchase_item_id,product_id,product_code,product_name,unit,ordered_qty,received_qty,putaway_qty)
      VALUES (?,?,NULL,?,?,'审计回归','个',10,10,10)`, [taskId2, poId2, f.productId, f.code])
    await assert.rejects(
      () => ve.buildPurchaseSettle(conn, new Map()),
      e => { assert.equal(e.code, 'INBOUND_PURCHASE_SOURCE_INVALID'); assert.equal(e.statusCode, 409); return true },
      '来源错位必须报业务错误（修复前会静默产出毛额 0 的凭证并被自动红冲）',
    )
  })

  test('★P3 盘点扫码必须写幂等回执（此前 PDA 查 stockcheck.scan 恒为 not_found）', async f => {
    // 修复前：saveItemContainerScans **完全不写 operation_requests**，而 PDA 盘点页用
    // requestAction='stockcheck.scan' 查「上次提交到底成没成」→ 必然 not_found，只能靠
    // resolveServerState 兜底（2026-09-18 审计 [6] 残留）。现在按 stockcheck.scan.<盘点单ID>
    // 绑定单据，前端用基础 action 查时由 `<base>.%` 分支解析。
    const svc = require('../backend/src/modules/stockcheck/stockcheck.service')
    const { getScopedOperationRequestStatus } = require('../backend/src/utils/operationRequest')
    const containerId = await f.activeContainer(5)
    const [[container]] = await conn.query('SELECT barcode FROM inventory_containers WHERE id=?', [containerId])
    const checkId = await insert(`INSERT INTO inventory_checks
      (check_no,warehouse_id,warehouse_name,operator_id,operator_name,status)
      VALUES (?,?,'审计回归仓',1,'测试',1)`, [unique('SC'), f.wh])
    const itemId = await insert(`INSERT INTO inventory_check_items
      (check_id,product_id,product_code,product_name,unit,book_qty)
      VALUES (?,?,?,'审计回归','个',5)`, [checkId, f.productId, f.code])
    const key = unique('KEY')

    const first = await svc.saveItemContainerScans(checkId, itemId, [{ barcode: container.barcode, countedQty: 5 }], operator, null, key)
    assert.equal(first.scannedContainers, 1)
    const [[row]] = await conn.query(
      'SELECT action, resource_type, resource_id, status FROM operation_requests WHERE request_key=?', [key])
    assert.equal(row.action, `stockcheck.scan.${checkId}`, '动作用必须绑定盘点单 ID')
    assert.equal(row.resource_type, 'stockcheck')
    assert.equal(Number(row.resource_id), checkId)
    assert.equal(Number(row.status), 1, '扫码成功必须落成回执（status=1）')

    const receipt = await getScopedOperationRequestStatus({ requestKey: key, action: 'stockcheck.scan', userId: operator.userId })
    assert.equal(receipt.status, 'success', `PDA 用基础 action 必须查得到回执（修复前恒为 not_found），实际=${receipt.status}`)
    assert.equal(Number(receipt.data?.itemId), itemId)

    // 同键重放：返回同一份结果，不得重复写入
    const replay = await svc.saveItemContainerScans(checkId, itemId, [{ barcode: container.barcode, countedQty: 5 }], operator, null, key)
    assert.deepEqual(replay, first, '同请求键重放必须回放原结果')
  })

  test('★P3 创建类幂等：同一请求键换内容不得回放上一单的创建结果', async () => {
    // 修复前：sale.create / purchase.create / payment.receipt.create / carrier.createAccount /
    // 请购 / 采购计划 / 退货建单 都只有常量 action，而创建类动作在 begin 时刻没有单据 ID 可绑，
    // 于是同一个请求键被误用到**另一次内容不同**的创建上时，会直接回放第一次的成功回执（返回
    // 别单的 ID），调用方以为建成功了。现在 action 带**请求载荷指纹**：内容不同 → 不同作用域。
    const { pool } = require('../backend/src/config/db')   // 已被本文件的 harness 映射到 SAVEPOINT 连接
    const binding = require('../backend/src/modules/carriers/carriers.binding').createBindingService({ pool })
    const key = unique('KEY')
    const base = { name: '审计承运', platformCode: 'sf', monthlyAccount: 'ACC0001' }

    const first = await binding.create(base, { requestKey: key, userId: 2 })
    const [[row]] = await conn.query('SELECT action, resource_type, resource_id FROM operation_requests WHERE request_key=?', [key])
    assert.match(String(row.action), /^carrier\.createAccount\.[0-9a-f]{16}$/, '创建类动作必须带载荷指纹')
    assert.equal(row.resource_type, 'carrier')
    assert.equal(Number(row.resource_id), Number(first.id))

    const replay = await binding.create(base, { requestKey: key, userId: 2 })
    assert.equal(replay.id, first.id, '同键同内容必须回放原结果（幂等不能丢）')

    const second = await binding.create({ ...base, monthlyAccount: 'ACC0002' }, { requestKey: key, userId: 2 })
    assert.notEqual(second.id, first.id, '同键换内容必须真的新建，不能回放上一单结果（修复前返回的是第一单 id）')
  })

  test('★P2 track_status 只能有一个解释：1=已签收（导出曾读成「已揽收/在途」）', async f => {
    const logiSvc = require('../backend/src/modules/logistics/logistics.service')
    assert.equal(logiSvc.trackStatusLabel(0), '未签收')
    assert.equal(logiSvc.trackStatusLabel(1), '已签收')
    assert.equal(logiSvc.trackStatusLabel(null), '未签收', '空值按未签收处理，不能显示空白')
    assert.equal(logiSvc.trackStatusLabel(undefined), '未签收')
    // 导出必须复用同一映射，不得再写第二套解释。
    // 注意只匹配**代码形态**（三元表达式），不要把注释里对旧写法的引述也算违规。
    const exportSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../backend/src/modules/export/export.service.js'), 'utf8')
    assert.ok(!/w\.trackStatus\s*\?/.test(exportSrc), '导出不得再用三元表达式自行解释 trackStatus')
    assert.ok(/logisticsService\.trackStatusLabel\(/.test(exportSrc), '导出应复用 trackStatusLabel')
  })

  test('★P2 运费账单必须能按母子单号匹配运单，不能只匹配代表号', async f => {
    const freightSvc = require('../backend/src/modules/logistics/logistics.freight')
    const { saleId } = await f.saleOrder(1, f.wh)
    const carrierId = await insert(
      "INSERT INTO carriers (code,name,type) VALUES (?, '审计承运商', 'express')", [unique('CAR')])
    const tag = unique('WB')
    const repNo = `REP-${tag}`
    const childNo = `CHILD-${tag}`
    const wbId = await insert(
      `INSERT INTO logistics_waybills (waybill_no, sale_order_id, tracking_no, tracking_numbers, status)
       VALUES (?, ?, ?, ?, 3)`,
      [tag, saleId, repNo, JSON.stringify([repNo, childNo])])

    // 用**子单号**导入账单（承运商月结文件给的是各箱单号）
    await freightSvc.createFreightBill({ carrierId, trackingNo: childNo, actualFreight: 12.5 })
    const [[row]] = await conn.query(
      'SELECT waybill_id FROM logistics_freight_bills WHERE carrier_id=? AND tracking_no=?', [carrierId, childNo])
    assert.equal(Number(row.waybill_id), wbId,
      '子单号必须匹配到运单；否则 waybill_id 落 NULL，会被 generateSettlement 当成我方成本并入结算')

    // 代表号仍要能匹配（不能为了修子单号而弄坏原路径）
    await freightSvc.createFreightBill({ carrierId, trackingNo: repNo, actualFreight: 8 })
    const [[row2]] = await conn.query(
      'SELECT waybill_id FROM logistics_freight_bills WHERE carrier_id=? AND tracking_no=?', [carrierId, repNo])
    assert.equal(Number(row2.waybill_id), wbId, '代表号匹配必须保持可用')
  })

  test('★P3 打印机状态与 PDA 停用都不得绕过校验/事务（裸 SET status 收口）', async f => {
    const printerSvc = require('../backend/src/modules/printers/printers.service')
    const pdaSvc = require('../backend/src/modules/pda-devices/pda-devices.service')

    // ① 打印机：状态白名单。修复前 update() 用 `status ?? 1` 直写，任意值都能落库
    const printerId = await insert("INSERT INTO printers (code,name,type,status) VALUES (?, '审计打印机', 1, 1)", [unique('PRN')])
    await assert.rejects(
      () => printerSvc.update(printerId, { status: 7 }, null),
      e => { assert.equal(e.statusCode, 400); return true },
    )
    // ② 打印机：只传 status 的部分更新不得把 NOT NULL 的 code/type 写成 NULL（修复前 ER_BAD_NULL_ERROR 500）
    await printerSvc.update(printerId, { status: 0 }, null)
    const [[printer]] = await conn.query('SELECT code, type, status FROM printers WHERE id=?', [printerId])
    assert.equal(Number(printer.status), 0)
    assert.ok(printer.code, '部分更新必须沿用原 code（修复前会写成 NULL 直接 500）')
    assert.equal(Number(printer.type), 1)
    // ③ 停用 PDA 设备时「状态 + 吊销会话」必须同事务：吊销失败要整笔回滚
    const devId = await insert(
      "INSERT INTO pda_devices (device_code, secret_hash, device_name, warehouse_id) VALUES (?, 'x', '审计停用PDA', ?)",
      [unique('PDA'), f.wh])
    const sessionId = await insert(
      `INSERT INTO pda_device_sessions (device_id, user_id, session_token_hash, scopes, expires_at)
       VALUES (?, 1, ?, '[]', DATE_ADD(NOW(), INTERVAL 1 DAY))`, [devId, unique('TOK')])
    await pdaSvc.setStatus(devId, 'disabled', null)
    const [[dev]] = await conn.query('SELECT status FROM pda_devices WHERE id=?', [devId])
    const [[sess]] = await conn.query('SELECT revoked_at FROM pda_device_sessions WHERE id=?', [sessionId])
    assert.equal(dev.status, 'disabled')
    assert.ok(sess.revoked_at, '停用设备必须同时吊销会话')

    // ④ 故障注入：吊销失败 → 状态必须回滚（修复前状态先 autocommit 落地，设备已停用但票据仍有效）
    const devId2 = await insert(
      "INSERT INTO pda_devices (device_code, secret_hash, device_name, warehouse_id) VALUES (?, 'x', '审计停用PDA2', ?)",
      [unique('PDA'), f.wh])
    failNextSessionRevoke = true
    await assert.rejects(() => pdaSvc.setStatus(devId2, 'disabled', null), /注入的会话吊销失败/)
    const [[dev2]] = await conn.query('SELECT status FROM pda_devices WHERE id=?', [devId2])
    assert.equal(dev2.status, 'active', '吊销失败必须整笔回滚，不能留下「已停用但票据仍有效」')
  })

  test('★P2 PDA 改绑仓库必须与吊销旧会话同事务（吊销失败重试不得跳过吊销）', async f => {
    const pdaSvc = require('../backend/src/modules/pda-devices/pda-devices.service')
    const wh2 = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计二仓')", [unique('W')])
    const devId = await insert(
      "INSERT INTO pda_devices (device_code, secret_hash, device_name, warehouse_id) VALUES (?, 'x', '审计PDA', ?)",
      [unique('PDA'), f.wh])
    const mkSession = async () => insert(
      `INSERT INTO pda_device_sessions (device_id, user_id, session_token_hash, scopes, expires_at)
       VALUES (?, 1, ?, '[]', DATE_ADD(NOW(), INTERVAL 1 DAY))`, [devId, unique('TOK')])
    const deviceWh = async () => {
      const [[r]] = await conn.query('SELECT warehouse_id FROM pda_devices WHERE id=?', [devId])
      return Number(r.warehouse_id)
    }

    // ① 正常换仓：旧会话必须被吊销
    const s1 = await mkSession()
    await pdaSvc.update(devId, { warehouseId: wh2, scopeWarehouseIds: null })
    const [[r1]] = await conn.query('SELECT revoked_at FROM pda_device_sessions WHERE id=?', [s1])
    assert.ok(r1.revoked_at, '换仓后旧会话必须被吊销')
    assert.equal(await deviceWh(), wh2)

    // ② 同仓再改：不得误吊销会话
    const s2 = await mkSession()
    await pdaSvc.update(devId, { warehouseId: wh2, scopeWarehouseIds: null })
    const [[r2]] = await conn.query('SELECT revoked_at FROM pda_device_sessions WHERE id=?', [s2])
    assert.equal(r2.revoked_at, null, '仓库没变时不应吊销会话')

    // ③ 关键路径：吊销失败 → 整笔回滚（设备仓库也必须回到原值）
    //    修复前是「UPDATE 设备 autocommit 成功 → 吊销失败」，设备仓库已改；重试时
    //    current.warehouseId 已等于目标仓，判断「是否换仓」恒为 false，吊销被整段跳过。
    const s3 = await mkSession()
    failNextSessionRevoke = true
    await assert.rejects(
      () => pdaSvc.update(devId, { warehouseId: f.wh, scopeWarehouseIds: null }),
      /注入的会话吊销失败/,
    )
    assert.equal(await deviceWh(), wh2, '吊销失败必须整笔回滚，设备仓库不能已被改走')

    // ④ 重试：仍应识别为「换仓」并吊销
    await pdaSvc.update(devId, { warehouseId: f.wh, scopeWarehouseIds: null })
    const [[r3]] = await conn.query('SELECT revoked_at FROM pda_device_sessions WHERE id=?', [s3])
    assert.ok(r3.revoked_at, '重试必须仍然吊销会话——修复前这里会被跳过')
    assert.equal(await deviceWh(), f.wh)
  })

  let failed = 0
  try {
    for (const { name, run } of tests) {
      await conn.beginTransaction()
      try { await run(await fixture()); console.log('  [PASS]', name) }
      catch (error) { failed++; console.error('  [FAIL]', name, '\n', error.stack) }
      finally { await conn.rollback() }
    }
  } finally { await conn.end() }

  console.log('\n' + '═'.repeat(60))
  console.log(`  2026-09-18 审计 P0 回归: ${tests.length - failed} passed, ${failed} failed`)
  console.log('═'.repeat(60))
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
