'use strict'

const path = require('path')
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'))
const mysql = require(path.resolve(__dirname, '../../backend/node_modules/mysql2/promise'))

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env'), override: true })

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

function createHttpClient(baseUrl) {
  const fetch = globalThis.fetch
  if (!fetch) throw new Error('Node 18+ with global fetch is required')

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

    const res = await fetch(url, { method, headers, body, redirect: 'manual' })

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
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'flowcube',
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
  return http.post('/api/inbound-tasks/from-purchase', {
    token,
    json: { purchaseOrderId: purchaseId },
  })
}

function randomRef(prefix) {
  const hex = Math.random().toString(16).slice(2, 10)
  return `${prefix || 'SMOKE'}-${hex}`
}

async function prepareSmokeContext() {
  // 1. 跑迁移（runMigrations 自行管理数据库连接）
  try {
    const { runMigrations } = require('../../backend/src/database/migrate')
    await runMigrations()
  } catch (e) {
    console.warn('[smoke] migration warning:', e.message)
  }

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

  // printers 表无 deleted_at 列；type 为 TINYINT（1=标签）
  let [printers] = await pool.query("SELECT id, code, name, client_id FROM printers LIMIT 1")
  if (!printers.length) {
    const [r] = await pool.query("INSERT INTO printers (code, name, client_id, type, status) VALUES ('SMOKE-PRN', 'Smoke打印机', 'smoke-client-01', 1, 1)")
    printers = [{ id: r.insertId, code: 'SMOKE-PRN', name: 'Smoke打印机', client_id: 'smoke-client-01' }]
  }
  const printer = printers[0]
  // 测试用例以 camelCase 读取 clientId（DB 列为 client_id）
  printer.clientId = printer.clientId ?? printer.client_id

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
  const PORT = Number(process.env.TEST_API_PORT || 0) || 3100 + Math.floor(Math.random() * 1000)
  const app = require('../../backend/src/app')
  const server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${PORT}`
  const http = createHttpClient(baseUrl)

  // 6. 返回上下文
  const close = async () => {
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
