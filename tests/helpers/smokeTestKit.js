'use strict'

const path = require('path')
const crypto = require('crypto')

require(path.resolve(__dirname, '../../backend/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../backend/.env'),
  override: true,
})

const app = require('../../backend/src/app')
const { runMigrations } = require('../../backend/src/database/migrate')
const { PERMISSIONS } = require('../../backend/src/constants/permissions')
const mysql = require(path.resolve(__dirname, '../../backend/node_modules/mysql2/promise'))
const bcrypt = require(path.resolve(__dirname, '../../backend/node_modules/bcryptjs'))

function createLogger() {
  const state = { passed: 0, failed: 0 }

  function line(message = '') {
    process.stdout.write(`${message}\n`)
  }

  function section(title) {
    line(`\n=== ${title} ===`)
  }

  function pass(label) {
    state.passed += 1
    line(`  PASS ${label}`)
  }

  function fail(label, detail) {
    state.failed += 1
    line(`  FAIL ${label}`)
    if (detail) line(`       -> ${detail}`)
  }

  function assert(label, condition, detail = '') {
    if (condition) pass(label)
    else fail(label, detail)
  }

  function summary() {
    line(`\n=== SUMMARY ===`)
    line(`passed=${state.passed} failed=${state.failed}`)
    return { ...state }
  }

  return { state, line, section, pass, fail, assert, summary }
}

async function startAppServer() {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法解析测试服务监听端口')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    server,
    baseUrl,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    }),
  }
}

function createHttpClient(baseUrl) {
  async function request(method, pathname, { token, headers, json, formData, expectBinary = false } = {}) {
    const requestHeaders = { ...(headers || {}) }
    let body
    if (token) requestHeaders.Authorization = `Bearer ${token}`
    if (json !== undefined) {
      requestHeaders['Content-Type'] = 'application/json'
      body = JSON.stringify(json)
    } else if (formData) {
      body = formData
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: requestHeaders,
      body,
    })

    const contentType = response.headers.get('content-type') || ''
    let data = null
    if (expectBinary) {
      data = Buffer.from(await response.arrayBuffer())
    } else if (contentType.includes('application/json')) {
      data = await response.json()
    } else {
      data = Buffer.from(await response.arrayBuffer())
    }

    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      data,
    }
  }

  return {
    get: (pathname, options) => request('GET', pathname, options),
    post: (pathname, options) => request('POST', pathname, options),
    put: (pathname, options) => request('PUT', pathname, options),
    del: (pathname, options) => request('DELETE', pathname, options),
  }
}

async function createDbPool() {
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

async function dbQuery(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params)
  return rows
}

async function ensureRole(pool, { code, name, permissions }) {
  const rows = await dbQuery(pool, 'SELECT id FROM sys_roles WHERE code=? LIMIT 1', [code])
  let roleId = rows[0]?.id
  if (!roleId) {
    const [result] = await pool.query(
      'INSERT INTO sys_roles (code, name, remark, is_system) VALUES (?,?,?,0)',
      [code, name, 'smoke test role'],
    )
    roleId = result.insertId
  } else {
    await pool.query('UPDATE sys_roles SET name=? WHERE id=?', [name, roleId])
  }

  await pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
  for (const permission of permissions) {
    await pool.query(
      'INSERT INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
      [roleId, permission],
    )
  }

  return Number(roleId)
}

async function ensureUser(pool, { username, realName, password, roleId, roleName }) {
  const passwordHash = await bcrypt.hash(password, 10)
  const rows = await dbQuery(pool, 'SELECT id FROM sys_users WHERE username=? AND deleted_at IS NULL LIMIT 1', [username])
  if (rows[0]?.id) {
    await pool.query(
      'UPDATE sys_users SET password=?, real_name=?, role_id=?, role_name=?, is_active=1 WHERE id=?',
      [passwordHash, realName, roleId, roleName, rows[0].id],
    )
    return Number(rows[0].id)
  }

  const [result] = await pool.query(
    'INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active) VALUES (?,?,?,?,?,1)',
    [username, passwordHash, realName, roleId, roleName],
  )
  return Number(result.insertId)
}

async function ensureWarehouse(pool) {
  const rows = await dbQuery(pool, 'SELECT id, code, name FROM inventory_warehouses WHERE deleted_at IS NULL AND is_active=1 ORDER BY id ASC LIMIT 1')
  if (rows[0]) return rows[0]
  const code = `SMKWH${Date.now().toString().slice(-6)}`
  const [result] = await pool.query(
    'INSERT INTO inventory_warehouses (code, name, type, is_active) VALUES (?,?,1,1)',
    [code, 'Smoke测试仓'],
  )
  return { id: Number(result.insertId), code, name: 'Smoke测试仓' }
}

