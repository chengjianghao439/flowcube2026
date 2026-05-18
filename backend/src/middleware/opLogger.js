const { pool } = require('../config/db')
const logger = require('../utils/logger')

const SENSITIVE_FIELDS = new Set([
  'password', 'newPassword', 'oldPassword', 'confirmPassword', 'currentPassword',
  'token', 'secret', 'apiKey', 'accessToken', 'refreshToken',
])

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body
  if (Array.isArray(body)) return body.map(sanitizeBody)
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE_FIELDS.has(k) ? '***' : (typeof v === 'object' && v !== null ? sanitizeBody(v) : v)
  }
  return out
}

const MODULE_MAP = {
  '/api/auth': 'auth', '/api/users': 'users', '/api/warehouses': 'warehouses',
  '/api/suppliers': 'suppliers', '/api/products': 'products', '/api/inventory': 'inventory',
  '/api/customers': 'customers', '/api/purchase': 'purchase', '/api/sale': 'sale',
  '/api/stockcheck': 'stockcheck', '/api/transfer': 'transfer', '/api/returns': 'returns',
  '/api/payments': 'payments', '/api/settings': 'settings',
  '/api/categories': 'categories', '/api/warehouse-tasks': 'warehouse-tasks',
  '/api/inbound-tasks': 'inbound-tasks', '/api/containers': 'containers',
  '/api/picking-waves': 'picking-waves', '/api/packages': 'packages',
  '/api/sorting-bins': 'sorting-bins', '/api/pda': 'pda',
  '/api/printer-bindings': 'printer-bindings', '/api/price-lists': 'price-lists',
  '/api/print-templates': 'print-templates', '/api/printers': 'printers',
  '/api/print-jobs': 'print-jobs', '/api/locations': 'locations',
  '/api/racks': 'racks', '/api/scan-logs': 'scan-logs',
  '/api/admin': 'admin', '/api/search': 'search',
  '/api/notifications': 'notifications', '/api/oplogs': 'oplogs',
  '/api/export': 'export', '/api/import': 'import',
  '/api/dashboard': 'dashboard', '/api/roles': 'roles',
  '/api/reports': 'reports', '/api/carriers': 'carriers',
  '/api/app-update': 'app-update',
}

function getModule(path) {
  for (const [prefix, mod] of Object.entries(MODULE_MAP)) {
    if (path.startsWith(prefix)) return mod
  }
  return 'system'
}

function opLogger(req, res, next) {
  if (req.method === 'GET') return next()

  const originalJson = res.json.bind(res)
  res.json = function (body) {
    setImmediate(async () => {
      try {
        const userId = req.user?.userId || null
        const userName = req.user?.username || req.user?.realName || null
        const safe = sanitizeBody(req.body)
        const bodyStr = safe && Object.keys(safe).length
          ? JSON.stringify(safe).substring(0, 500)
          : null
        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
        await pool.query(
          `INSERT INTO operation_logs (user_id,user_name,action,method,path,module,request_body,status_code,ip) VALUES (?,?,?,?,?,?,?,?,?)`,
          [userId, userName, `${req.method} ${req.path}`, req.method, req.path, getModule(req.path), bodyStr, res.statusCode, ip]
        )
      } catch (error) {
        logger.error('写入操作日志失败', error, { path: req.path, method: req.method }, 'OPLOG')
      }
    })
    return originalJson(body)
  }
  next()
}

module.exports = opLogger
