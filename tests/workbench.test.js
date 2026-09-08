const test = require('node:test')
const assert = require('node:assert/strict')
const calls = []
const dbPath = require.resolve('../backend/src/config/db')
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async sql => { calls.push(sql); return [[{ count: 0 }]] } } } }
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
