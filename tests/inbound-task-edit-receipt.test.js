 'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.edit-receipt.js')
const local = createRequire(filename), module_ = { exports: {} }
if (fs.existsSync(filename)) vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => id === '../../middleware/auth' ? { requirePermission: permission => (req, _res, next) => { if (req.user?.roleId === 1 || req.user?.permissions?.includes(permission)) return next(); next(Object.assign(new Error('查看权已撤销'), { statusCode: 403, code: 'PERMISSION_DENIED', data: { permission } })) } } : id === '../../utils/warehouseScope' ? { assertInScope: (scope, id) => { if (Array.isArray(scope) && !scope.includes(Number(id))) throw Object.assign(new Error('scope'), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' }) } } : local(id) }, { filename })
const receipt = (extra = {}) => ({ status: 'success', resourceType: 'inbound_task', resourceId: 1, data: { taskId: 1, taskNo: 'IT-1', expectedEditFingerprint: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64) }, ...extra })
const context = { requestedAction: 'inbound.update.1', matchedAction: 'inbound.update.1' }
const conn = { query: async () => [[{ id: 1, task_no: 'IT-1', warehouse_id: 2 }]] }
test('编辑本人回执领域守卫存在', () => assert.equal(typeof module_.exports.assertInboundEditReceipt, 'function'))
test('本人回执身份按当前原仓范围核对，不要求UPDATE', async () => {
  await module_.exports.assertInboundEditReceipt(conn, receipt(), [2], context)
  await assert.rejects(module_.exports.assertInboundEditReceipt(conn, receipt(), [9], context), { code: 'WAREHOUSE_SCOPE_DENIED' })
})
test('not_found/pending也先核原action任务仓，不能借结果未知越仓重试', async () => {
  for (const status of ['not_found', 'pending']) await assert.rejects(module_.exports.assertInboundEditReceipt(conn, { status, data: null }, [9], { requestedAction: 'inbound.update.1' }), { code: 'WAREHOUSE_SCOPE_DENIED' })
})
test('宽prefix/base、跨资源、损坏ACK一律不能报成功', async () => {
  for (const c of [{ ...context, requestedAction: 'inbound.update' }, { ...context, requestedAction: 'inbound.update.x' }, { ...context, matchedAction: 'inbound.update.2' }, { ...context, requestedAction: 'inbound' }]) await assert.rejects(module_.exports.assertInboundEditReceipt(conn, receipt(), [2], c), { code: 'INBOUND_EDIT_RECEIPT_INVALID' })
  for (const r of [receipt({ resourceId: 2 }), receipt({ resourceType: 'sale_order' }), receipt({ data: { taskId: 1, taskNo: 'IT-1' } })]) await assert.rejects(module_.exports.assertInboundEditReceipt(conn, r, [2], context), { code: 'INBOUND_EDIT_RECEIPT_INVALID' })
})

test('原本人回执查询必须VIEW；UPDATE撤回但VIEW保留可以确认', async () => {
  assert.equal(typeof module_.exports.ensureInboundEditReceiptView, 'function')
  const req = { user: { userId: 8, roleId: 2, permissions: ['inbound.order.view'] } }
  await module_.exports.ensureInboundEditReceiptView(req, {}, context)
  await module_.exports.assertInboundEditReceipt(conn, receipt(), [2], context)
})
test('VIEW撤回即使保有UPDATE也拒绝原服务器结果的所有状态', async () => {
  for (const permissions of [[], ['inbound.order.update']]) {
    const req = { user: { userId: 8, roleId: 2, permissions } }
    await assert.rejects(module_.exports.ensureInboundEditReceiptView(req, {}, context), e => e.statusCode === 403 && e.code === 'PERMISSION_DENIED' && e.data?.permission === 'inbound.order.view')
  }
  const req = { user: { userId: 8, roleId: 2, permissions: [] } }
  await assert.rejects(module_.exports.ensureInboundEditReceiptView(req, {}, { requestedAction: 'inbound.update.1' }), { code: 'PERMISSION_DENIED' })
})
test('无关操作回执不被新增VIEW门扩大权限要求，宽prefix命中本域也须VIEW', async () => {
  const req = { user: { userId: 8, roleId: 2, permissions: [] } }
  await module_.exports.ensureInboundEditReceiptView(req, {}, { requestedAction: 'sale.reserve.1', matchedAction: 'sale.reserve.1' })
  await assert.rejects(module_.exports.ensureInboundEditReceiptView(req, {}, { requestedAction: 'inbound', matchedAction: 'inbound.update.1' }), { code: 'PERMISSION_DENIED' })
})
