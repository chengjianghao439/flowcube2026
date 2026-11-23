const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
let rules = {}
try { rules = require('../backend/src/modules/fulfillment/fulfillment.rules') } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }

test('交期严格验证日历日期，不接受溢出日期', () => {
  assert.equal(typeof rules.dateOnly, 'function')
  assert.equal(rules.dateOnly('2026-09-06'), '2026-09-06')
  assert.throws(() => rules.dateOnly('2026-02-30'))
  assert.throws(() => rules.dateOnly('2026-9-6'))
  assert.equal(rules.dateOnly(null), null)
})
test('供应尚未落实或处理时效未知时，不伪造完整可发日期', () => {
  assert.equal(typeof rules.deliveryEstimate, 'function')
  const partial = rules.deliveryEstimate({ remaining: 10, physical: 4, sources: [], processingDays: 1, today: '2026-09-06' })
  assert.equal(partial.firstDate, '2026-09-07')
  assert.equal(partial.allDate, null)
  assert.equal(partial.shortage, 6)
  assert.equal(rules.deliveryEstimate({ remaining: 10, physical: 10, sources: [], processingDays: null, today: '2026-09-06' }).allDate, null)
})
test('部分发货只对剩余量判断交期，过期未到货供应必须重新确认', () => {
  assert.equal(typeof rules.deliveryEstimate, 'function')
  const result = rules.deliveryEstimate({ remaining: 6, physical: 2, sources: [{ quantity: 4, date: '2026-09-05' }], processingDays: 0, today: '2026-09-06' })
  assert.equal(result.allDate, null)
  assert.equal(result.shortage, 0)
  assert.equal(result.unknownQuantity, 4)
})
test('异步条件仍成立时拒绝关闭；结果必填；认领只接受未指派事项', () => {
  assert.equal(typeof rules.assertIssueAction, 'function')
  assert.throws(() => rules.assertIssueAction({ status: 'open', source: 'auto', owner_id: null }, 'resolve', '已联系', true), /仍存在/)
  assert.throws(() => rules.assertIssueAction({ status: 'open', source: 'manual', owner_id: null }, 'resolve', '', false), /结果/)
  assert.throws(() => rules.assertIssueAction({ status: 'open', owner_id: 2 }, 'claim', '', false), /认领/)
  assert.doesNotThrow(() => rules.assertIssueAction({ status: 'open', source: 'manual', owner_id: null }, 'resolve', '供应商已确认', false))
})
test('仓库时效未知，但确定的采购到货晚于承诺时应提前预警', () => {
  assert.equal(typeof rules.isDeliveryLate, 'function')
  assert.equal(rules.isDeliveryLate({ remaining: 10, promisedDate: '2026-09-07', allDate: null, sources: [{ quantity: 6, date: '2026-09-16', bound: true }], today: '2026-09-06' }), true)
  assert.equal(rules.isDeliveryLate({ remaining: 0, promisedDate: '2026-09-07', allDate: null, sources: [], today: '2026-09-08' }), false)
})

test('销售履约详情在异常尚未登记时返回实时种类，不带来源编号', async () => {
  const user = { userId: 5, warehouseIds: [3] }
  const row = { id: 41, warehouse_id: 3 }
  const stored = [{ source_key: 'adjust:821', status: 'open' }, { source_key: 'credit:999', status: 'open' }]
  const active = [{ key: 'shortage:1242' }, { key: 'credit:34' }, { key: 'adjust:821' }]
  const pool = { async query(sql, ids) {
    assert.match(sql, /FROM order_fulfillment_issues/)
    assert.deepEqual(Array.from(ids), ['sale', 41])
    return [stored]
  } }
  const deps = {
    './fulfillment.refresh': {}, '../../config/db': { pool }, '../../utils/AppError': Error,
    '../../utils/operationRequest': {}, './fulfillment.events': {}, './fulfillment.query': { createIssueReader: () => null },
    './fulfillment.access': {
      async authorize(conn, type, id, actor) {
        assert.equal(conn, pool)
        assert.equal(type, 'sale')
        assert.equal(id, 41)
        assert.equal(actor, user)
        return row
      },
      definition: () => ({ write: 'sale.order.update' }), can: () => false, eligibleOwners: async () => [],
    },
    './fulfillment.delivery': { saleDelivery: async () => ({ commitments: [] }) },
    './fulfillment.detect': { detect: async (_conn, _type, order) => {
      assert.equal(order, row)
      return active
    } },
    './fulfillment.rules': rules,
  }
  const file = require.resolve('../backend/src/modules/fulfillment/fulfillment.service')
  const loaded = { exports: {} }
  runInNewContext(readFileSync(file, 'utf8'), { module: loaded, require(name) {
    assert.ok(Object.hasOwn(deps, name), name)
    return deps[name]
  } }, { filename: file })
  const result = await loaded.exports.getDocument('sale', 41, user)
  assert.deepEqual(Array.from(result.activeIssueKinds ?? []), ['shortage', 'credit', 'adjust'])
  assert.equal(result.detectedCount, 3)
  assert.deepEqual(Array.from(result.issues, issue => issue.conditionActive), [true, false])
})
