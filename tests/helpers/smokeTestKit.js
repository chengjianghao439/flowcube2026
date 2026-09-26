'use strict'

const path = require('path')
const { configureTestEnvironment, validateTestEnvironment } = require('./testEnvironment')
configureTestEnvironment()
const mysql = require(path.resolve(__dirname, '../../backend/node_modules/mysql2/promise'))

const { PERMISSIONS } = require('../../backend/src/constants/permissions')

function createLogger() {
  const counts = { passed: 0, failed: 0 }
  return {
    section(name) {
      const line = '─'.repeat(60)
      console.log(`\n${line}\n  ${name}\n${line}`)
    },
    assert(label, condition, detail) {
      if (condition) {
        counts.passed++
        console.log(`  [PASS] ${label}`)
      } else {
        counts.failed++
        console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`)
      }
    },
    summary() {
      console.log(`\n${'═'.repeat(60)}`)
      console.log(`  ${counts.passed} passed, ${counts.failed} failed`)
      console.log(`${'═'.repeat(60)}\n`)
      return counts
    },
  }
}

/**
 * 单个 HTTP 请求的超时（毫秒）。后端若在等行锁、连不上库或死循环，请求会一直不返回；
 * 没有这个上限，套件会静静地挂住，看日志只看到「最后一条日志之后什么都没有」。
 *
 * 默认 **不启用**（退出码/句柄问题修好后，正常套件不需要它）：这是可选能力，由套件在
 * prepareSmokeContext({ requestTimeoutMs }) 里显式要求。不要反过来在这里设全局默认值——
 * 那会一次性改变所有既有套件的等待语义，某个本来只是慢一点的请求会突然变成
 * AbortError 失败，把「测试变严格」和「代码有缺陷」混在一起。
 */
function createHttpClient(baseUrl, options = {}) {
  const fetch = globalThis.fetch
  if (!fetch) throw new Error('Node 18+ with global fetch is required')
  const timeoutMs = Number(options.timeoutMs) || 0

  async function request(method, p, opts = {}) {
    const url = `${baseUrl}${p}`
    const headers = { ...opts.headers }
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`

    let body = undefined
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.formData !== undefined) {
      body = opts.formData
    }

    // 单请求超时（可选）：某一步挂住时（后端等锁、连不上库）要明确失败并指出是哪个请求，
    // 而不是让整个套件无限等待、把「等待」误当成「通过」。
    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    })

    let data
    if (opts.expectBinary) {
      data = Buffer.from(await res.arrayBuffer())
    } else {
      const text = await res.text()
      try { data = JSON.parse(text) } catch { data = text }
    }

    return { status: res.status, data, ok: res.status >= 200 && res.status < 300 }
  }

  return {
    get: (p, opts) => request('GET', p, opts),
    post: (p, opts) => request('POST', p, opts),
    put: (p, opts) => request('PUT', p, opts),
    delete: (p, opts) => request('DELETE', p, opts),
  }
}

function createDbPool() {
  return mysql.createPool({
    ...validateTestEnvironment(),
    waitForConnections: true,
    connectionLimit: 5,
    timezone: '+08:00',
    charset: 'utf8mb4',
  })
}

async function dbQuery(pool, sql, params) {
  const [rows] = await pool.query(sql, params || [])
  return rows
}

async function login(http, username, password) {
  const response = await http.post('/api/auth/login', { json: { username, password } })
  return { response, token: response.data?.data?.token || null, user: response.data?.data?.user || null }
}

async function createPurchaseOrder(http, token, { supplier, warehouse, product, quantity }) {
  return http.post('/api/purchase', {
    token,
    json: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      items: [{
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity: quantity || 1,
        unitPrice: 10,
      }],
    },
  })
}

async function confirmPurchaseOrder(http, token, purchaseId) {
  return http.post(`/api/purchase/${purchaseId}/confirm`, { token })
}

async function createInboundTaskFromPurchase(http, token, purchaseId) {
  return http.post('/api/inbound-tasks', {
    token,
    json: { poId: purchaseId },
  })
}

function randomRef(prefix) {
  const hex = Math.random().toString(16).slice(2, 10)
  return `${prefix || 'SMOKE'}-${hex}`
}

