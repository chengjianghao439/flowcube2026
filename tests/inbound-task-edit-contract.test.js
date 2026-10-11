 'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const base = path.resolve(__dirname, '../backend/src')
const read = relative => fs.readFileSync(path.join(base, relative), 'utf8').replace(/^\s*\/\/.*$/gm, '')
const permissions = require(path.join(base, 'constants/permissions')).PERMISSIONS
function routes() {
  const filename = path.join(base, 'modules/inbound-tasks/inbound-tasks.routes.js'), real = createRequire(filename), module_ = { exports: {} }
  const noop = () => {}, stubs = { './inbound-tasks.controller': new Proxy({}, { get: () => noop }), '../../middleware/auth': { authMiddleware: noop, requirePermission: code => Object.assign(noop.bind(null), { permission: code }) }, '../../middleware/pdaSession': { pdaSessionRequired: () => noop }, '../../middleware/pdaOnly': { pdaOnly: noop }, './inbound-tasks.suggestion': { putawaySuggestionHandler: noop } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => Object.hasOwn(stubs, id) ? stubs[id] : real(id) }, { filename })
  return module_.exports.stack.filter(l => l.route).map(l => l.route)
}
test('独立编辑权限，GET上下文/候选和PUT均受该权约束', () => {
  assert.equal(permissions.INBOUND_ORDER_UPDATE, 'inbound.order.update')
  for (const [method, url] of [['get', '/:id/edit-context'], ['get', '/:id/edit-purchase-items'], ['put', '/:id']]) {
    const route = routes().find(r => r.path === url && r.methods[method])
    assert.ok(route, url); assert.equal(route.stack[0].handle.permission, permissions.INBOUND_ORDER_UPDATE)
  }
})
test('PUT严格拒绝客户端supplier/warehouse/unknown并保留运输记录', () => {
  const route = routes().find(r => r.path === '/:id' && r.methods.put)
  assert.ok(route)
  const body = { items: [{ purchaseItemId: 1, qty: 1 }], expectedEditFingerprint: 'a'.repeat(64), freightType: 2, freightAmount: 0 }
  const parse = b => { const req = { body: b }; let failure; route.stack[1].handle(req, {}, e => { failure = e }); if (failure) throw failure; return req.body }
  assert.equal(parse(body).freightAmount, 0)
  for (const extra of [{ supplierId: 2 }, { warehouseId: 9 }, { expectedEditFingerprint: '' }, { freightAmount: 1.001 }, { freightAmount: 999999999999.9803 }, { freightAmount: 999999999999.9802 }, { freightAmount: 100000000000.01003 }, { items: [] }]) assert.throws(() => parse({ ...body, ...extra }))
})
test('编辑数量策略消费者不需开放主档', () => assert.match(read('modules/products/products.routes.js'), /PERMISSIONS\.INBOUND_ORDER_UPDATE/))
test('默认候选有界，自身任务排除占量，真实来源锁不靠聚合FOR UPDATE', () => {
  const source = read('modules/inbound-tasks/inbound-tasks.query.js')
  assert.match(source, /excludeTaskId/)
  assert.match(source, /lockPurchasableSources/)
  assert.match(source, /ORDER BY id FOR UPDATE/)
  const command = read('modules/inbound-tasks/inbound-tasks.command.js')
  assert.match(command, /SET TRANSACTION ISOLATION LEVEL READ COMMITTED/)
  assert.match(command, /VALUES \?/)
})
test('列表草稿门批量统计每条非零执行以及含legacy的未删容器', () => {
  const source = read('modules/inbound-tasks/inbound-tasks.query.js')
  assert.match(source, /execution_line_count/)
  assert.match(source, /edit_container_count/)
  assert.match(source, /draftEditable/)
})
test('回执恢复在通用查询入口校验真实资源和仓范围', () => {
  const source = read('modules/system/system.controller.js')
  assert.match(source, /assertInboundEditReceipt/)
  assert.match(source, /ensureInboundEditReceiptView/)
  assert.ok(source.indexOf('ensureInboundEditReceiptView') < source.indexOf('const data = await getScopedOperationRequestStatus'))
  assert.match(read('modules/inbound-tasks/inbound-tasks.edit-receipt.js'), /requirePermission\(PERMISSIONS\.INBOUND_ORDER_VIEW\)/)
})
test('最大编号新增284运输记录迁移只新增nullable两列并核形状', () => {
  const file = path.join(base, 'database/284_inbound_freight_record.sql')
  assert.ok(fs.existsSync(file))
  const sql = fs.readFileSync(file, 'utf8')
  assert.match(sql, /DECIMAL\(14,2\)/)
  assert.match(sql, /information_schema\.COLUMNS/)
  assert.match(sql, /freight_type/); assert.match(sql, /freight_amount/)
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+sys_role_permissions/i)
})
