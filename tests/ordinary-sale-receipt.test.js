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
    '../../utils/batch-receipts': require('../backend/src/utils/batch-receipts'),
    './sale.release-batches': require('../backend/src/modules/sale/sale.release-batches'),
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

test('占库回执的事件锚点需关联同一原销售单，且撤仓先于事件读取', async () => {
  const f = fixture()
  const original = { ...receipt('reserve'), data: { reservationEventId: 92 } }
  const context = { requestedAction: 'sale.reserve:21', matchedAction: 'sale.reserve:21' }
  const events = []
  f.db.query = async (sql, params) => {
    assert.match(sql, /FROM sale_order_events.*sale_order_id.*event_type/s)
    events.push(params)
    return [params[0] === 92 && params[1] === 21 ? [{ id: 92 }] : []]
  }
  await f.guard.assertOrdinarySaleReceipt(f.db, original, [8], context)
  assert.equal(events.length, 1)
  await assert.rejects(f.guard.assertOrdinarySaleReceipt(f.db, original, [9], context), e => e.code === 'WAREHOUSE_SCOPE_DENIED')
  assert.equal(events.length, 1)
  await assert.rejects(f.guard.assertOrdinarySaleReceipt(f.db, { ...original, data: { reservationEventId: 93 } }, [8], context),
    e => e.code === 'SALE_OPERATION_RECEIPT_INVALID')
})

test('分次补占只认同单、同行、原批次及成功回执，并保留已知进度', async () => {
  const { releaseBatches, canSupplementRelease } = require('../backend/src/modules/sale/sale.release-batches')
  const lines = qty => [{ itemId: 14, warehouseId: 8, qty, unit: '个' }]
  const released = (id, qty) => ({ id, event_type: 'released', payload_json: { released: lines(qty) } })
  const reserved = (id, batch, qty, actor) => ({ id, event_type: 'reserved', created_by: actor, created_by_name: '同事' + actor,
    payload_json: { reserved: lines(qty), supplement: { releaseId: batch, receiptId: id + 100 } } })
  const receiptRow = (id, batch, qty, actor) => ({ id: id + 100, user_id: actor, action: 'sale.reserve:21', status: 1,
    resource_type: 'sale_order', resource_id: 21, response_json: { reservationEventId: id, releaseEventId: batch, reserved: lines(qty) } })
  const first = receiptRow(12, 10, 1, 7), second = receiptRow(14, 10, 2, 8), third = receiptRow(15, 13, 1, 9)
  let receipts = [first, second, third]
  const db = { query: async (sql, [ids]) => {
    assert.match(sql, /FROM operation_requests.*FOR SHARE/s)
    return [receipts.filter(row => ids.includes(row.id))]
  } }
  const events = [released(10, 4), reserved(12, 10, 1, 7), released(13, 2), reserved(14, 10, 2, 8), reserved(15, 13, 1, 9)]
  const [one, two] = await releaseBatches(db, 21, events, [8], true)
  assert.deepEqual([one, two].map(batch => [batch.lines[0].remaining, batch.supplements.map(row => row.id)]), [[1, [12, 14]], [1, [15]]])
  const request = { id: 14, warehouseId: 8, unit: '个', reserveQty: 1 }
  assert.equal(canSupplementRelease(one, [request]), true)
  assert.equal(canSupplementRelease(one, [{ ...request, reserveQty: 2 }]), false)
  assert.equal(canSupplementRelease(one, [request, request]), false)
  assert.deepEqual(await releaseBatches(db, 21, events, [9], true), [])
  receipts = [{ ...first, user_id: 8 }, second, third]
  const [unverified] = await releaseBatches(db, 21, events, [8], true)
  assert.deepEqual(unverified.issue, { id: 12, reason: 'receipt', check: 'mismatch', movement: lines(1) })
  assert.deepEqual(unverified.supplements.map(row => row.id), [14])
  assert.equal(unverified.lines[0].remaining, null)
  assert.equal(canSupplementRelease(unverified, [request]), false)
})

