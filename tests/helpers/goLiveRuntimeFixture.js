'use strict'

// Authoring this file does not start anything. The root-owned runner alone calls setup().
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./testEnvironment')
const { assertOwnedRepairInstance } = require('./repairInstanceOwnership')
const { PERMISSIONS: P } = require('../../backend/src/constants/permissions')

const DATABASE = 'flowcube_golive20261006_test'
const permissions = [
  P.PRODUCT_VIEW, P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_CONFIRM,
  P.INBOUND_ORDER_VIEW, P.INBOUND_ORDER_CREATE, P.INBOUND_ORDER_SUBMIT,
  P.INBOUND_RECEIVE_EXECUTE, P.INBOUND_PUTAWAY_EXECUTE,
  P.SALE_ORDER_VIEW, P.SALE_ORDER_CREATE, P.SALE_ORDER_UPDATE, P.SALE_ORDER_RESERVE,
  P.SALE_ORDER_RELEASE, P.SALE_ORDER_SHIP, P.SALE_ORDER_CANCEL,
  P.RETURN_ORDER_VIEW, P.RETURN_ORDER_CREATE, P.RETURN_ORDER_CONFIRM, P.RETURN_ORDER_CANCEL,
  P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_CREATE,
  P.INVENTORY_DISPOSAL_APPROVE, P.INVENTORY_DISPOSAL_EXECUTE,
  P.WAREHOUSE_TASK_VIEW, P.WAREHOUSE_TASK_ASSIGN, P.WAREHOUSE_TASK_PICK,
  P.WAREHOUSE_TASK_CHECK, P.WAREHOUSE_TASK_SORT, P.WAREHOUSE_TASK_CHECK_DONE,
  P.WAREHOUSE_TASK_PACK, P.WAREHOUSE_TASK_PACK_DONE, P.WAREHOUSE_TASK_SHIP,
  P.WAREHOUSE_TASK_CANCEL_RETURN, P.WAREHOUSE_TASK_CANCEL_RETURN_VIEW,
  P.SCAN_LOG_CREATE, P.SCAN_LOG_VIEW,
  P.PAYMENT_VIEW, P.PAYMENT_EXECUTE, P.PAYMENT_CONFIRM,
  P.FINANCE_ACCOUNT_VIEW, P.FINANCE_ACCOUNT_CREATE,
  P.SUPPLIER_REFUND_VIEW, P.SUPPLIER_REFUND_CREATE, P.SUPPLIER_REFUND_CONFIRM, P.SUPPLIER_REFUND_RECEIVE,
  P.FINANCE_PERIOD_BACKFILL, P.FINANCE_PERIOD_BACKFILL_APPROVE,
  P.ACCOUNTING_VOUCHER_VIEW, P.ACCOUNTING_VOUCHER_MANAGE,
  P.PRINT_PRINTER_VIEW, P.PRINT_PRINTER_MANAGE, P.PRINT_CLIENT_CONSUME, P.PRINT_JOB_VIEW,
]

function requireRuntimeEnvironment() {
  configureTestEnvironment()
  const config = validateTestEnvironment()
  assert.equal(config.database, DATABASE, '[SETUP] 本脚本只接受本轮专属数据库')
  assert.equal(config.host, '127.0.0.1', '[SETUP] 本轮容器端口须明确映射到IPv4回环')
  assert.ok(![3306, 3307].includes(config.port), '[SETUP] 禁止共享实例端口')
  for (const name of ['FLOWCUBE_REPAIR_INSTANCE_FILE', 'FLOWCUBE_REPAIR_DOCKER_CONTEXT', 'APP_UPDATE_DOWNLOADS_DIR', 'JWT_SECRET']) {
    assert.ok(process.env[name], `[SETUP] 缺少根runner注入的 ${name}`)
  }
  assert.ok(process.env.JWT_SECRET.length >= 32, '[SETUP] 临时JWT密钥必须符合实际app配置')
  assert.ok(path.isAbsolute(process.env.APP_UPDATE_DOWNLOADS_DIR), '[SETUP] 更新目录必须是根指定的绝对路径')
  fs.accessSync(process.env.APP_UPDATE_DOWNLOADS_DIR, fs.constants.W_OK)
  assert.ok(permissions.every(value => typeof value === 'string'), '[SETUP] 夹具权限名必须取现有常量')
  // No server.js/scheduler/waybill/dingtalk worker is imported. No external log transport.
  process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
  process.env.SENTRY_DSN = ''
  process.env.LOKI_URL = ''
  return config
}

