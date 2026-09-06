const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveOperation } = require('../backend/src/modules/document-activity/document-operation')

test('订单操作按完整类型与 ID 归属，不能串单或接受查询/失败', () => {
  assert.deepEqual(resolveOperation('POST', '/api/returns/sale/12/confirm', 200, { success: true }), { type: 'sale-return', id: 12, title: '确认单据' })
  assert.equal(resolveOperation('GET', '/api/sale/12', 200, { success: true }), null)
  assert.equal(resolveOperation('POST', '/api/sale/12/cancel', 409, { success: false }), null)
  assert.equal(resolveOperation('POST', '/api/sale/12/cancel', 200, { success: false }), null)
  assert.equal(resolveOperation('POST', '/api/sale/12oops/cancel', 200, { success: true }), null)
  assert.equal(resolveOperation('POST', '/api/suppliers/12', 200, { success: true }), null)
})

test('新建单据只使用服务端返回 ID，子行修改归属订单头', () => {
  assert.deepEqual(resolveOperation('POST', '/api/picking-waves', 201, { success: true, data: { waveId: 23 } }), { type: 'wave', id: 23, title: '创建单据' })
  assert.deepEqual(resolveOperation('PUT', '/api/procurement/plans/2/items/31', 200, { success: true }), { type: 'plan', id: 2, title: '修改明细' })
  assert.equal(resolveOperation('POST', '/api/purchase', 201, { success: true }), null)
})

const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
function load(file, dependencies) {
  const context = { module: { exports: {} }, exports: {}, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw Error(`Unexpected dependency ${name}`)
  }, setImmediate, console }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file })
  return context.module.exports
}

test('原详情拒绝访问时不读取任何活动数据', async () => {
  let queries = 0
  const denied = new Error('WAREHOUSE_SCOPE_DENIED')
  const service = load('backend/src/modules/document-activity/document-activity.service.js', {
    '../../config/db': { pool: { query: () => { queries++; throw Error('不应查询') } } },
    './document-registry': { loadDocument: async () => { throw denied } },
    './document-operation': require('../backend/src/modules/document-activity/document-operation'),
    './document-progress': { buildProgress: () => { throw Error('不应读取进度') } },
  })
  await assert.rejects(service.getActivity('purchase', 12, { warehouseIds: [1] }), e => e === denied)
  assert.equal(queries, 0)
})

test('订单事件独立保存，只存动作和原因，不复制请求正文', async () => {
  const queries = []
  const middleware = load('backend/src/middleware/opLogger.js', {
    '../config/db': { pool: { query: async (sql, params) => { queries.push({ sql, params }); return [{ insertId: 99 }] } } },
    '../utils/logger': { error: () => {} },
    '../modules/document-activity/document-operation': require('../backend/src/modules/document-activity/document-operation'),
  })
  const req = { method: 'POST', originalUrl: '/api/purchase/12/reject', path: '/12/reject', body: { reason: '金额需核对', token: 'DO-NOT-STORE' }, user: { userId: 7, realName: '测试经办人' }, headers: {} }
  const res = { statusCode: 200, json: body => body }
  middleware(req, res, () => {})
  res.json({ success: true, data: null })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queries.length, 2)
  assert.match(queries[1].sql, /document_operation_events/)
  assert.deepEqual(Array.from(queries[1].params), ['purchase', 12, 99, '驳回申请', '金额需核对', 7, '测试经办人'])
  assert.equal(JSON.stringify(queries).includes('DO-NOT-STORE'), false)
})

test('记录接口沿用报销本人范围与物流仓库范围', async () => {
  const calls = []
  const P = require('../backend/src/constants/permissions').PERMISSIONS
  const registry = load('backend/src/modules/document-activity/document-registry.js', {
    '../../constants/permissions': { PERMISSIONS: P },
    '../../utils/AppError': Error,
    '../finance/expense-claims.service': { findById: async (...args) => calls.push(args) },
    '../logistics/logistics.service': { getWaybillById: async (...args) => calls.push(args) },
  })
  await registry.loadDocument('expense', 12, { userId: 7, roleId: 2, warehouseIds: [3], permissions: [] })
  assert.equal(calls[0][1].applicantId, 7)
  assert.equal(calls[0][1].allowAll, false)
  await registry.loadDocument('logistics', 12, { userId: 7, roleId: 2, warehouseIds: [3] })
  assert.deepEqual(Array.from(calls[1][1].warehouseIds), [3])
  assert.equal(registry.getDefinition('constructor'), null)
})

test('数量差额保留四位小数，不出现浮点尾数或混合单位合计', () => {
  const progress = load('backend/src/modules/document-activity/document-progress.js', {
    '../../config/db': { pool: {} },
    '../print-jobs/print-jobs.status': {},
    '../inbound-tasks/inbound-tasks.status': {},
    '../../utils/inboundThresholds': {},
    '../../engine/inventoryEngine': { MOVE_TYPE: {} },
  })
  assert.equal(progress.difference(0.3, 0.2), 0.1)
  assert.equal(progress.difference('1.0001', '1.0000'), 0.0001)
  assert.equal(progress.difference(1, 2), -1)
})

test('限定仓库且没有可见明细的采购计划不返回历史', async () => {
  const registry = load('backend/src/modules/document-activity/document-registry.js', {
    '../../constants/permissions': require('../backend/src/constants/permissions'),
    '../../utils/AppError': Error,
    '../procurement/procurement.service': { getPlan: async () => ({ id: 1, items: [] }) },
  })
  await assert.rejects(registry.loadDocument('plan', 1, { warehouseIds: [3] }), /无权查看/)
})
