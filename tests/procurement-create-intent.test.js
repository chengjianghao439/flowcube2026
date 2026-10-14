// Real domain functions with strict SQL fixtures; separate from the PC HTTP/MySQL runner.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const crypto = require('node:crypto')
const base = path.join(__dirname, '../backend/src')
const AppError = require('../backend/src/utils/AppError')
function load(file, deps, transform = s => s) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => {
    if (name === 'node:crypto') return crypto
    if (Object.hasOwn(deps, name)) return deps[name]
    throw Error(`Unstubbed ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const intent = load('modules/purchase-requisitions/purchase-requisitions.create-intent.js', { '../../utils/AppError': AppError })
const receipt = load('modules/purchase-requisitions/purchase-requisitions.create-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, './purchase-requisitions.create-intent': intent })
const wire = { warehouseId: 8, expectedDate: null, items: [{ productId: 3, quantity: 4, estimatedPrice: null, suggestedSupplierId: null }] }
const operator = { userId: 7, operatorId: 7, operatorName: 'SYNTHETIC', warehouseIds: [8] }
function prFixture({ legacy = false, candidates = null, headWarehouse = 8, applicantId = 7, status = 1 } = {}) {
  const events = [], sqls = [], completed = []
  const ack = { id: 21, requisitionNo: 'SYNTHETIC-PR21', estimatedAmount: 0, ...(legacy ? {} : { requestFingerprint: intent.requestFingerprint(wire), warehouseId: 8 }) }
  let rows = candidates ?? [{ id: 31, action: intent.ACTION, user_id: 7, status, response_json: JSON.stringify(ack), resource_type: 'purchase_requisition', resource_id: 21 }]
  const conn = {
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params = []) {
      sqls.push({ sql, params })
      if (sql.includes('FROM operation_requests')) return [rows]
      if (sql.includes('FROM purchase_requisitions WHERE id=')) return [[{ id: 21, requisition_no: 'SYNTHETIC-PR21', warehouse_id: headWarehouse, applicant_id: applicantId }]]
      if (sql.includes('FROM inventory_warehouses')) return [[{ id: 8, name: 'SYNTHETIC-W8' }]]
      if (sql.includes('FROM product_items')) return [[{ id: 3, code: 'SYNTHETIC-P3', name: 'SYNTHETIC', unit: '个', allow_decimal_qty: 0 }]]
      if (sql.includes('SUM(quantity')) return [[{ total: 0 }]]
      if (sql.startsWith('INSERT INTO purchase_requisitions')) return [{ insertId: 21 }]
      if (/^(INSERT|UPDATE|DELETE)/.test(sql)) { events.push('business-write'); return [{}] }
      throw Error(`Unstubbed SQL ${sql}`)
    },
  }
  const svc = load('modules/purchase-requisitions/purchase-requisitions.service.js', {
    '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/AppError': AppError,
    '../../utils/codeGenerator': { async generateDailyCode() { return 'SYNTHETIC-PR21' } }, '../../constants/documentStatusRules': {}, '../../utils/statusTransition': {}, '../../utils/warehouseScope': scope,
    '../../utils/operationRequest': {
      async beginOperationRequest(_db, args) { events.push('request'); assert.equal(args.action, intent.ACTION); return { enabled: !!args.requestKey, id: 31 } },
      async completeOperationRequest(_db, state, data) { completed.push({ state, ...data }); if (state.enabled) rows = [{ id: 31, action: intent.ACTION, user_id: 7, status: 1, response_json: JSON.stringify(data.data), resource_type: data.resourceType, resource_id: data.resourceId }] },
    },
    '../../utils/pagination': {}, '../../utils/qtyPrecision': { assertQtyPrecisionWith(_policy, qty) { assert.ok(Number.isInteger(qty)) } },
    '../procurement/procurement.planning': { async lockPlanning() { events.push('planning') } }, '../inventory/inventory.procurement': {}, '../procurement/procurement.policies': {}, '../../engine/approvalEngine': {}, '../../utils/selfApprove': {},
    './purchase-requisitions.create-intent': intent, './purchase-requisitions.create-receipt': receipt,
  })
  return { svc, conn, events, sqls, ack, completed }
}
const create = (f, body = wire, op = operator) => f.svc.create({ ...body, requestKey: 'original-key' }, op, { intentBody: body })
test('PR原validated wire hash保留缺字段/null/行顺序，忽略object键排序', () => {
  const same = { items: wire.items, expectedDate: null, warehouseId: 8 }
  assert.equal(intent.requestFingerprint(wire), intent.requestFingerprint(same))
  for (const body of [{ ...wire, source: 'manual' }, { ...wire, title: '' }, { warehouseId: 8, items: wire.items }, { ...wire, items: [{ ...wire.items[0], quantity: 6 }] }]) assert.notEqual(intent.requestFingerprint(body), intent.requestFingerprint(wire))
  const items = [wire.items[0], { productId: 4, quantity: 2 }]
  assert.notEqual(intent.requestFingerprint({ ...wire, items }), intent.requestFingerprint({ ...wire, items: [...items].reverse() }))
  assert.match(intent.requestFingerprint(wire), /^[a-f0-9]{64}$/)
})
test('PR候选准确绑定actor/key/domain当前S读，不按body分支生成action', async () => {
  const f = prFixture(); await create(f)
  const first = f.sqls[0]
  assert.match(first.sql, /user_id <=> \?/); assert.match(first.sql, /FOR SHARE$/)
  assert.deepEqual(Array.from(first.params.slice(0, 3)), ['original-key', 7, intent.ACTION])
  assert.equal(f.events.includes('request'), false)
  assert.ok(f.sqls.every(x => /^SELECT/.test(x.sql)))
  assert.deepEqual(f.events, ['begin', 'planning', 'rollback', 'release'])
})
test('PR同key不同原body409且业务无写，原ACK不能冒充新quantity', async () => {
  const f = prFixture()
  await assert.rejects(create(f, { ...wire, items: [{ ...wire.items[0], quantity: 6 }] }), e => e.code === 'PURCHASE_REQUISITION_CREATE_REQUEST_CONFLICT')
  assert.ok(f.sqls.every(x => /^SELECT/.test(x.sql))); assert.equal(f.completed.length, 0)
})
test('PR重放先核原/当前仓范围再hash，撤仓403不被conflict409遮住', async () => {
  for (const [warehouseIds, headWarehouse] of [[[], 8], [[9], 8], [[8], 9]]) {
    const f = prFixture({ headWarehouse })
    await assert.rejects(create(f, { ...wire, title: 'different' }, { ...operator, warehouseIds }), e => e.statusCode === 403 && e.code === 'WAREHOUSE_SCOPE_DENIED')
  }
  assert.equal((await create(prFixture(), wire, { ...operator, warehouseIds: null })).id, 21)
})
test('PR旧base/16无完整64及多个候选review，绝不另建', async () => {
  for (const f of [prFixture({ legacy: true }), prFixture({ candidates: [1, 2].map(id => ({ id, action: intent.ACTION + '.0123456789abcdef', status: 1 })) }), prFixture({ status: 0 })]) {
    await assert.rejects(create(f), e => e.code === 'PURCHASE_REQUISITION_CREATE_REVIEW_REQUIRED')
    assert.ok(f.sqls.every(x => /^SELECT/.test(x.sql)))
  }
})
test('PR错本人/资源身份failclosed，终态原创建ACK不重新校验创建资格', async () => {
  await assert.rejects(create(prFixture({ applicantId: 9 })), e => e.code === 'PURCHASE_REQUISITION_CREATE_RECEIPT_INVALID')
  const f = prFixture(); assert.equal((await create(f)).id, 21)
  assert.ok(f.sqls.filter(x => x.sql.includes('FROM purchase_requisitions')).every(x => !x.sql.includes('status') && !x.sql.includes('deleted_at')))
})
test('PR完整64不能缺原目标仓；原target与请求不一致failclosed', async () => {
  const f = prFixture(), data = successful(f)
  await assert.rejects(receipt.assertRequisitionCreateResult(f.conn, { ...data, data: { ...f.ack, warehouseId: undefined } }, null, { userId: 7 }), e => e.code === 'PURCHASE_REQUISITION_CREATE_RECEIPT_INVALID')
  await assert.rejects(receipt.assertRequisitionCreateResult(f.conn, data, [8], { userId: 7, warehouseId: 9 }), e => e.code === 'PURCHASE_REQUISITION_CREATE_REQUEST_CONFLICT')
  const moved = prFixture({ headWarehouse: 9 })
  await receipt.assertRequisitionCreateResult(moved.conn, successful(moved), [8, 9], { userId: 7, warehouseId: 8 })
  await assert.rejects(receipt.assertRequisitionCreateResult(moved.conn, successful(moved), [9], { userId: 7, warehouseId: 8 }), e => e.statusCode === 403)
})
test('PR新建固定base原validatedbody64，默认manual不进入hash；重复原量只1完成', async () => {
  const f = prFixture({ candidates: [] }); const first = await create(f)
  assert.equal(first.requestFingerprint, intent.requestFingerprint(wire)); assert.equal(first.warehouseId, 8)
  assert.equal((await create(f)).id, first.id); assert.equal(f.completed.length, 1)
  assert.equal(f.completed[0].resourceType, 'purchase_requisition')
  assert.ok(f.events.indexOf('planning') < f.events.indexOf('request'))
})
test('PR缺key兼容原ACK，无指纹并非幂等恢复承诺', async () => {
  const f = prFixture({ candidates: [] }), data = await f.svc.create(wire, operator, { intentBody: wire })
  assert.equal(data.requestFingerprint, undefined); assert.equal(data.warehouseId, undefined)
  assert.ok(!f.sqls.some(x => x.sql.includes('FROM operation_requests')))
})
test('PR真实controller只第三internal参数传validated body，header/key从既有解析器', async () => {
  let args
  const ctrl = load('modules/purchase-requisitions/purchase-requisitions.controller.js', {
    './purchase-requisitions.service': { async create(...received) { args = received; return {} } }, '../../utils/response': { successResponse() {} }, '../../utils/operator': { getOperatorFromRequest: () => operator }, '../../utils/requestKey': { extractRequestKey: () => 'header-key' },
  })
  await ctrl.create({ body: wire, user: { warehouseIds: [] } }, {}, e => { throw e })
  assert.equal(args[0].requestKey, 'header-key'); assert.equal(args[2].intentBody, wire); assert.deepEqual(args[1].warehouseIds, [])
})
function context() { return { matchedAction: intent.ACTION, requestedAction: intent.ACTION, requestedKey: 'original-key', requestedUserId: 7, requestedWarehouseId: 8, requestedFingerprint: intent.requestFingerprint(wire) } }
function successful(f) { return { status: 'success', resourceType: 'purchase_requisition', resourceId: 21, data: f.ack } }
test('PR GET exact本人/key/hash/原仓与当前仓，readonly且不新增VIEW', async () => {
  const f = prFixture(); await receipt.assertRequisitionCreateReceipt(f.conn, successful(f), [8], context())
  assert.ok(f.sqls.every(x => /^SELECT/.test(x.sql) && !x.sql.includes('FOR UPDATE')))
  for (const ids of [[], [9]]) await assert.rejects(receipt.assertRequisitionCreateReceipt(f.conn, successful(f), ids, context()), e => e.statusCode === 403)
  await assert.rejects(receipt.assertRequisitionCreateReceipt(f.conn, successful(f), [8], { ...context(), requestedFingerprint: '0'.repeat(64) }), e => e.code === 'PURCHASE_REQUISITION_CREATE_REQUEST_CONFLICT')
})
test('PR GET wide/缺64/旧无proof不能finishsuccess；pending/notfound不增权', async () => {
  for (const overrides of [{ requestedAction: 'purchase' }, { requestedFingerprint: undefined }, { requestedWarehouseId: undefined }, { requestedKey: undefined }]) {
    const f = prFixture(); await assert.rejects(receipt.assertRequisitionCreateReceipt(f.conn, successful(f), [8], { ...context(), ...overrides }), e => e.statusCode === 409)
  }
  const old = prFixture({ legacy: true }); await assert.rejects(receipt.assertRequisitionCreateReceipt(old.conn, successful(old), [8], context()), e => e.code === 'PURCHASE_REQUISITION_CREATE_REVIEW_REQUIRED')
  const f = prFixture()
  for (const status of ['not_found', 'pending', 'failed']) await receipt.assertRequisitionCreateReceipt(f.conn, { status }, [], context())
  await receipt.assertRequisitionCreateReceipt(f.conn, successful(f), [], { matchedAction: 'sale.create' })
  assert.equal(f.sqls.length, 0)
})
test('PR negativeguard：移除原body比较，既定不同意图409自然失败', async () => {
  const mutant = load('modules/purchase-requisitions/purchase-requisitions.create-intent.js', { '../../utils/AppError': AppError }, source => {
    const line = "  if (!FINGERPRINT.test(String(requested ?? '')) || stored !== requested) throw conflict()"
    assert.equal(source.split(line).length, 2); return source.replace(line, '')
  })
  await assert.rejects(async () => assert.throws(() => mutant.assertCreateFingerprint(intent.requestFingerprint(wire), intent.requestFingerprint({ ...wire, title: 'different' })), e => e.code === 'PURCHASE_REQUISITION_CREATE_REQUEST_CONFLICT'), e => e.code === 'ERR_ASSERTION')
})

const convert = load('modules/procurement/procurement.convert-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
const original = { planId: 21, planStatus: 3, createdOrders: [{ purchaseOrderId: 81, orderNo: 'SYNTHETIC-PO81', supplierId: 4, warehouseId: 8, itemCount: 2 }] }
function planFixture({ sourceWarehouse = 8, poWarehouse = 8, status = 2, missing = false } = {}) {
  const sqls = [], db = { async query(sql) {
    sqls.push(sql)
    if (sql.includes('FROM procurement_plans')) return [[{ id: 21 }]]
    if (sql.includes('FROM procurement_plan_items')) return [missing ? [] : [11, 12].map(id => ({ id, plan_id: 21, warehouse_id: sourceWarehouse, supplier_id: 4, status, purchase_order_id: 81 }))]
    if (sql.includes('FROM purchase_orders')) return [[{ id: 81, warehouse_id: poWarehouse, order_no: 'SYNTHETIC-PO81' }]]
    throw Error(sql)
  } }
  return { db, sqls, receipt: { status: 'success', resourceType: 'procurement_plan', resourceId: 21, data: original } }
}
test('Plan canonical64绑定plan/target/排序唯一selection，不绑定checkbox顺序', () => {
  const hash = convert.convertFingerprint(21, [12, 11, 12])
  assert.equal(hash, convert.convertFingerprint(21, [11, 12]))
  assert.equal(hash, crypto.createHash('sha256').update('{"itemIds":[11,12],"planId":21,"target":"purchase"}').digest('hex'))
  assert.notEqual(hash, convert.convertFingerprint(22, [11, 12])); assert.notEqual(hash, convert.convertFingerprint(21, [11])); assert.notEqual(hash, convert.convertFingerprint(21, [11, 12], 'requisition'))
})
test('Plan legacy原converted IDs+完整PO证明后派生64，只响应不写history', async () => {
  const f = planFixture(), proof = await convert.assertConvertResult(f.db, f.receipt, [8], { lock: true })
  assert.deepEqual(Array.from(proof), [11, 12])
  const ack = convert.bindConvertResult(original, proof, convert.convertFingerprint(21, [12, 11]))
  assert.match(ack.requestFingerprint, /^[a-f0-9]{64}$/); assert.equal(original.requestFingerprint, undefined)
  assert.ok(f.sqls.every(sql => /^SELECT/.test(sql) && /FOR SHARE/.test(sql)))
})
test('Plan new/legacy GET strict64 exactscope，原scope403先于异body409', async () => {
  const ctx = { matchedAction: 'procurement.plan.convert.21', requestedAction: 'procurement.plan.convert.21', requestedFingerprint: convert.convertFingerprint(21, [11, 12]) }
  const f = planFixture(); await convert.assertConvertReceipt(f.db, f.receipt, [8], ctx); assert.equal(f.receipt.data.requestFingerprint, ctx.requestedFingerprint)
  for (const opts of [{ sourceWarehouse: 9 }, { poWarehouse: 9 }]) await assert.rejects(convert.assertConvertReceipt(planFixture(opts).db, planFixture(opts).receipt, [8], { ...ctx, requestedFingerprint: '0'.repeat(64) }), e => e.statusCode === 403)
  for (const [key, value] of [['requestedAction', 'procurement'], ['requestedFingerprint', '0'.repeat(64)]]) await assert.rejects(convert.assertConvertReceipt(planFixture().db, planFixture().receipt, [8], { ...ctx, [key]: value }), e => e.code === 'PROCUREMENT_CONVERT_REQUEST_CONFLICT')
})
test('Plan旧GET无hash保留原ACK与范围；新stored64必须等actualproof', async () => {
  const f = planFixture(); await convert.assertConvertReceipt(f.db, f.receipt, [8], { matchedAction: 'procurement.plan.convert.21' }); assert.equal(f.receipt.data, original)
  assert.throws(() => convert.bindConvertResult({ ...original, requestFingerprint: '0'.repeat(64) }, [11, 12], convert.convertFingerprint(21, [11, 12])), e => e.code === 'PROCUREMENT_CONVERT_RECEIPT_INVALID')
  for (const opts of [{ missing: true }, { status: 1 }]) await assert.rejects(convert.assertConvertResult(planFixture(opts).db, planFixture(opts).receipt, [8]), e => e.code === 'PROCUREMENT_CONVERT_RECEIPT_INVALID')
})
test('Plan converted明细真实service不可编辑；删除该守卫负向断言自然失败', async () => {
  function fixture(mutated = false) {
    const sqls = [], conn = { async beginTransaction() {}, async rollback() {}, async commit() {}, release() {}, async query(sql) {
      sqls.push(sql)
      if (sql.startsWith('SELECT')) return [[{ id: 11, plan_id: 21, warehouse_id: 8, status: 2, product_id: 3 }]]
      if (sql.startsWith('UPDATE procurement_plan_items')) return [{}]
      throw Error(sql)
    } }
    const svc = load('modules/procurement/procurement.service.js', {
      '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/AppError': AppError, '../../utils/warehouseScope': scope,
      '../../utils/statusTransition': { async lockStatusRow() { return { id: 21, status: 2 } } }, '../../constants/documentStatusRules': { assertStatusAction() {} }, '../../utils/operationRequest': {}, '../../utils/codeGenerator': {}, '../inventory/inventory.procurement': {}, '../purchase/purchase.service': {},
      './procurement.planning': { async lockPlanning() {} }, '../../utils/backendTime': {}, './procurement.policies': {}, '../../utils/pagination': {}, '../../utils/qtyPrecision': { assertQtyScale() {}, async assertQtyPrecision() {} },
    }, source => {
      // The unrelated refresh GET is a read fixture; the mutation removes only
      // the real converted-line write guard that establishes legacy proof.
      const line = 'Number(item.status) === ITEM_STATUS.CONVERTED'
      if (mutated) { assert.equal(source.split(line).length, 2); source = source.replace(line, 'false') }
      return source + '\ngetPlan = async () => ({})\n'
    })
    return { svc, sqls }
  }
  const f = fixture(); await assert.rejects(f.svc.updatePlanItem(21, 11, { adjustedQty: 6 }, [8]), e => e.statusCode === 400 && /不能再修改/.test(e.message))
  assert.ok(f.sqls.every(sql => sql.startsWith('SELECT')))
  const mutant = fixture(true)
  await assert.rejects(async () => assert.rejects(mutant.svc.updatePlanItem(21, 11, { adjustedQty: 6 }, [8]), e => e.statusCode === 400), e => e.code === 'ERR_ASSERTION')
  assert.ok(mutant.sqls.some(sql => sql.startsWith('UPDATE procurement_plan_items')))
})
test('Plan negativeguard：移除selection比对，不同意图409断言自然失败', () => {
  const mutant = load('modules/procurement/procurement.convert-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope }, source => {
    const line = "  if (!FINGERPRINT.test(String(requestedFingerprint ?? '')) || requestedFingerprint !== fingerprint) throw conflict()"
    assert.equal(source.split(line).length, 2); return source.replace(line, '')
  })
  assert.throws(() => assert.throws(() => mutant.bindConvertResult(original, [11, 12], convert.convertFingerprint(21, [13])), e => e.code === 'PROCUREMENT_CONVERT_REQUEST_CONFLICT'), e => e.code === 'ERR_ASSERTION')
})
