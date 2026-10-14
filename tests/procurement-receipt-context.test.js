const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const intent = require('../backend/src/modules/purchase-requisitions/purchase-requisitions.create-intent')
const base = path.join(__dirname, '../backend/src')
function load(relative, deps, transform = source => source) {
  const filename = path.join(base, relative), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => {
    assert.ok(Object.hasOwn(deps, name), `Unstubbed dependency: ${name}`)
    return deps[name]
  } }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const guard = load('modules/purchase-requisitions/purchase-requisitions.create-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, './purchase-requisitions.create-intent': intent })
const body = { warehouseId: 8, items: [{ productId: 3, quantity: 4 }] }
const fingerprint = intent.requestFingerprint(body)
const data = { id: 21, requisitionNo: 'SYNTHETIC-PR21', warehouseId: 8, requestFingerprint: fingerprint }
async function request(options = {}) {
  const { warehouseIds = [8], action = intent.ACTION, transform } = options
  const hash = Object.hasOwn(options, 'hash') ? options.hash : fingerprint
  const sqls = [], sent = [], receipt = { status: 'success', resourceType: 'purchase_requisition', resourceId: 21, data }
  const db = { async query(sql, params) {
    sqls.push({ sql, params })
    if (sql.includes('FROM purchase_requisitions')) return [[{ id: 21, requisition_no: data.requisitionNo, warehouse_id: 8, applicant_id: 7 }]]
    if (sql.includes('FROM operation_requests')) return [[{ id: 31, action: intent.ACTION, user_id: 7, status: 1, resource_type: 'purchase_requisition', resource_id: 21, response_json: JSON.stringify(data) }]]
    throw Error(`Unexpected SQL: ${sql}`)
  } }
  const controller = load('modules/system/system.controller.js', {
    '../../utils/response': { successResponse(_res, response) { sent.push(response) } },
    '../../utils/operationRequest': { async getScopedOperationRequestStatus(input) {
      assert.equal(input.userId, 7); assert.equal(input.requestKey, 'original-key')
      input.receiptContext.matchedAction = intent.ACTION
      return receipt
    } }, '../../utils/logger': {}, '../../config/db': { pool: db },
    '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent() {} },
    '../inbound-tasks/inbound-tasks.create-receipt': { async ensureInboundCreateReceiptView() {}, async assertInboundCreateReceipt() {} },
    '../inbound-tasks/inbound-tasks.edit-receipt': { async ensureInboundEditReceiptView() {}, async assertInboundEditReceipt() {} },
    '../print-jobs/print-jobs.reprint-intent': { async ensureReprintReceiptPermission() {}, async assertReprintReceiptScope() {} },
    './system.split-device': { async ensureSplitReceiptDevice() {} },
    '../inventory/inventory.split-receipt': { async assertSplitReceipt() {} },
    '../sale/sale.commercial-receipts': { async assertReceiptScope() {} },
    '../purchase-requisitions/purchase-requisitions.create-receipt': guard,
  }, transform)
  let error
  await controller.requestStatus({ params: { key: 'original-key' }, query: { action, warehouseId: '8', requestFingerprint: hash, userId: 999, scopeWarehouseIds: [999] }, user: { userId: 7, warehouseIds } }, {}, e => { error = e })
  return { error, sent, sqls }
}
test('真实system向PR回执传原key/仓/hash和可信actor，query不能伪造scope或actor', async () => {
  for (const warehouseIds of [[8], null]) {
    const result = await request({ warehouseIds })
    assert.equal(result.error, undefined); assert.equal(result.sent[0].data, data)
    assert.equal(result.sqls.length, 2); assert.deepEqual(Array.from(result.sqls[1].params.slice(0, 3)), ['original-key', 7, intent.ACTION])
    assert.ok(result.sqls.every(x => /^SELECT/.test(x.sql)))
  }
})
test('实际matched PR对宽query也先拒绝撤仓，403不被不同hash或缺hash遮住', async () => {
  for (const warehouseIds of [[], [9]]) for (const hash of [undefined, '0'.repeat(64)]) {
    const result = await request({ warehouseIds, action: 'purchase', hash })
    assert.equal(result.error?.statusCode, 403); assert.equal(result.sent.length, 0)
    assert.equal(result.sqls.length, 1)
  }
})
test('有仓权但宽query或不同原hash仍409，不能把原ACK完成为另一意图', async () => {
  for (const params of [{ action: 'purchase' }, { hash: '0'.repeat(64) }]) {
    const result = await request(params)
    assert.equal(result.error?.statusCode, 409); assert.equal(result.sent.length, 0)
  }
})
test('反向验证移除真实PR controller分发时既定403断言自然失败', async () => {
  const result = await request({ warehouseIds: [], transform: source => {
    const line = "      await require('../purchase-requisitions/purchase-requisitions.create-receipt').assertRequisitionCreateReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)"
    assert.equal(source.split(line).length, 2)
    return source.replace(line, '')
  } })
  assert.throws(() => assert.equal(result.error?.statusCode, 403), e => e.code === 'ERR_ASSERTION')
  assert.equal(result.sent.length, 1)
})
