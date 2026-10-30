const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.join(__dirname, '../backend/src')
function load(relative, deps) {
  const filename = path.join(base, relative), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    throw Error(`Unexpected dependency ${name}`)
  } }, { filename })
  return module.exports
}
const ship = { tasks: [{ taskId: 31, taskNo: 'SYNTHETIC-WT31', warehouseName: '合成仓' }], partial: true, remaining: 1 }
function fixture() {
  const calls = []
  const db = {}
  const guard = load('modules/sale/sale.ordinary-receipt.js', {
    '../../utils/AppError': AppError,
    '../../utils/saleDocumentScope': { async assertSaleDocumentInScope(actual, scope, id, opts) {
      assert.equal(actual, db); calls.push({ scope, id, opts })
      if (Array.isArray(scope) && !scope.includes(8)) throw new AppError('外仓', 403, 'WAREHOUSE_SCOPE_DENIED')
    } },
  })
  return { calls, db, guard }
}
const receipt = kind => ({ status: 'success', resourceType: 'sale_order', resourceId: 21, data: kind === 'ship' ? structuredClone(ship) : null })
test('普通三动作本人原回执均按实际matched冒号action核SO全集仓；Kit保持独立', async () => {
  for (const kind of ['reserve', 'release', 'ship']) for (const scope of [[8], null, [9], []]) {
    const f = fixture(), context = { requestedAction: `sale.${kind}:21`, matchedAction: `sale.${kind}:21` }
    if (Array.isArray(scope) && !scope.includes(8)) await assert.rejects(f.guard.assertOrdinarySaleReceipt(f.db, receipt(kind), scope, context), e => e.statusCode === 403)
    else await f.guard.assertOrdinarySaleReceipt(f.db, receipt(kind), scope, context)
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].id, 21)
  }
  const f = fixture()
  for (const matchedAction of ['sale.ship.21', 'purchase.create', undefined]) await f.guard.assertOrdinarySaleReceipt(f.db, receipt('ship'), [], { matchedAction })
  for (const status of ['not_found', 'failed', 'pending']) await f.guard.assertOrdinarySaleReceipt(f.db, { status }, [], { matchedAction: 'sale.ship:21' })
  assert.equal(f.calls.length, 0)
})
test('普通回执错SO/错资源/错动作拒绝，NULL范围也不冒认身份', async () => {
  const negatives = [
    [receipt('reserve'), 'sale.reserve:22', 'sale.reserve:21'],
    [{ ...receipt('reserve'), resourceType: 'warehouse_task' }, 'sale.reserve:21', 'sale.reserve:21'],
    [{ ...receipt('reserve'), resourceId: '21' }, 'sale.reserve:21', 'sale.reserve:21'],
    [{ ...receipt('reserve'), resourceId: 22 }, 'sale.reserve:21', 'sale.reserve:21'],
    [receipt('reserve'), 'sale.release:21', 'sale.reserve:21'],
    [receipt('reserve'), 'sale.reserve:0', 'sale.reserve:0'],
    [{ ...receipt('reserve'), data: { id: 21 } }, 'sale.reserve:21', 'sale.reserve:21'],
  ]
  for (const [value, requestedAction, matchedAction] of negatives) {
    const f = fixture(); await assert.rejects(f.guard.assertOrdinarySaleReceipt(f.db, value, null, { requestedAction, matchedAction }), e => e.code === 'SALE_OPERATION_RECEIPT_INVALID')
    assert.equal(f.calls.length, 0)
  }
})
test('派发只核原tasks结构和remaining自洽，不套当前任务状态或发货资格', async () => {
  for (const data of [null, { ...ship, tasks: [] }, { ...ship, tasks: [ship.tasks[0], ship.tasks[0]] }, { ...ship, tasks: [{ ...ship.tasks[0], taskId: 0 }] }, { ...ship, partial: false }, { ...ship, remaining: -1 }]) {
    const f = fixture(); await assert.rejects(f.guard.assertOrdinarySaleReceipt(f.db, { ...receipt('ship'), data }, null, { matchedAction: 'sale.ship:21' }), e => e.code === 'SALE_OPERATION_RECEIPT_INVALID')
    assert.equal(f.calls.length, 0)
  }
})
test('宽查询命中普通原action仍核scope；控制器只调用本人tuple不加VIEW', async () => {
  for (const scope of [[8], [9]]) {
    const f = fixture(), sent = [], deps = {
      '../../utils/AppError': AppError,
      '../../utils/response': { successResponse(_res, data) { sent.push(data) } },
      '../../utils/operationRequest': { async getScopedOperationRequestStatus(input) { assert.equal(input.userId, 7); assert.equal(input.requestKey, 'original'); input.receiptContext.matchedAction = 'sale.ship:21'; return receipt('ship') } },
      '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent() {} }, '../../utils/logger': {},
      '../inbound-tasks/inbound-tasks.create-receipt': { async ensureInboundCreateReceiptView() {}, async assertInboundCreateReceipt() {} },
      '../inbound-tasks/inbound-tasks.edit-receipt': { async ensureInboundEditReceiptView() {}, async assertInboundEditReceipt() {} },
      '../print-jobs/print-jobs.reprint-intent': { async ensureReprintReceiptPermission() {}, async assertReprintReceiptScope() {} },
      './system.split-device': { async ensureSplitReceiptDevice() {} }, '../inventory/inventory.split-receipt': { async assertSplitReceipt() {} },
      '../sale/sale.commercial-receipts': { async assertReceiptScope() {} }, '../sale/sale.ordinary-receipt': f.guard, '../../config/db': { pool: f.db },
    }
    const ctrl = load('modules/system/system.controller.js', deps); let error
    await ctrl.requestStatus({ params: { key: 'original' }, query: { action: 'sale' }, user: { userId: 7, warehouseIds: scope, permissions: [] } }, {}, e => { error = e })
    if (scope.includes(8)) { assert.equal(error, undefined); assert.equal(sent.length, 1) } else { assert.equal(error?.statusCode, 403); assert.equal(sent.length, 0) }
    assert.equal(f.calls.length, 1)
  }
})
test('反向验证：移除实际领域scope调用时原外仓拒绝断言自然失败', async () => {
  const file = path.join(base, 'modules/sale/sale.ordinary-receipt.js'), source = fs.readFileSync(file, 'utf8')
  const line = "  await assertSaleDocumentInScope(db, scopeWarehouseIds, receipt.resourceId, { entityName: '销售操作回执' })"
  assert.equal(source.split(line).length, 2)
  const module = { exports: {} }
  vm.runInNewContext(source.replace(line, ''), { module, require: name => name.includes('AppError') ? AppError : { assertSaleDocumentInScope() { throw new AppError('外仓', 403) } } })
  await assert.rejects(async () => { await assert.rejects(module.exports.assertOrdinarySaleReceipt({}, receipt('reserve'), [9], { matchedAction: 'sale.reserve:21' }), e => e.statusCode === 403) }, e => e.code === 'ERR_ASSERTION')
})
