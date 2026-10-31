const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createRequire } = require('node:module')
let rules = {}
try { rules = require('../backend/src/modules/fulfillment/fulfillment.rules') } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }

test('交期严格验证日历日期，不接受溢出日期', () => {
  assert.equal(typeof rules.dateOnly, 'function')
  assert.equal(rules.dateOnly('2026-09-06'), '2026-09-06')
  assert.throws(() => rules.dateOnly('2026-02-30'))
  assert.throws(() => rules.dateOnly('2026-9-6'))
  assert.equal(rules.dateOnly(null), null)
})
test('异步条件仍成立时拒绝关闭；结果必填；认领只接受未指派事项', () => {
  assert.equal(typeof rules.assertIssueAction, 'function')
  assert.throws(() => rules.assertIssueAction({ status: 'open', source: 'auto', owner_id: null }, 'resolve', '已联系', true), /仍存在/)
  assert.throws(() => rules.assertIssueAction({ status: 'open', source: 'manual', owner_id: null }, 'resolve', '', false), /结果/)
  assert.throws(() => rules.assertIssueAction({ status: 'open', owner_id: 2 }, 'claim', '', false), /认领/)
  assert.doesNotThrow(() => rules.assertIssueAction({ status: 'open', source: 'manual', owner_id: null }, 'resolve', '供应商已确认', false))
})
test('销售发货安排接口停止读写，采购接口仍由原规则处理', async () => {
  const filename = require.resolve('../backend/src/modules/fulfillment/fulfillment.service')
  const localRequire = createRequire(filename)
  const context = { module: { exports: {} }, require: id => id === '../../config/db'
    ? { pool: { query: async () => { throw new Error('unexpected database access') }, getConnection: async () => { throw new Error('unexpected database access') } } }
    : ['./fulfillment.rules', '../../utils/AppError'].includes(id) ? localRequire(id) : id === './fulfillment.query' ? { createIssueReader: () => () => {} } : id === './fulfillment.access' ? { authorize: async () => ({}) } : {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  const service = context.module.exports
  for (const action of [
    () => service.getDocument('sale', 1, {}),
    () => service.setDates('sale', 1, { date: '2026-11-01', reason: '旧客户端' }, {}, 'old-client'),
    () => service.createIssue('sale', 1, { title: '安排', reason: '旧客户端' }, {}, 'old-client'),
  ]) await assert.rejects(action, { code: 'SALE_ARRANGEMENT_REMOVED' })
  await assert.rejects(service.setDates('purchase', 1, {}, {}, ''), /请求键/)
})

test('销售只保留实际仓库交接与授信待办，不计算发货安排', async () => {
  const filename = require.resolve('../backend/src/modules/fulfillment/fulfillment.detect')
  const localRequire = createRequire(filename)
  const context = { module: { exports: {} }, require: id => id === './fulfillment.delivery' ? { saleDelivery: async () => { throw new Error('unexpected scheduling query') } } : id === './fulfillment.access' ? { definition: () => ({ path: '/sale' }) } : id === '../../utils/inboundThresholds' ? {} : localRequire(id) }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  const { detect } = context.module.exports
  const conn = { async query(sql) {
    if (sql.includes('FROM warehouse_tasks')) return [[{ id: 8, task_no: 'WT8', adjustment_requested_at: '2026-10-30' }]]
    if (sql.includes('FROM sale_credit_overrides')) return [[{ id: 9 }]]
    throw new Error(`unexpected scheduling query: ${sql}`)
  } }
  const issues = await detect(conn, 'sale', { id: 1, status: 3 })
  assert.deepEqual(Array.from(issues, issue => issue.key), ['adjust:8', 'credit:9'])
  assert.equal(issues[0].actionPath, '/sale/1?focus=progress&taskId=8')
})
