const { pool } = require('../config/db')

const MODULE_MAP = {
  '/api/auth': 'auth', '/api/users': 'users', '/api/warehouses': 'warehouses',
  '/api/suppliers': 'suppliers', '/api/products': 'products', '/api/inventory': 'inventory',
  '/api/customers': 'customers', '/api/purchase': 'purchase', '/api/sale': 'sale',
  '/api/stockcheck': 'stockcheck', '/api/transfer': 'transfer', '/api/returns': 'returns',
  '/api/payments': 'payments', '/api/settings': 'settings',
  '/api/categories': 'categories',
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
        const userName = req.user?.username || null
        const bodyStr = req.body && Object.keys(req.body).length
          ? JSON.stringify(req.body).substring(0, 500)
          : null
        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
        await pool.query(
          `INSERT INTO operation_logs (user_id,user_name,method,path,module,request_body,status_code,ip) VALUES (?,?,?,?,?,?,?,?)`,
          [userId, userName, req.method, req.path, getModule(req.path), bodyStr, res.statusCode, ip]
        )
      } catch (_) {}
    })
    return originalJson(body)
  }
  next()
}

module.exports = opLogger
