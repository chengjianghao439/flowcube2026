const express = require('express')
const path = require('path')
const fs = require('fs')
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
// Electron 桌面从 file:// 加载时 Origin 常为 null；CORS_ORIGIN=* 或 CORS_REFLECT=1 时回显请求 Origin
const corsOriginEnv = process.env.CORS_ORIGIN
const corsReflect = process.env.CORS_REFLECT === '1' || corsOriginEnv === '*'
app.use(cors({
  origin: corsReflect
    ? true
    : (corsOriginEnv || 'http://localhost:5173'),
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
app.use('/api/admin',         require('./modules/admin/admin.routes'))
app.use('/api/containers',     require('./modules/containers/containers.routes'))
app.use('/api/picking-waves',  require('./modules/picking-waves/picking-waves.routes'))
app.use('/api/packages',       require('./modules/packages/packages.routes'))
app.use('/api/sorting-bins',   require('./modules/sorting-bins/sorting-bins.routes'))
app.use('/api/pda',            require('./modules/pda/pda.routes'))
app.use('/api/printer-bindings', require('./modules/printer-bindings/printer-bindings.routes'))
app.use('/api/app-update',     require('./modules/app-update/app-update.routes'))

// ─── /downloads 静态资源（必须在所有 /api 之后、404 之前）────────────────────────
// express.static 对「目录 URL」无 index 时会 next()，若无下列路由会落到全局 404 →「接口不存在」
const downloadsPath = path.join(__dirname, '../downloads')
console.log('[Downloads] 📦 静态目录绝对路径:', downloadsPath)
if (!fs.existsSync(downloadsPath)) {
  fs.mkdirSync(downloadsPath, { recursive: true })
  console.log('[Downloads] ❌→✅ 目录不存在，已自动创建')
} else {
  console.log('[Downloads] ✅ downloads 目录存在')
}
try {
  const list = fs.readdirSync(downloadsPath)
  console.log('[Downloads] 📁 文件列表:', list.length ? list.join(', ') : '(空目录)')
} catch (e) {
  console.warn('[Downloads] 无法读取目录:', e.message)
}

app.get(/^\/downloads\/?$/, (req, res) => {
  try {
    const files = fs.readdirSync(downloadsPath).filter((n) => !n.startsWith('.'))
    res.set('Cache-Control', 'no-store')
    res.json({
      success: true,
      message: 'ok',
      data: { path: downloadsPath, files },
    })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message, data: null })
  }
})

app.use('/downloads', express.static(downloadsPath))

// ─── 404 处理 ─────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在', data: null })
})

// ─── 全局错误处理（必须最后注册）─────────────────────────────────────────────

app.use(errorHandler)

module.exports = app
