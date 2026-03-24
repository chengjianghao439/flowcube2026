/**
 * FlowCube 定时任务调度器
 *
 * 使用 node-cron 注册所有定期后台任务。
 * 在 index.js bootstrap() 完成后调用 startScheduler() 激活。
 *
 * 规则：
 *  - 所有任务必须 catch 异常，不允许向外抛出（防止进程崩溃）
 *  - 任务执行结果统一通过 console.log / console.error 输出
 */

const cron = require('node-cron')
const { runAllChecks } = require('./modules/system/healthCheck.service')

/**
 * 系统健康巡检任务
 * Cron 表达式：'0 2 * * *' = 每天凌晨 02:00 执行
 * （选择 02:00 而非 00:00，避免与其他跨日任务并发）
 */
function scheduleHealthCheck() {
  const EXPR = process.env.HEALTH_CHECK_CRON || '0 2 * * *'

  if (!cron.validate(EXPR)) {
    console.error(`[Scheduler] 健康巡检 Cron 表达式无效：${EXPR}，任务未注册`)
    return
  }

  cron.schedule(EXPR, async () => {
    const ts = new Date().toISOString()
    console.log(`[Scheduler] [${ts}] 开始执行定时健康巡检...`)
    try {
      const result = await runAllChecks('scheduler')
      console.log(
        `[Scheduler] 巡检完成，run_id=${result.runId}，` +
        `耗时 ${result.elapsedMs}ms，` +
        `发现问题 ${result.totalIssues} 条` +
        (result.hasHigh ? '，⚠️  存在 HIGH 级别异常！' : '，无高危问题。')
      )
    } catch (err) {
      console.error(`[Scheduler] 健康巡检执行失败：${err.message}`, err)
    }
  }, {
    timezone: 'Asia/Shanghai',
  })

  console.log(`[Scheduler] 健康巡检已注册（${EXPR}，Asia/Shanghai）`)
}

/**
 * 启动所有定时任务
 * 在 index.js 的 bootstrap() 末尾调用
 */
function startScheduler() {
  scheduleHealthCheck()
}

module.exports = { startScheduler }
