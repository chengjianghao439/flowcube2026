const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })
const app    = require('./src/app')
const logger = require('./src/utils/logger')
const { pool, testConnection } = require('./src/config/db')
const { startScheduler } = require('./src/scheduler')
const { env } = require('./src/config/env')
const { lifecycle } = require('./src/utils/runtimeLifecycle')
const { httpDrain } = require('./src/utils/httpDrain')
const { createGracefulShutdown } = require('./src/utils/gracefulShutdown')

const PORT = env.PORT
const IS_DEV = !env.IS_PROD
let server = null
let startup
const gracefulShutdown = createGracefulShutdown({
  lifecycle, getServer: () => server, closePool: () => pool.end(), logger,
  waitForStartup: () => startup.catch(() => {}),
  waitForHttpHandlers: () => httpDrain.waitForHandlers(),
})

function normalizeFatalReason(reason) {
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  try {
    return new Error(JSON.stringify(reason))
  } catch (_) {
    return new Error(String(reason))
  }
}

function shouldShutdownOnUnhandledRejection(reason) {
  const err = normalizeFatalReason(reason)
  if (err.isOperational === true) return false
  return true
}

// ── 全局异常兜底 ────────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  const err = normalizeFatalReason(reason)
  logger.error('未处理的 Promise 拒绝', err, { fatal: shouldShutdownOnUnhandledRejection(reason) }, 'PROCESS')
  if (IS_DEV || shouldShutdownOnUnhandledRejection(reason)) {
    gracefulShutdown('unhandledRejection', err, 1)
  }
})

process.on('uncaughtException', (err) => {
  logger.error('未捕获的同步异常', err, { fatal: true }, 'PROCESS')
  gracefulShutdown('uncaughtException', err, 1)
})

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM', null, 0) })
process.on('SIGINT', () => { void gracefulShutdown('SIGINT', null, 0) })

// ── 启动 ──────────────────────────────────────────────────────────────────────

async function bootstrap() {
  await testConnection()
  if (lifecycle.isDraining()) return
  server = app.listen(PORT, () => {
    logger.info(`FlowCube API 已启动 http://localhost:${PORT}  env=${env.NODE_ENV}`, {}, 'Server')
  })
  server.on('error', err => { void gracefulShutdown('serverError', err, 1) })
  logger.info('数据库迁移已改为显式执行：请在部署前运行 `npm run migrate`', {}, 'Server')
  startScheduler()
}

startup = bootstrap()
startup.catch((err) => {
  logger.error('启动失败', err, {}, 'Server')
  void gracefulShutdown('bootstrap', err, 1)
})