function must(response, label = 'API动作', kind = 'BUSINESS') {
  assert.ok(response.status >= 200 && response.status < 300 && response.data?.success === true,
    `[${kind}] ${label}: HTTP ${response.status}, code=${response.data?.code ?? ''}, message=${response.data?.message ?? ''}`)
  return response.data.data
}

// Independent fixed-point comparison; no production budget/projection helper computes expectations.
function units4(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(value))
  assert.ok(match, `四位金额事实不合法: ${String(value)}`)
  const amount = BigInt(match[2]) * 10000n + BigInt((match[3] || '').padEnd(4, '0'))
  return match[1] ? -amount : amount
}
function text4(value) {
  const amount = units4(value)
  const positive = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}${positive / 10000n}.${String(positive % 10000n).padStart(4, '0')}`
}

function makeGoLiveRuntimeFixture() {
  const mark = `GL${randomBytes(4).toString('hex')}`
  const owned = { products: [], purchases: [], inbounds: [], sales: [], returns: [], disposals: [], sources: [], refunds: [], backfills: [] }
  const ctx = { mark, owned, ownership: null, pool: null, apiPool: null, server: null, print: null, deviceId: null, users: {} }
  ctx.rows = async (sql, args = []) => (await ctx.pool.query(sql, args))[0]
  ctx.one = async (sql, args = []) => (await ctx.rows(sql, args))[0]
  const insert = async (sql, args) => Number((await ctx.pool.query(sql, args))[0].insertId)
  ctx.remember = (name, id) => { assert.ok(Number.isSafeInteger(Number(id)) && Number(id) > 0, `[FIXTURE] ${name}未返回准确ID`); owned[name].push(Number(id)); return Number(id) }

  ctx.request = async (method, route, body, { user = 'creator', key = randomUUID(), pda = false, headers = {} } = {}) => {
    const base = `http://127.0.0.1:${ctx.server.address().port}`
    const token = user ? ctx.users[user]?.token : null
    if (user) assert.ok(token, `[SETUP] 未登录夹具身份 ${user}`)
    const response = await fetch(`${base}${route.startsWith('/api/') ? route : `/api${route}`}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(45000),
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': ctx.clientId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(method !== 'GET' ? { 'X-Request-Key': key } : {}),
        ...(pda ? ctx.pdaHeaders : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json()
    return { status: response.status, data, ok: response.ok }
  }
  ctx.get = (route, options) => ctx.request('GET', route, undefined, options)
  ctx.post = (route, body = {}, options) => ctx.request('POST', route, body, options)
  ctx.put = (route, body = {}, options) => ctx.request('PUT', route, body, options)
  ctx.ok = async (method, route, body, options, kind = 'BUSINESS') => must(await ctx.request(method, route, body, options), `${method} ${route}`, kind)

  ctx.setup = async () => {
    const config = requireRuntimeEnvironment()
    const mysql = require('../../backend/node_modules/mysql2/promise')
    ctx.pool = mysql.createPool({ ...config, timezone: '+08:00', dateStrings: true, connectionLimit: 4, connectTimeout: 10000 })
    const conn = await ctx.pool.getConnection()
    try {
      // The actual guard performs live Docker/volume/runner/@@server_uuid probes; no injected probes.
      ctx.ownership = await assertOwnedRepairInstance(conn, { config })
      const [[target]] = await conn.query('SELECT DATABASE() AS db')
      assert.equal(target.db, DATABASE, '[SETUP] 实际连接数据库不符')
    } finally { conn.release() }
    // Nothing above this line writes any row or imports the app.
    assert.ok(await ctx.one('SELECT id FROM acct_companies WHERE id=1'), '[SETUP] 根必须先完整迁移临时库')
    const bcrypt = require('../../backend/node_modules/bcryptjs')
    ctx.clientId = `golive-${mark}`
    ctx.today = (await ctx.one("SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+08:00'),'%Y-%m-%d') AS day")).day
    const historicalPeriods = new Set((await ctx.rows("SELECT period FROM acct_periods WHERE company_id=1 AND period BETWEEN '199001' AND '199012'")).map(row => row.period))
    const historicalMonth = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).find(month => !historicalPeriods.has(`1990${month}`))
    assert.ok(historicalMonth, '[FIXTURE] 1990年没有未存在的历史期间，不能覆盖旧期间')
    ctx.historicalFixture = { period: `1990${historicalMonth}`, date: `1990-${historicalMonth}-15` }
    ctx.warehouse = { id: await insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [mark, `验收合成仓-${mark}`]), name: `验收合成仓-${mark}` }
    ctx.otherWarehouse = { id: await insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [`${mark}X`, `验收他仓-${mark}`]) }
    ctx.location = { id: await insert('INSERT INTO warehouse_locations(warehouse_id,code,name) VALUES (?,?,?)', [ctx.warehouse.id, mark, mark]) }
    await ctx.pool.query('INSERT INTO sorting_bins(warehouse_id,code) VALUES (?,?)', [ctx.warehouse.id, `${mark}S`])
    ctx.supplier = { id: await insert('INSERT INTO supply_suppliers(code,name,settlement_type,payment_terms_days) VALUES (?,?,2,30)', [mark, `验收合成供应商-${mark}`]), name: `验收合成供应商-${mark}` }
    ctx.customer = { id: await insert('INSERT INTO sale_customers(code,name,credit_limit,settlement_type) VALUES (?,?,NULL,2)', [mark, `验收合成客户-${mark}`]), name: `验收合成客户-${mark}` }
    for (const name of ['creator', 'approver', 'denied', 'scoped']) {
      const roleId = await insert('INSERT INTO sys_roles(code,name,is_system) VALUES (?,?,0)', [`${mark}-${name}`, `${mark}-${name}`])
      const granted = name === 'denied' ? [P.INVENTORY_DISPOSAL_VIEW, P.SUPPLIER_REFUND_VIEW] : permissions
      if (granted.length) await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES ?', [granted.map(permission => [roleId, permission])])
      // Optional runner-provided synthetic password supports a later GUI trial; never emitted.
      const password = process.env.FLOWCUBE_GOLIVE_TEST_PASSWORD || randomBytes(24).toString('base64url')
      const username = `${mark}-${name}`
      const id = await insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active,allow_self_approve) VALUES (?,?,?,?,?,1,0)',
        [username, await bcrypt.hash(password, 10), `${mark}-${name}`, roleId, `${mark}-${name}`])
      await ctx.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [id, name === 'scoped' ? ctx.otherWarehouse.id : ctx.warehouse.id])
      ctx.users[name] = { id, username, roleId, password }
    }
    const deviceCode = `${mark}-PDA`, deviceSecret = randomBytes(24).toString('base64url')
    ctx.deviceId = await insert("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)", [deviceCode, mark, ctx.warehouse.id, await bcrypt.hash(deviceSecret, 10)])
    ctx.apiPool = require('../../backend/src/config/db').pool
    const app = require('../../backend/src/app')
    ctx.server = await new Promise((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server))
      server.once('error', reject)
    })
    for (const user of Object.values(ctx.users)) {
      const response = await ctx.request('POST', '/auth/login', { username: user.username, password: user.password }, { user: null })
      assert.equal(response.status, 200, '[SETUP] 合成员工真实登录失败')
      assert.ok(response.data?.data?.token, '[SETUP] 真实登录没有访问票据')
      user.token = response.data.data.token
      delete user.password
    }
    const device = await ctx.ok('POST', '/pda/sessions', { device_code: deviceCode, device_secret: deviceSecret }, {}, 'SETUP')
    assert.equal(Number(device.warehouse_id), ctx.warehouse.id)
    ctx.pdaHeaders = { 'X-Client': 'pda', 'X-PDA-Session': device.session_token }
    ctx.payer = await ctx.ok('POST', '/finance/accounts', { name: `${mark}付款账户`, type: 1, openingBalance: 10000 }, {}, 'FIXTURE')
    ctx.income = await ctx.ok('POST', '/finance/accounts', { name: `${mark}退款账户`, type: 1, openingBalance: 0 }, {}, 'FIXTURE')
    // Reuse the reviewed existing owned printing fixture. It only uses this local HTTP server.
    const adapt = method => (route, opts = {}) => ctx.request(method, route, opts.json, { headers: opts.headers })
    ctx.printHttp = { get: adapt('GET'), post: adapt('POST'), put: adapt('PUT'), delete: adapt('DELETE') }
    ctx.print = await require('./ownedPrintFixture').acquireOwnPackageLabelPrinter({ http: ctx.printHttp, token: ctx.users.creator.token, warehouseId: ctx.warehouse.id, assert, randomRef: () => mark + randomBytes(3).toString('hex') })
    ctx.print.code = (await ctx.ok('GET', `/printers/${ctx.print.printerId}`)).code
    await ctx.ok('POST', '/printers/client-heartbeat', { hostname: mark }, { headers: ctx.print.headers }, 'FIXTURE')
  }

  ctx.product = async () => {
    const code = `${mark}P${owned.products.length}`
    const id = await insert("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',20,10,1)", [code, code])
    ctx.remember('products', id)
    return { id, code, name: code, unit: '个' }
  }
  ctx.purchase = async ({ quantity = 10, price = 10, packages = [quantity], product } = {}) => {
    product ||= await ctx.product()
    assert.equal(packages.reduce((sum, qty) => sum + qty, 0), quantity, '[FIXTURE] 收货箱量必须等于采购基本量')
    const po = await ctx.ok('POST', '/purchase', { supplierId: ctx.supplier.id, supplierName: ctx.supplier.name, warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name,
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity, unitPrice: price }] }, {}, 'FIXTURE')
    ctx.remember('purchases', po.id)
    await ctx.ok('POST', `/purchase/${po.id}/confirm`, {}, {}, 'FIXTURE')
    const item = await ctx.one('SELECT * FROM purchase_order_items WHERE order_id=?', [po.id])
    assert.ok(item, '[FIXTURE] 采购API未保存准确行')
    const inbound = await ctx.ok('POST', '/inbound-tasks', { poId: po.id }, {}, 'FIXTURE')
    ctx.remember('inbounds', inbound.taskId)
    await ctx.ok('POST', `/inbound-tasks/${inbound.taskId}/submit`, {}, {}, 'FIXTURE')
    const received = await ctx.ok('POST', `/inbound-tasks/${inbound.taskId}/receive`, { productId: product.id, packages: packages.map(qty => ({ qty })) }, { pda: true }, 'FIXTURE')
    assert.equal(received.containers.length, packages.length, '[FIXTURE] 真实收货箱身份不完整')
    for (const container of received.containers) await ctx.ok('POST', `/inbound-tasks/${inbound.taskId}/putaway`, { containerId: container.containerId, locationId: ctx.location.id }, { pda: true }, 'FIXTURE')
    const ap = await ctx.one('SELECT * FROM payment_records WHERE type=1 AND order_id=?', [po.id])
    assert.ok(ap, '[FIXTURE] 上架完成没有原应付')
    await ctx.ok('POST', `/payments/${ap.id}/confirm`, {}, { user: 'approver' }, 'FIXTURE')
    return { ...po, product, itemId: Number(item.id), price, quantity, taskId: inbound.taskId, containers: received.containers, apId: Number(ap.id) }
  }
  ctx.prBody = (purchase, quantity, extra = {}) => ({ supplierId: ctx.supplier.id, supplierName: ctx.supplier.name, warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name,
    purchaseOrderId: purchase.id, purchaseOrderNo: purchase.orderNo,
    items: [{ sourceItemId: purchase.itemId, productId: purchase.product.id, productCode: purchase.product.code, productName: purchase.product.name, unit: purchase.product.unit, quantity, unitPrice: purchase.price }], ...extra })
  ctx.returnPurchase = async (purchase, quantity, extra = {}) => {
    const pr = await ctx.ok('POST', '/returns/purchase', ctx.prBody(purchase, quantity, extra))
    ctx.remember('returns', pr.id)
    return pr
  }
  ctx.saleBody = (product, quantity, extra = {}) => ({ customerId: ctx.customer.id, customerName: ctx.customer.name, warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name,
    items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity, unitPrice: 20 }], ...extra })
  ctx.stock = async productId => {
    const row = await ctx.one(`SELECT (SELECT COALESCE(SUM(remaining_qty),0) FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL) AS active,
      (SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?) AS cached`, [productId, ctx.warehouse.id, productId, ctx.warehouse.id])
    assert.equal(Number(row.active), Number(row.cached), '[BUSINESS] ACTIVE容器余量与库存缓存不一致')
    return Number(row.active)
  }
  ctx.shipTask = async (taskId, container) => {
    const task = await ctx.ok('GET', `/warehouse-tasks/${taskId}`)
    assert.equal(task.items.length, 1, '[FIXTURE] 本轮出库限定准确单行')
    const item = task.items[0]
    assert.equal(Number(container.containerId), Number((await ctx.one('SELECT id FROM inventory_containers WHERE id=? AND warehouse_id=?', [container.containerId, ctx.warehouse.id]))?.id))
    await ctx.ok('POST', '/scan-logs', { taskId, itemId: Number(item.id), containerId: container.containerId, barcode: container.containerCode, productId: Number(item.productId), qty: Number(item.requiredQty), scanMode: '整件' }, { pda: true })
    await ctx.ok('PUT', `/warehouse-tasks/${taskId}/ready`, {}, { pda: true })
    if (task.taskType === 'sale_out') {
      const bin = await ctx.one('SELECT sorting_bin_id,sorting_bin_code FROM warehouse_tasks WHERE id=?', [taskId])
      if (!bin.sorting_bin_id) await ctx.ok('POST', `/warehouse-tasks/${taskId}/assign-sorting-bin`, {})
      const current = await ctx.one('SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?', [taskId])
      await ctx.ok('PUT', `/warehouse-tasks/${taskId}/sort-done`, { items: [{ itemId: Number(item.id), sortedQty: Number(item.requiredQty), binCode: current.sorting_bin_code }] }, { pda: true })
      await ctx.ok('POST', '/scan-logs/check', { taskId, barcode: container.containerCode }, { pda: true })
      const checked = await ctx.one('SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
      if (Number(checked.status) === 4) await ctx.ok('PUT', `/warehouse-tasks/${taskId}/check-done`, {}, { pda: true })
      const pkg = await ctx.ok('POST', '/packages', { warehouseTaskId: taskId }, { pda: true })
      await ctx.ok('POST', `/packages/${pkg.id}/add-item`, { productCode: item.productCode, qty: Number(item.requiredQty) }, { pda: true })
      await ctx.ok('PUT', `/packages/${pkg.id}/finish`, {}, { pda: true })
      // Automated workstation ACK proves the API gate only, never physical paper output.
      for (let attempt = 0; attempt < 5; attempt++) {
        const claimed = await ctx.ok('POST', '/print-jobs/claim-client', { limit: 100 }, { headers: ctx.print.headers })
        const jobs = Array.isArray(claimed) ? claimed : claimed.jobs
        assert.ok(Array.isArray(jobs), '[BUSINESS] 打印领取必须返回有限任务列表')
        if (!jobs.length) break
        for (const job of jobs) {
          const ownedJob = await ctx.one('SELECT printer_id,warehouse_id FROM print_jobs WHERE id=?', [job.id])
          assert.equal(Number(ownedJob.printer_id), ctx.print.printerId, '[BUSINESS] 只确认本批自建打印机任务')
          await ctx.ok('POST', `/print-jobs/${job.id}/complete-client`, { ackToken: job.ackToken }, { headers: ctx.print.headers })
        }
      }
      await ctx.ok('PUT', `/warehouse-tasks/${taskId}/pack-done`, {}, { pda: true })
    }
    const key = randomUUID()
    const ack = await ctx.ok('PUT', `/warehouse-tasks/${taskId}/ship`, {}, { pda: true, key })
    assert.deepEqual(await ctx.ok('PUT', `/warehouse-tasks/${taskId}/ship`, {}, { pda: true, key }), ack, '[BUSINESS] 出库原键回执变化')
    assert.equal(Number((await ctx.one('SELECT status FROM warehouse_tasks WHERE id=?', [taskId])).status), 7)
    return ack
  }

  ctx.close = async () => {
    const errors = []
    const attempt = async fn => { try { await fn() } catch (error) { errors.push(error) } }
    if (ctx.print && ctx.server?.listening) await attempt(() => require('./ownedPrintFixture').releaseOwnPackageLabelPrinter(ctx.print, { http: ctx.printHttp, token: ctx.users.creator.token, assert }))
    if (ctx.server) await attempt(async () => {
      ctx.server.closeAllConnections?.()
      await new Promise((resolve, reject) => ctx.server.close(error => error ? reject(error) : resolve()))
      assert.equal(ctx.server.listening, false, '[CLEANUP] 本批API仍在监听')
    })
    if (ctx.ownership && ctx.deviceId) await attempt(async () => {
      await ctx.pool.query('DELETE FROM pda_device_sessions WHERE device_id=?', [ctx.deviceId])
      await ctx.pool.query('DELETE FROM pda_devices WHERE id=?', [ctx.deviceId])
      assert.equal((await ctx.rows('SELECT id FROM pda_devices WHERE id=?', [ctx.deviceId])).length, 0)
    })
    if (ctx.ownership && ctx.closedPeriodCleanup) await attempt(async () => {
      const own = ctx.closedPeriodCleanup
      assert.ok(typeof own.closedAt === 'string' && own.closedAt.length > 0, '[CLEANUP] 本次历史期间缺非空结账时间，保留元数据拒绝删除')
      const row = await ctx.one('SELECT company_id,period,status,closed_by,closed_by_name,closed_at FROM acct_periods WHERE company_id=? AND period=?', [own.companyId, own.period])
      assert.deepEqual(row && { companyId: Number(row.company_id), period: row.period, status: Number(row.status), closedBy: Number(row.closed_by), closedByName: row.closed_by_name, closedAt: row.closed_at },
        { ...own, status: 2 }, '[CLEANUP] 本次历史期间身份已变化，保留元数据拒绝删除')
      const [deleted] = await ctx.pool.query('DELETE FROM acct_periods WHERE company_id=? AND period=? AND status=2 AND closed_by=? AND closed_by_name=? AND closed_at=?', [own.companyId, own.period, own.closedBy, own.closedByName, own.closedAt])
      assert.equal(deleted.affectedRows, 1, '[CLEANUP] 本次历史期间元数据未精确删除')
      assert.equal(await ctx.one('SELECT period FROM acct_periods WHERE company_id=? AND period=?', [own.companyId, own.period]), undefined)
    })
    // API and assertion pools are different instances; both are closed even if prior cleanup fails.
    if (ctx.apiPool) await attempt(() => ctx.apiPool.end())
    if (ctx.pool) await attempt(() => ctx.pool.end())
    console.log('[go-live-runtime-fixtures]', JSON.stringify({ mark, database: DATABASE, warehouseId: ctx.warehouse?.id, supplierId: ctx.supplier?.id, customerId: ctx.customer?.id,
      users: Object.fromEntries(Object.entries(ctx.users).map(([key, user]) => [key, { id: user.id, username: user.username }])), historicalFixture: ctx.historicalFixture, owned }))
    if (errors.length) throw new AggregateError(errors, '[CLEANUP] 本批API/连接/精确PDA资源收尾失败')
  }
  return ctx
}

module.exports = { makeGoLiveRuntimeFixture, must, units4, text4, DATABASE }
