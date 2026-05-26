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
    const [r] = await pool.query("INSERT INTO supply_suppliers (name) VALUES ('Smoke供应商')")
    suppliers = [{ id: r.insertId, name: 'Smoke供应商' }]
  }
  const supplier = suppliers[0]

  let [customers] = await pool.query('SELECT id, name FROM sale_customers WHERE deleted_at IS NULL LIMIT 1')
  if (!customers.length) {
    const [r] = await pool.query("INSERT INTO sale_customers (name) VALUES ('Smoke客户')")
    customers = [{ id: r.insertId, name: 'Smoke客户' }]
  }
  const customer = customers[0]

  let [printers] = await pool.query("SELECT id, code, name, client_id FROM printers WHERE deleted_at IS NULL LIMIT 1")
  if (!printers.length) {
    const [r] = await pool.query("INSERT INTO printers (code, name, client_id, type, status) VALUES ('SMOKE-PRN', 'Smoke打印机', 'smoke-client-01', 'label', 1)")
    printers = [{ id: r.insertId, code: 'SMOKE-PRN', name: 'Smoke打印机', client_id: 'smoke-client-01' }]
  }
  const printer = printers[0]

  // 4. 确保测试角色和用户
  const bcrypt = require(path.resolve(__dirname, '../../backend/node_modules/bcryptjs'))
  const ADMIN_PW = bcrypt.hashSync('SmokeAdmin123!', 10)

  let [roles] = await pool.query("SELECT id FROM sys_roles WHERE code='smoke_admin' LIMIT 1")
  let adminRoleId
  if (!roles.length) {
    const [r] = await pool.query("INSERT INTO sys_roles (name, code, remark, is_system) VALUES ('Smoke管理员', 'smoke_admin', 'smoke test admin role', 0)")
    adminRoleId = r.insertId
    // 赋予所有权限
    const [perms] = await pool.query('SELECT id FROM sys_permissions')
    for (const p of perms) {
      await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission_id) VALUES (?,?)', [adminRoleId, p.id])
    }
  } else {
    adminRoleId = roles[0].id
  }

  let [limitedRoles] = await pool.query("SELECT id FROM sys_roles WHERE code='smoke_limited' LIMIT 1")
  let limitedRoleId
  if (!limitedRoles.length) {
    const [r] = await pool.query("INSERT INTO sys_roles (name, code, remark, is_system) VALUES ('Smoke受限', 'smoke_limited', 'smoke test limited role', 0)")
    limitedRoleId = r.insertId
    // 只赋予 inbound-tasks 和 dashboard 查看权限
    const permCodes = ['inbound.view', 'dashboard.view']
    const [perms] = await pool.query('SELECT id, code FROM sys_permissions WHERE code IN (?,?)', permCodes)
    for (const p of perms) {
      await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission_id) VALUES (?,?)', [limitedRoleId, p.id])
    }
  } else {
    limitedRoleId = limitedRoles[0].id
  }

  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES ('smoke_admin', ?, 'Smoke管理员', ?, 'Smoke管理员', 1)
       ON DUPLICATE KEY UPDATE role_id=VALUES(role_id), is_active=1`,
    [ADMIN_PW, adminRoleId],
  )
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES ('smoke_limited', ?, 'Smoke受限', ?, 'Smoke受限', 1)
       ON DUPLICATE KEY UPDATE role_id=VALUES(role_id), is_active=1`,
    [ADMIN_PW, limitedRoleId],
  )

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

  return { pool, http, baseUrl, warehouse, location, product, supplier, customer, printer, close }
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
