/**
 * 极序 Flow 定时任务调度器
 */

const { startCleanupSweeper } = require('./utils/operationRequest')

function startScheduler() {
  // 每 6 小时清理超过 7 天的 operation_requests 记录
  startCleanupSweeper({ intervalMs: 6 * 60 * 60 * 1000, ttlDays: 7 })
}

module.exports = { startScheduler }
