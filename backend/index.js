const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })
const app    = require('./src/app')
const logger = require('./src/utils/logger')
const { testConnection } = require('./src/config/db')
const { startScheduler } = require('./src/scheduler')
const { env } = require('./src/config/env')

const PORT = env.PORT
const IS_DEV = !env.IS_PROD

// ── 全局异常兜底（防止进程崩溃）─────────────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的 Promise 拒绝', reason instanceof Error ? reason : new Error(String(reason)), {}, 'PROCESS')
  if (IS_DEV) {
    // 开发环境直接崩溃，方便发现问题
    process.exit(1)
  }
  // 生产环境：记录日志，保持进程运行
})

process.on('uncaughtException', (err) => {
  logger.error('未捕获的同步异常', err, {}, 'PROCESS')
  if (IS_DEV) {
    process.exit(1)
  }
  // 生产环境：某些未捕获异常可能导致状态不一致
  // 此处记录后继续运行，建议配合进程守护（PM2 / Docker restart）
})

// ── 启动 ──────────────────────────────────────────────────────────────────────

async function bootstrap() {
  await testConnection()
  app.listen(PORT, () => {
    logger.info(`FlowCube API 已启动 http://localhost:${PORT}  env=${env.NODE_ENV}`, {}, 'Server')
  })
  logger.info('数据库迁移已改为显式执行：请在部署前运行 `npm run migrate`', {}, 'Server')
  startScheduler()
}

bootstrap().catch((err) => {
  logger.error('启动失败', err, {}, 'Server')
  process.exit(1)
})