test('批次疑点隔离 占库回执待核只冻结有持久来源的原批，冲突或无归属再扩大范围', async () => {
  const { releaseBatches, canSupplementRelease } = require('../backend/src/modules/sale/sale.release-batches')
  const lines = qty => [{ itemId: 14, warehouseId: 8, qty, unit: '个' }]
  const rows = [
    { id: 10, event_type: 'released', payload_json: { released: lines(3) } },
    { id: 11, event_type: 'released', payload_json: { released: lines(4) } },
    { id: 12, event_type: 'reserved', created_by: 7, created_by_name: '销售甲', payload_json: { reserved: lines(1), supplement: { releaseId: 10, receiptId: 112 } } },
    { id: 13, event_type: 'reserved', created_by: 8, created_by_name: '销售乙', payload_json: { reserved: lines(2), supplement: { releaseId: 11, receiptId: 113 } } },
  ]
  const ack = (event, actor, source, qty) => ({ id: event + 100, user_id: actor, action: 'sale.reserve:21', status: 1,
    resource_type: 'sale_order', resource_id: 21, response_json: { reservationEventId: event, releaseEventId: source, reserved: lines(qty) } })
  const good = ack(13, 8, 11, 2)
  let receipts = [good]
  const db = { query: async () => [receipts] }
  const read = (events = rows) => releaseBatches(db, 21, events, [8], true)
  for (const first of [null, ack(12, 7, 10, 2)]) {
    receipts = [good, ...(first ? [first] : [])]
    const [a, b] = await read()
    assert.deepEqual(a.issue, { id: 12, reason: 'receipt', check: first ? 'mismatch' : 'missing', movement: lines(1) })
    assert.equal(a.lines[0].remaining, null)
    assert.deepEqual(b.supplements.map(row => row.id), [13])
    assert.equal(b.lines[0].remaining, 2)
    assert.equal(canSupplementRelease(b, [{ id: 14, unit: '个', warehouseId: 8, reserveQty: 2 }]), true)
  }
  receipts = [good, ack(12, 7, 11, 1)]
  assert.deepEqual((await read()).map(row => row.issue?.id), [12, 12])
  receipts = [good]
  const unassigned = rows.map(row => row.id === 12 ? { ...row, payload_json: { reserved: lines(1) } } : row)
  assert.deepEqual((await read(unassigned)).map(row => row.issue?.id), [12, 12])
})

test('交叉更正 占库逐笔保留疑点和同批有效办理，不把存疑量先扣给任一批', async () => {
  const { releaseBatches } = require('../backend/src/modules/sale/sale.release-batches')
  const lines = qty => [{ itemId: 14, warehouseId: 8, qty, unit: '个' }]
  const released = (id, qty) => ({ id, event_type: 'released', payload_json: { released: lines(qty) } })
  const movement = (id, source, qty, actor = 7) => ({ id, event_type: 'reserved', created_by: actor,
    created_by_name: '经办' + actor, payload_json: { reserved: lines(qty), supplement: { releaseId: source, receiptId: 100 + id } } })
  const ack = (id, source, qty, actor = 7) => ({ id: 100 + id, user_id: actor, status: 1, action: 'sale.reserve:21',
    resource_type: 'sale_order', resource_id: 21, response_json: { reservationEventId: id, releaseEventId: source, reserved: lines(qty) } })
  const events = [released(10, 3), released(11, 3), released(12, 3),
    movement(13, 10, 2), movement(14, 10, 2), movement(15, 10, 2, 8), movement(16, 12, 1, 9)]
  const independent = [ack(15, 10, 2, 8), ack(16, 12, 1, 9)]
  const db = receipts => ({ query: async () => [receipts] })
  const check = receipts => releaseBatches(db(receipts), 21, events, [8], true)
  const [a, b, c] = await check([ack(13, 11, 2), ack(14, 11, 2), ...independent])
  assert.deepEqual([a, b, c].map(row => row.issues?.map(issue => [issue.id, issue.reason]) ?? []),
    [[[13, 'conflict'], [14, 'conflict']], [[13, 'conflict'], [14, 'conflict']], []])
  assert.deepEqual(a.supplements.map(row => row.id), [15])
  assert.equal(a.lines[0].remaining, null)
  assert.equal(c.lines[0].remaining, 2)
  const [a2] = await check([ack(13, 11, 2), ...independent])
  assert.notEqual(a2.proofVersion, a.proofVersion)
  assert.match(a.supplements[0].proofVersion, /^[0-9a-f]{64}$/)
  assert.equal(a2.supplements[0].proofVersion, a.supplements[0].proofVersion)
  const [overfull] = await check([ack(13, 10, 2), ...independent])
  assert.deepEqual(overfull.issues.map(issue => [issue.id, issue.reason]), [[13, 'capacity'], [14, 'receipt'], [15, 'capacity']])
  assert.deepEqual(overfull.supplements, [])
  const future = await releaseBatches(db([ack(13, 14, 2)]), 21, [released(10, 3), movement(13, 14, 2), released(14, 3)], [8], true)
  assert.deepEqual(future.map(row => [row.issue?.id, row.issue?.reason]), [[13, 'sequence'], [13, 'sequence']])
})

