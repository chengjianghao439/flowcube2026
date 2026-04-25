const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })
const app    = require('./src/app')
const logger = require('./src/utils/logger')
const { testConnection } = require('./src/config/db')
const { startScheduler } = require('./src/scheduler')
const { env } = require('./src/config/env')

const PORT = env.PORT
const IS_DEV = !env.IS_PROD
let server = null
let shuttingDown = false

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

function gracefulShutdown(reason, err, exitCode = 1) {
  if (shuttingDown) return
  shuttingDown = true
  logger.error(`进程进入优雅退出：${reason}`, err, { exitCode }, 'PROCESS')
  const timeout = setTimeout(() => {
    logger.error('优雅退出超时，强制退出', null, { reason, exitCode }, 'PROCESS')
    process.exit(exitCode)
  }, 10_000)
  timeout.unref?.()
  if (!server) {
    process.exit(exitCode)
    return
  }
  server.close(() => {
    logger.info('HTTP 服务已关闭，进程退出', { reason, exitCode }, 'PROCESS')
    process.exit(exitCode)
  })
}

// ── 全局异常兜底 ────────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
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

// ── 启动 ──────────────────────────────────────────────────────────────────────

async function bootstrap() {
  await testConnection()
  server = app.listen(PORT, () => {
    logger.info(`FlowCube API 已启动 http://localhost:${PORT}  env=${env.NODE_ENV}`, {}, 'Server')
  })
  logger.info('数据库迁移已改为显式执行：请在部署前运行 `npm run migrate`', {}, 'Server')
  startScheduler()
}

bootstrap().catch((err) => {
  logger.error('启动失败', err, {}, 'Server')
  process.exit(1)
})
