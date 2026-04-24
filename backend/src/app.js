const express = require('express')
const path = require('path')
const fs = require('fs')
const cors = require('cors')
const helmet = require('helmet')
const errorHandler    = require('./middleware/errorHandler')
const opLogger        = require('./middleware/opLogger')
const requestLogger   = require('./middleware/requestLogger')
const { env } = require('./config/env')
const { successResponse } = require('./utils/response')

// ─── 启动安全校验 ─────────────────────────────────────────────────────────────

const app = express()

// 统一声明 JSON 输出为 UTF-8，避免部分客户端按本地代码页误解析中文
app.set('json charset', 'utf-8')

// 位于 Nginx / 负载均衡后时开启，否则 req.protocol 多为 http，拼出的安装包下载地址会变成 http://，
// 公网若仅开放 443，Windows 客户端更新下载会失败（0.3.x 等旧版依赖接口返回的可访问 URL）。
if (env.TRUST_PROXY) {
  app.set('trust proxy', 1)
}

const isProd = env.IS_PROD

// ─── 安全与解析中间件 ─────────────────────────────────────────────────────────
// 本地 http://127.0.0.1 开发时，Helmet 默认 CSP 含 upgrade-insecure-requests，浏览器会把
// http 整页导航升级为 https，本地无证书则显示「无法访问」；curl 不受 CSP 影响故仍能访问。
app.use(
  helmet(
    isProd
      ? {}
      : {
          contentSecurityPolicy: {
            directives: {
              upgradeInsecureRequests: null,
            },
          },
          strictTransportSecurity: false,
        },
  ),
)
// Electron 桌面请求常见 Origin: null；仅配 CORS_ORIGIN=http://localhost:5173 会拒绝桌面端
const corsOriginEnv = env.CORS_ORIGIN
const corsReflect = env.CORS_REFLECT || corsOriginEnv === '*'
const allowNullOrigin =
  corsReflect ||
  corsOriginEnv === '*' ||
  env.CORS_ALLOW_NULL_ORIGIN
const staticAllowed = corsOriginEnv || (!isProd ? 'http://localhost:5173' : '')
app.use(cors({
  origin: corsReflect
    ? true
    : (origin, callback) => {
        if (!origin) {
          return callback(null, allowNullOrigin)
        }
        if (staticAllowed && origin === staticAllowed) {
          return callback(null, true)
        }
        return callback(null, false)
      },
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(requestLogger)
app.use(opLogger)

// ─── 健康检查 ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  return successResponse(res, null, '极序 Flow API is running')
})

// /api/health — PDA 网络状态检测（无需登录，高优先级）
app.get('/api/health', (req, res) => {
  return successResponse(res, { status: 'ok', timestamp: new Date().toISOString() }, 'ok')
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

// ─── 桌面端安装包静态资源（必须在所有 /api 之后、404 之前）────────────────────────
// express.static 对「目录 URL」无 index 时会 next()，若无下列路由会落到全局 404 →「接口不存在」
const downloadsPath = env.APP_UPDATE_DOWNLOADS_DIR
const versionsPath = path.join(downloadsPath, 'versions')
const currentPath = path.join(downloadsPath, 'current')
console.log('[Downloads] 📦 权威静态目录绝对路径:', downloadsPath)
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

function logDeprecatedDownloadsAccess(req) {
  console.warn('[Downloads] DEPRECATED /downloads alias accessed; use /versions/ or /current/ for new clients.', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  })
}

function deprecatedDownloadsOnly(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Allow', 'GET, HEAD')
    return res.status(405).json({
      success: false,
      message: '/downloads 已废弃，仅保留 GET/HEAD 静态兼容访问',
      data: null,
    })
  }
  logDeprecatedDownloadsAccess(req)
  res.set('Warning', '299 FlowCube "/downloads is deprecated; use /versions or /current"')
  res.set('X-FlowCube-Deprecated-Alias', '/downloads; use /versions or /current')
  next()
}

app.use('/downloads', deprecatedDownloadsOnly)

// /downloads is kept only as a deprecated GET/HEAD compatibility alias. New manifests must use /versions/ or /current/.
app.use('/downloads', express.static(downloadsPath, {
  index: false,
  setHeaders(res) {
    res.setHeader('Warning', '299 FlowCube "/downloads is deprecated; use /versions or /current"')
    res.setHeader('X-FlowCube-Deprecated-Alias', '/downloads; use /versions or /current')
  },
}))
app.use('/versions', express.static(versionsPath))
app.use('/current', express.static(currentPath))

// ─── 404 处理 ─────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在', data: null })
})

// ─── 全局错误处理（必须最后注册）─────────────────────────────────────────────

app.use(errorHandler)

module.exports = app
