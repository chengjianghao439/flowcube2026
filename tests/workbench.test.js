const test = require('node:test')
const assert = require('node:assert/strict')
const calls = []
// 同时记录参数：待上架相关查询必须带 CONTAINER_STATUS.PENDING_PUTAWAY(4)，
// 只看 SQL 文本无法区分「status = ?」传的是什么。
const callsWithParams = []
const dbPath = require.resolve('../backend/src/config/db')
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async (sql, params) => { calls.push(sql); callsWithParams.push({ sql, params }); return [[{ count: 0 }]] } } } }
const thresholdsPath = require.resolve('../backend/src/utils/inboundThresholds')
require.cache[thresholdsPath] = { id: thresholdsPath, filename: thresholdsPath, loaded: true, exports: { getInboundClosureThresholds: async () => ({ printTimeoutMinutes: 5 }) } }
const { roleWorkbench } = require('../backend/src/modules/reports/reports.metrics')

test('待办不生成已取消的异常工作台卡片，不再查询巡检日志充当业务待办', async () => {
  const result = await roleWorkbench(null, { batchSize: 200 })
  const cards = result.sections.flatMap(s => s.cards)
  assert.deepEqual(cards.map(c => c.key).sort(), ['warehouse-pending-receive', 'warehouse-putaway', 'warehouse-print', 'sale-pending-ship', 'sale-below-cost'].sort())
  assert.ok(cards.every(c => c.path !== '/reports/exception-workbench'))
  assert.ok(!calls.some(sql => sql.includes('system_health_logs')))
  assert.equal(result.summary.totalAlerts, 0)
})

const { buildNotifications } = require('../backend/src/modules/notifications/notifications.service')
test('通知不查询或展示已取消的系统巡检提醒', async () => {
  calls.length = 0
  const result = await buildNotifications(null, null)
  assert.ok(!calls.some(sql => sql.includes('system_health_logs')))
  assert.ok(!result.items.some(item => item.code === 'SYSTEM_HEALTH_ANOMALY'))
})

// 待上架容器是 status=4（CONTAINER_STATUS.PENDING_PUTAWAY），容器没有 0 状态。
// 此前工作台的「待上架」卡片与「打印后未上架超时」通知都写成 `status = 0`，条件恒不成立：
// 待办永远是空的、超时提醒从不出现，收完货没人上架也没人知道（2026-09-16 修复，
// 当时生产已有 2 张单各压着 1 个待上架容器躺了 5 个多月）。
test('待上架相关的容器查询用真实状态 4，不得再用不存在的状态 0', async () => {
  calls.length = 0
  callsWithParams.length = 0
  await roleWorkbench(null, { batchSize: 200 })
  await buildNotifications(null, null)

  assert.ok(
    !calls.some(sql => /inventory_containers/i.test(sql) && /status\s*=\s*0/.test(sql)),
    '不得再用容器状态 0 过滤（容器状态只有 1..6）',
  )
  const putawayQueries = callsWithParams.filter(
    c => /inventory_containers/i.test(c.sql) && /status\s*=\s*\?/.test(c.sql) && /inbound_task_id IS NOT NULL/i.test(c.sql),
  )
  assert.ok(putawayQueries.length > 0, '工作台与通知都应发出待上架容器查询')
  assert.ok(
    putawayQueries.every(c => Array.isArray(c.params) && c.params.includes(4)),
    `待上架查询参数应含 4：${JSON.stringify(putawayQueries.map(c => c.params))}`,
  )
})
