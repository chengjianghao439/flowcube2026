const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const errorHandler    = require('./middleware/errorHandler')
const opLogger        = require('./middleware/opLogger')
const requestLogger   = require('./middleware/requestLogger')

// ─── 启动安全校验 ─────────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('安全配置错误：JWT_SECRET 未设置或长度不足 32 位，请检查 .env 文件')
}

const app = express()

// ─── 安全与解析中间件 ─────────────────────────────────────────────────────────

app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(requestLogger)
app.use(opLogger)

// ─── 健康检查 ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'FlowCube API is running', data: null })
})

// /api/health — PDA 网络状态检测（无需登录，高优先级）
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() })
})

// 打印客户端注册（无需登录，优先于 printers 模块路由）
app.post('/api/printers/register-client', async (req, res) => {
  try {
    const { pool } = require('./config/db')
    const { clientId, hostname, printers = [] } = req.body
    if (!clientId) return res.status(400).json({ success: false, message: 'clientId 必填' })

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || null

    // 持久化客户端到数据库
    await pool.query(
      `INSERT INTO print_clients (client_id, hostname, ip_address, last_seen, status)
       VALUES (?, ?, ?, NOW(), 1)
       ON DUPLICATE KEY UPDATE
         hostname    = VALUES(hostname),
         ip_address  = VALUES(ip_address),
         last_seen   = NOW(),
         status      = 1`,
      [clientId, hostname || clientId, ip]
    )

    // 自动创建或同步打印机
    for (const p of printers) {
      if (!p.code && !p.name) continue
      const code = (p.code || p.name.replace(/[^A-Z0-9]/gi, '_').toUpperCase()).slice(0, 50)
      const name = p.name || code
      const [[existing]] = await pool.query('SELECT id FROM printers WHERE code=?', [code])
      if (existing) {
        await pool.query(
          'UPDATE printers SET status=1, client_id=? WHERE id=?',
          [clientId, existing.id]
        )
      } else {
        await pool.query(
          'INSERT INTO printers (name, code, type, description, status, source, client_id) VALUES (?,?,1,?,1,?,?)',
          [name, code, `来自客户端 ${hostname || clientId}`, 'client', clientId]
        )
      }
    }

    console.log(`[打印客户端注册] clientId=${clientId} hostname=${hostname} ip=${ip}`)
    res.json({ success: true, data: { clientId, registeredAt: new Date().toISOString() } })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

// ─── 业务路由（按模块在此注册）────────────────────────────────────────────────

app.use('/api/auth',       require('./modules/auth/auth.routes'))
app.use('/api/users',      require('./modules/users/users.routes'))
app.use('/api/warehouses', require('./modules/warehouses/warehouses.routes'))
app.use('/api/suppliers',  require('./modules/suppliers/suppliers.routes'))
app.use('/api/products',   require('./modules/products/products.routes'))
app.use('/api/inventory',  require('./modules/inventory/inventory.routes'))
app.use('/api/customers',  require('./modules/customers/customers.routes'))
app.use('/api/carriers',   require('./modules/carriers/carriers.routes'))
app.use('/api/purchase',   require('./modules/purchase/purchase.routes'))
app.use('/api/sale',       require('./modules/sale/sale.routes'))
app.use('/api/stockcheck', require('./modules/stockcheck/stockcheck.routes'))
app.use('/api/dashboard',  require('./modules/dashboard/dashboard.routes'))
app.use('/api/settings',   require('./modules/settings/settings.routes'))
app.use('/api/roles',      require('./modules/roles/roles.routes'))
app.use('/api/reports',    require('./modules/reports/reports.routes'))
app.use('/api/export',     require('./modules/export/export.routes'))
app.use('/api/import',     require('./modules/import/import.routes'))
app.use('/api/transfer',   require('./modules/transfer/transfer.routes'))
app.use('/api/returns',    require('./modules/returns/returns.routes'))
app.use('/api/payments',   require('./modules/payments/payments.routes'))
app.use('/api/oplogs',         require('./modules/oplogs/oplogs.routes'))
app.use('/api/notifications',  require('./modules/notifications/notifications.routes'))
app.use('/api/search',         require('./modules/search/search.routes'))
app.use('/api/warehouse-tasks', require('./modules/warehouse-tasks/warehouse-tasks.routes'))
app.use('/api/price-lists',    require('./modules/price-lists/price-lists.routes'))
app.use('/api/system',        require('./modules/system/system.routes'))
app.use('/api/categories',    require('./modules/categories/categories.routes'))
app.use('/api/print-templates', require('./modules/print-templates/print-templates.routes'))
app.use('/api/printers',       require('./modules/printers/printers.routes'))
app.use('/api/print-jobs',     require('./modules/print-jobs/print-jobs.routes'))
app.use('/api/locations',       require('./modules/locations/locations.routes'))
app.use('/api/racks',           require('./modules/racks/racks.routes'))
app.use('/api/scan-logs',      require('./modules/scan-logs/scan-logs.routes'))
app.use('/api/inbound-tasks',  require('./modules/inbound-tasks/inbound-tasks.routes'))
app.use('/api/picking-waves',  require('./modules/picking-waves/picking-waves.routes'))
app.use('/api/packages',       require('./modules/packages/packages.routes'))
app.use('/api/sorting-bins',   require('./modules/sorting-bins/sorting-bins.routes'))
app.use('/api/pda',            require('./modules/pda/pda.routes'))
app.use('/api/printer-bindings', require('./modules/printer-bindings/printer-bindings.routes'))

// ─── 404 处理 ─────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在', data: null })
})

// ─── 全局错误处理（必须最后注册）─────────────────────────────────────────────

app.use(errorHandler)

module.exports = app
