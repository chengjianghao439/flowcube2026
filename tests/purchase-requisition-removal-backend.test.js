const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const AppError = require('../backend/src/utils/AppError')
function load(file, mocks = {}) {
  const filename = path.join(root, file)
  const context = { module: { exports: {} }, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(require.resolve(name, { paths: [path.dirname(filename)] })) }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  return context.module.exports
}
function service() {
  const calls = []
  const conn = { query: async (sql, params) => { calls.push({ sql, params }); return [[{ id: 71, biz_type: 'purchase_requisition' }]] }, beginTransaction: async () => {}, rollback: async () => {}, release() {} }
  const pool = { query: conn.query, getConnection: async () => conn }
  return { calls, api: load('backend/src/modules/approvals/approvals.service.js', { '../../config/db': { pool }, '../../engine/approvalEngine': {}, '../refunds/supplier-refunds.actor': {}, '../../utils/warehouseScope': {}, '../../utils/saleDocumentScope': {} }) }
}
test('采购申请不能再成为审批类型，采购订单等共享审批仍可用', () => {
  const { api } = service()
  assert.ok(!api.BIZ_TYPES.some(row => row.value === 'purchase_requisition'))
  for (const type of ['purchase_order', 'expense_claim', 'sale_credit_override']) assert.ok(api.BIZ_TYPES.some(row => row.value === type))
})
test('已保存的采购申请审批配置隐藏且直链不能读改删，不写历史记录', async () => {
  for (const method of ['getFlow', 'updateFlow', 'removeFlow']) {
    const { api, calls } = service()
    await assert.rejects(api[method](71, { name: '旧申请' }), { statusCode: 410 })
    assert.ok(calls.every(row => !/INSERT|UPDATE .*SET|DELETE FROM/.test(row.sql)))
  }
  const { api, calls } = service()
  await api.listFlows()
  assert.match(calls[0].sql, /f\.biz_type IN \(\?\)/)
  assert.ok(!calls[0].params[0].includes('purchase_requisition'))
})
test('直查旧采购申请审批被拒绝，拒绝发生在取数据库连接前', async () => {
  const { api, calls } = service()
  await assert.rejects(api.getBizApproval({ bizType: 'purchase_requisition', bizId: 7 }), { statusCode: 400 })
  assert.equal(calls.length, 0)
})
test('采购申请不再注册正式API和单据活动，采购订单活动保留', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'backend/src/app.js'), 'utf8'), /app\.use\('\/api\/purchase-requisitions'/)
  const registry = load('backend/src/modules/document-activity/document-registry.js')
  assert.equal(registry.getDefinition('requisition'), null)
  assert.ok(registry.getDefinition('purchase'))
})
test('旧采购申请创建/转单回执不能从显式或宽查询泄漏', async () => {
  for (const action of ['purchase.requisition.create', 'purchase.requisition.convert.7', 'purchase']) {
    let queried = false, response = false, error
    const filename = path.join(root, 'backend/src/modules/system/system.controller.js')
    const sandbox = { module: { exports: {} }, require: name => {
      if (name === '../../utils/AppError') return AppError
      if (name === '../../utils/operationRequest') return { getScopedOperationRequestStatus: async args => { queried = true; args.receiptContext.matchedAction = 'purchase.requisition.create'; return { status: 'success', data: { id: 99 } } } }
      if (name === '../../utils/response') return { successResponse: () => { response = true } }
      return new Proxy({}, { get: () => async () => {} })
    } }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox)
    await sandbox.module.exports.requestStatus({ query: { action }, params: { key: 'old-key' }, user: { userId: 7 } }, {}, err => { error = err })
    assert.equal(error?.statusCode, 410)
    assert.equal(response, false)
    assert.equal(queried, action === 'purchase')
  }
})