test('完批改归 占库优先保留来源未更正的同事回执，准确列出超量事件', async () => {
  const { releaseBatches, canSupplementRelease } = require('../backend/src/modules/sale/sale.release-batches')
  const lines = qty => [{ itemId: 14, warehouseId: 8, qty, unit: '个' }]
  const release = id => ({ id, event_type: 'released', batch_proof_revision: 0, payload_json: { released: lines(3) } })
  const row = (id, batch, amount, revision) => ({ id, event_type: 'reserved', created_by: 7, created_by_name: '同事',
    batch_proof_revision: revision, payload_json: { reserved: lines(amount), supplement: { releaseId: batch, receiptId: 100 + id } } })
  const ack = (id, batch, amount, revision) => ({ id: 100 + id, user_id: 7, status: 1, action: 'sale.reserve:21',
    resource_type: 'sale_order', resource_id: 21, batch_proof_revision: revision,
    response_json: { reservationEventId: id, releaseEventId: batch, reserved: lines(amount) } })
  const unchanged = [row(14, 10, 2, 0), row(15, 10, 1, 0)]
  const stableAcks = [ack(14, 10, 2, 1), ack(15, 10, 1, 1)]
  const read = (batchId, qty, origins = [release(10), release(11)], hasAck = true) =>
    releaseBatches({ query: async () => [hasAck ? [...stableAcks, ack(13, batchId, qty, 3)] : stableAcks] },
      21, [...origins, row(13, batchId, qty, 1), ...unchanged], [8], true)
  for (const qty of [1, 4]) {
    const [closed, available] = await read(10, qty)
    assert.deepEqual(closed.issues.map(issue => issue.id), [13])
    assert.deepEqual(closed.issue.excess, lines(qty))
    assert.deepEqual(closed.issue.movement, lines(qty))
    assert.match(closed.issue.proofVersion, /^[0-9a-f]{64}$/)
    assert.deepEqual(closed.supplements.map(movement => movement.id), [14, 15])
    assert.equal(closed.lines[0].remaining, null)
    assert.equal(closed.lines[0].confirmedRemaining, 0)
    assert.equal(canSupplementRelease(closed, [{ id: 14, warehouseId: 8, unit: '个', reserveQty: 1 }]), false)
    assert.equal(available.lines[0].remaining, 3)
  }
  const [larger] = await read(10, 2)
  const [smaller] = await read(10, 1)
  assert.notEqual(larger.issue.proofVersion, smaller.issue.proofVersion)
  const [recovered, next] = await read(11, 1)
  assert.equal(recovered.lines[0].remaining, 0)
  assert.deepEqual(next.supplements.map(movement => movement.id), [13])
  assert.equal(next.lines[0].remaining, 2)
  const [editedSource] = await read(10, 1, [{ ...release(10), batch_proof_revision: 1 }, release(11)])
  assert.deepEqual(editedSource.issues.map(issue => issue.id), [13, 14, 15])
  assert.deepEqual(editedSource.supplements, [])
  const otherWithNoProof = await read(10, 4, undefined, false)
  assert.deepEqual(otherWithNoProof.map(batch => batch.issue?.id), [13, 13])
})
