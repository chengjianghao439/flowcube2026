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

// 只替换数据库边界，运行真实通知服务与仓库过滤工具；不创建连接或启动应用。
// transfer_orders 没有 warehouse_id，且调拨列表允许源/目标任一端在范围内。
test('调拨通知按任一端授权计数，空范围不泄漏，不限仓保留原计数', async (t) => {
  const transfers = [
    { from_warehouse_id: 11, to_warehouse_id: 99, status: 1, deleted_at: null },
    { from_warehouse_id: 99, to_warehouse_id: 12, status: 2, deleted_at: null },
    { from_warehouse_id: 11, to_warehouse_id: 12, status: 2, deleted_at: null },
    { from_warehouse_id: 99, to_warehouse_id: 98, status: 1, deleted_at: null },
    { from_warehouse_id: 11, to_warehouse_id: 12, status: 3, deleted_at: null },
    { from_warehouse_id: 11, to_warehouse_id: 12, status: 2, deleted_at: '2026-10-06' },
  ]
  const pool = require(dbPath).pool
  for (const [label, scope, expected] of [
    ['源仓命中', [11], 2],
    ['目标仓命中', [12], 2],
    ['两端命中只计一次', [11, 12], 3],
    ['范围外', [77], 0],
    ['空范围', [], 0],
    ['不限仓', null, 4],
  ]) {
    await t.test(label, async () => {
      let transferQueries = 0
      const queryMock = t.mock.method(pool, 'query', async (sql, params) => {
        if (!/FROM transfer_orders\b/i.test(sql)) return [[{ count: 0 }]]
        transferQueries += 1
        assert.doesNotMatch(sql, /\bwarehouse_id\b/, '调拨表没有单仓 warehouse_id 列')
        assert.match(sql, /WHERE status IN \(1,2\) AND deleted_at IS NULL/)
        if (scope === null) {
          assert.doesNotMatch(sql, /\bIN \(\?\)|1\s*=\s*0/)
          assert.deepEqual(params, [])
        } else if (scope.length === 0) {
          assert.match(sql, /AND 1=0/)
          assert.deepEqual(params, [])
        } else {
          assert.match(sql, /AND \(from_warehouse_id IN \(\?\) OR to_warehouse_id IN \(\?\)\)/)
          assert.deepEqual(params, [scope, scope])
        }
        const visible = transfers.filter(row => [1, 2].includes(row.status)
          && row.deleted_at === null
          && (scope === null || scope.includes(row.from_warehouse_id) || scope.includes(row.to_warehouse_id)))
        return [[{ pendingTransfer: visible.length }]]
      })
      try {
        const result = await buildNotifications(scope, null)
        assert.equal(transferQueries, 1)
        assert.equal(result.counts.pendingTransfer, expected)
        const notification = result.items.find(item => item.code === 'PENDING_TRANSFER')
        if (expected > 0) {
          assert.equal(notification?.text, `${expected} 笔调拨单待处理`)
          assert.equal(notification?.path, '/transfer')
        } else {
          assert.equal(notification, undefined)
        }
      } finally {
        queryMock.mock.restore()
      }
    })
  }
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