async function prepareSmokeContext(options = {}) {
  validateTestEnvironment()
  // 1. 跑迁移（runMigrations 自行管理数据库连接）
  const { runMigrations } = require('../../backend/src/database/migrate')
  await runMigrations()

  // 2. 建测试用连接池
  const pool = createDbPool()

  // 3. 确保基础数据
  let [warehouses] = await pool.query('SELECT id, name FROM inventory_warehouses WHERE deleted_at IS NULL LIMIT 1')
  if (!warehouses.length) {
    const [r] = await pool.query("INSERT INTO inventory_warehouses (name, code) VALUES ('Smoke仓库', 'SMOKE-WH')")
    warehouses = [{ id: r.insertId, name: 'Smoke仓库' }]
  }
  const warehouse = warehouses[0]

  let [locations] = await pool.query('SELECT id, code FROM warehouse_locations WHERE warehouse_id=? AND deleted_at IS NULL LIMIT 1', [warehouse.id])
  if (!locations.length) {
    const [r] = await pool.query("INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES (?, 'A-01', 'Smoke库位')", [warehouse.id])
    locations = [{ id: r.insertId, code: 'A-01' }]
  }
  const location = locations[0]

  let [products] = await pool.query("SELECT id, code, name, unit FROM product_items WHERE deleted_at IS NULL LIMIT 1")
  if (!products.length) {
    const [r] = await pool.query("INSERT INTO product_items (code, name, unit, sale_price_a) VALUES ('SMOKE-P001', 'Smoke商品', '个', 10)")
    products = [{ id: r.insertId, code: 'SMOKE-P001', name: 'Smoke商品', unit: '个' }]
  }
  const product = products[0]

  let [suppliers] = await pool.query('SELECT id, name FROM supply_suppliers WHERE deleted_at IS NULL LIMIT 1')
  if (!suppliers.length) {
    const [r] = await pool.query("INSERT INTO supply_suppliers (code, name) VALUES ('SMOKE-SUP', 'Smoke供应商')")
    suppliers = [{ id: r.insertId, name: 'Smoke供应商' }]
  }
  const supplier = suppliers[0]

  let [customers] = await pool.query('SELECT id, name FROM sale_customers WHERE deleted_at IS NULL LIMIT 1')
  if (!customers.length) {
    const [r] = await pool.query("INSERT INTO sale_customers (code, name) VALUES ('SMOKE-CUS', 'Smoke客户')")
    customers = [{ id: r.insertId, name: 'Smoke客户' }]
  }
  const customer = customers[0]
  // 授信额度统一清空（NULL = 不校验），由需要它的用例自己设置。
  // 2026-09-18 实测：某个用例题把该客户额度改成 1 后不还原，配上长期累积的残留销售单
  // （当时 541 张、在途敞口 17192），导致 p0 / concurrency-guards / sale-adjustment /
  // warehouse-scope 等 **5 个套件集体全红**，而错误信息全指向「客户授信额度不足」，
  // 与真实缺陷极难区分。每个套件从这里拿到确定的起点，测试之间不再互相污染。
  await pool.query('UPDATE sale_customers SET credit_limit = NULL WHERE id = ?', [customer.id])

  // printers 表无 deleted_at 列；type 为 TINYINT（1=标签）。
  // 不能像其它 fixture 一样 `LIMIT 1` 瞎捞——开发库里可能已有真实注册但未绑定
  // client_id 的打印机（排序更靠前），claim-client 需要 clientId，捞错行会导致测试永远失败。
  // 用固定 code 做幂等 upsert，保证拿到的一定是这台专属 smoke 打印机。
  await pool.query(
    `INSERT INTO printers (code, name, client_id, type, status)
       VALUES ('SMOKE-PRN', 'Smoke打印机', 'smoke-client-01', 1, 1)
     ON DUPLICATE KEY UPDATE client_id = VALUES(client_id), status = 1`,
  )
  const [[printer]] = await pool.query("SELECT id, code, name, client_id FROM printers WHERE code = 'SMOKE-PRN'")
  // 测试用例以 camelCase 读取 clientId（DB 列为 client_id）
  printer.clientId = printer.client_id
  // SMOKE-PRN 是所有并发 smoke 会话共用的固定打印机（见上方注释：用固定 code 幂等
  // upsert 换确定性）。claim-client 是按 (priority DESC, id ASC) 的 FIFO 队列，如果之前
  // 某次运行（本会话崩溃、其它并发 worktree 会话的 mainline 测试等）留下了没被认领的
  // 「待打印」(status=0) 残留任务，会一直堆在队首，把本次新建的任务挤到 limit 之外，
  // 导致 claim-client 返回的列表里找不到自己刚建的任务。这里只清同一台 SMOKE-PRN
  // 专属测试打印机下"待打印"状态的任务——不会碰到任何真实打印机，也不会打断正在
  // 打印(status=1)或已完成(2/3)的任务。
  await pool.query('DELETE FROM print_jobs WHERE printer_id = ? AND status = 0', [printer.id])

  // 4. 确保测试角色和用户
  const bcrypt = require(path.resolve(__dirname, '../../backend/node_modules/bcryptjs'))
  const ADMIN_PW = bcrypt.hashSync('SmokeAdmin123!', 10)
  const LIMITED_PW = bcrypt.hashSync('SmokeLimited123!', 10)

  // smoke_admin 直接挂内置管理员角色（role_id=1）。permissionMiddleware 对 role 1 放行，
  // 无需依赖任何权限点字典表（系统采用 sys_role_permissions.permission 字符串，无 sys_permissions 表）。
  // role 1 由 066_seed_sys_roles.sql 植入。
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES ('smoke_admin', ?, 'Smoke管理员', 1, '管理员', 1)
       ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=1, role_name='管理员', is_active=1, deleted_at=NULL`,
    [ADMIN_PW],
  )

  // smoke_limited 用独立受限角色，仅授予「入库单查看 + 仪表盘查看」两个权限点（直接写字符串到 sys_role_permissions.permission）。
  let [limitedRoles] = await pool.query("SELECT id FROM sys_roles WHERE code='smoke_limited' LIMIT 1")
  let limitedRoleId
  if (!limitedRoles.length) {
    const [r] = await pool.query("INSERT INTO sys_roles (name, code, remark, is_system) VALUES ('Smoke受限', 'smoke_limited', 'smoke test limited role', 0)")
    limitedRoleId = r.insertId
  } else {
    limitedRoleId = limitedRoles[0].id
  }
  for (const code of [PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.DASHBOARD_VIEW]) {
    await pool.query(
      'INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
      [limitedRoleId, code],
    )
  }
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES ('smoke_limited', ?, 'Smoke受限', ?, 'Smoke受限', 1)
       ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=VALUES(role_id), role_name='Smoke受限', is_active=1, deleted_at=NULL`,
    [LIMITED_PW, limitedRoleId],
  )

  const [[adminUser]] = await pool.query("SELECT id FROM sys_users WHERE username='smoke_admin' LIMIT 1")
  const adminUserId = adminUser?.id || 1

  // 4b. PDA 设备 + 会话。收货/上架接口现在强制 PDA 设备会话（pdaSessionRequired + pdaOnly），
  // 测试需携带 X-Client: pda 与 X-PDA-Session 头才能执行 receive/putaway。
  const PDA_DEVICE_CODE = 'SMOKE-PDA-01'
  const PDA_DEVICE_SECRET = 'smoke-pda-secret'
  await pool.query(
    `INSERT INTO pda_devices (device_code, device_name, warehouse_id, status, secret_hash)
       VALUES (?, 'Smoke PDA', ?, 'active', ?)
     ON DUPLICATE KEY UPDATE status='active', secret_hash=VALUES(secret_hash), warehouse_id=VALUES(warehouse_id)`,
    [PDA_DEVICE_CODE, warehouse.id, bcrypt.hashSync(PDA_DEVICE_SECRET, 10)],
  )
  const { createSession } = require('../../backend/src/modules/pda/pda.sessions.service')
  const pdaSession = await createSession({
    deviceCode: PDA_DEVICE_CODE,
    deviceSecret: PDA_DEVICE_SECRET,
    userId: adminUserId,
  })
  const pdaSessionToken = pdaSession.sessionToken

  // 5. 启动 Express 服务
  // 端口交给 OS 分配（listen(0)）并显式绑定回环 IPv4，不要自己挑端口范围：
  // 原实现是 `3100 + Math.floor(Math.random() * 1000)`，而该范围**包含 3306**——
  // CI 的 MySQL 就监听 3306，随机命中时直接 `EADDRINUSE: address already in use :::3306`
  // （2026-09-18 实测，概率约 1/1000，表现为「偶发」失败，且失败步骤每次都不同）。
  // 不指定 host 还会让服务可能只绑到 IPv6 `::`，而 baseUrl 固定走 127.0.0.1，
  // 非 dual-stack 环境下表现为 `TypeError: fetch failed`（同日另一次失败即此形态）。
  // 其余 smoke 套件一直是 `app.listen(0, '127.0.0.1')`，这里与它们对齐。
  // 另外补 error 监听：端口异常要明确失败，不能让 Promise 永久挂起到超时。
  const requestedPort = Number(process.env.TEST_API_PORT || 0)
  const app = require('../../backend/src/app')
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(requestedPort > 0 ? requestedPort : 0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const http = createHttpClient(baseUrl, { timeoutMs: options.requestTimeoutMs })

  // 6. 返回上下文
  // closeAllConnections 必须在 close 之前：Node 18+ 的 fetch（undici）默认 keep-alive，
  // 连接会空闲地留着，server.close() 会一直等它们断开。
  //
  // close() 只管本函数自建的 pool。app/service 共用的 backend/src/config/db 全局单例 pool
  // **不在这里关**——它同样是 mysql2 连接、socket 不 unref，不关进程会吊着不退，
  // 但收尾由需要它的套件在自己的 finally 里显式写：
  //     await require('../backend/src/config/db').pool.end()
  // 这是既有套件的惯例（多数套件已经这么写了）。放进共享 helper 会让只关自建池的旧套件
  // 变成关两次、把断言全绿拖成退出码 1；改写 pool.end 成 no-op 更糟——那会污染导出的
  // 单例对象，并让后续真正该失败的生命周期错误静默通过。
  const close = async () => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await pool.end()
  }

  // PDA 收货/上架请求需要的请求头（X-Client + X-PDA-Session）
  const pdaHeaders = (extra = {}) => ({ 'X-Client': 'pda', 'X-PDA-Session': pdaSessionToken, ...extra })

  return { pool, http, baseUrl, warehouse, location, product, supplier, customer, printer, pdaSessionToken, pdaHeaders, close }
}

module.exports = {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
  randomRef,
  PERMISSIONS,
}