async function ensureLocation(pool, warehouseId) {
  const rows = await dbQuery(
    pool,
    'SELECT id, code, name, warehouse_id FROM warehouse_locations WHERE warehouse_id=? AND deleted_at IS NULL AND status=1 ORDER BY id ASC LIMIT 1',
    [warehouseId],
  )
  if (rows[0]) return rows[0]
  const suffix = Date.now().toString().slice(-6)
  const code = `SMK-${suffix}`
  const [result] = await pool.query(
    `INSERT INTO warehouse_locations
      (warehouse_id, code, barcode, zone, aisle, rack, level, position, name, capacity, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
    [warehouseId, code, `R${suffix}`, 'S', '01', '01', '01', '01', 'Smoke库位', 0],
  )
  return { id: Number(result.insertId), code, name: 'Smoke库位', warehouse_id: warehouseId }
}

async function ensureProduct(pool) {
  const rows = await dbQuery(pool, 'SELECT id, code, name, unit FROM product_items WHERE deleted_at IS NULL AND is_active=1 ORDER BY id ASC LIMIT 1')
  if (rows[0]) return rows[0]
  const code = `SMKSKU${Date.now().toString().slice(-6)}`
  const [result] = await pool.query(
    `INSERT INTO product_items
      (code, name, unit, cost_price, sale_price, is_active)
     VALUES (?,?,?,?,?,1)`,
    [code, 'Smoke测试商品', '个', 10, 12],
  )
  return { id: Number(result.insertId), code, name: 'Smoke测试商品', unit: '个' }
}

async function ensureSupplier(pool) {
  const rows = await dbQuery(pool, 'SELECT id, code, name FROM supply_suppliers WHERE deleted_at IS NULL AND is_active=1 ORDER BY id ASC LIMIT 1')
  if (rows[0]) return rows[0]
  const code = `SMKSUP${Date.now().toString().slice(-6)}`
  const [result] = await pool.query(
    'INSERT INTO supply_suppliers (code, name, is_active) VALUES (?,?,1)',
    [code, 'Smoke测试供应商'],
  )
  return { id: Number(result.insertId), code, name: 'Smoke测试供应商' }
}

async function ensureCustomer(pool) {
  const rows = await dbQuery(pool, 'SELECT id, code, name FROM sale_customers WHERE deleted_at IS NULL AND is_active=1 ORDER BY id ASC LIMIT 1')
  if (rows[0]) return rows[0]
  const code = `SMKCUS${Date.now().toString().slice(-6)}`
  const [result] = await pool.query(
    'INSERT INTO sale_customers (code, name, is_active) VALUES (?,?,1)',
    [code, 'Smoke测试客户'],
  )
  return { id: Number(result.insertId), code, name: 'Smoke测试客户' }
}

async function ensurePrinter(pool, warehouseId) {
  const suffix = Date.now().toString().slice(-6)
  const clientId = `smoke-client-${suffix}`
  const printerCode = `SMOKE_P_${suffix}`

  const [result] = await pool.query(
    `INSERT INTO printers
      (name, code, type, label_raw_format, warehouse_id, description, status, source, client_id)
     VALUES (?,?,?,?,?,?,1,?,?)`,
    ['Smoke测试打印机', printerCode, 1, 'zpl', warehouseId, 'smoke test printer', 'client', clientId],
  )
  return { id: Number(result.insertId), code: printerCode, clientId }
}

async function login(http, username, password) {
  const response = await http.post('/api/auth/login', {
    json: { username, password },
  })
  return {
    response,
    token: response.data?.data?.token || '',
    user: response.data?.data?.user || null,
  }
}

async function createPurchaseOrder(http, token, { supplier, warehouse, product, quantity }) {
  const response = await http.post('/api/purchase', {
    token,
    json: {
      supplierId: Number(supplier.id),
      supplierName: supplier.name,
      warehouseId: Number(warehouse.id),
      warehouseName: warehouse.name,
      expectedDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      remark: 'Smoke purchase',
      items: [
        {
          productId: Number(product.id),
          productCode: product.code,
          productName: product.name,
          unit: product.unit,
          quantity,
          unitPrice: 10,
        },
      ],
    },
  })
  return response
}

async function confirmPurchaseOrder(http, token, purchaseOrderId) {
  return http.post(`/api/purchase/${purchaseOrderId}/confirm`, { token })
}

async function createInboundTaskFromPurchase(http, token, purchaseOrderId) {
  return http.post('/api/inbound-tasks', {
    token,
    json: { poId: purchaseOrderId },
  })
}

async function prepareSmokeContext() {
  await runMigrations()
  const pool = await createDbPool()
  const warehouse = await ensureWarehouse(pool)
  const location = await ensureLocation(pool, Number(warehouse.id))
  const product = await ensureProduct(pool)
  const supplier = await ensureSupplier(pool)
  const customer = await ensureCustomer(pool)
  const printer = await ensurePrinter(pool, Number(warehouse.id))

  const limitedRoleId = await ensureRole(pool, {
    code: 'smoke_limited',
    name: 'Smoke受限角色',
    permissions: [PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.DASHBOARD_VIEW],
  })

  await ensureUser(pool, {
    username: 'smoke_admin',
    realName: 'Smoke 管理员',
    password: 'SmokeAdmin123!',
    roleId: 1,
    roleName: '管理员',
  })
  await ensureUser(pool, {
    username: 'smoke_limited',
    realName: 'Smoke 受限用户',
    password: 'SmokeLimited123!',
    roleId: limitedRoleId,
    roleName: 'Smoke受限角色',
  })

  const server = await startAppServer()
  const http = createHttpClient(server.baseUrl)

  return {
    pool,
    http,
    baseUrl: server.baseUrl,
    warehouse,
    location,
    product,
    supplier,
    customer,
    printer,
    close: async () => {
      await server.close()
      await pool.end()
    },
  }
}

function randomRef(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`
}

module.exports = {
  PERMISSIONS,
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
  randomRef,
}
