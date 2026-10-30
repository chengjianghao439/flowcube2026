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
  assert.notEqual(hash, convert.convertFingerprint(22, [11, 12])); assert.notEqual(hash, convert.convertFingerprint(21, [11])); assert.notEqual(hash, convert.convertFingerprint(21, [11, 12], 'unsupported'))
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
