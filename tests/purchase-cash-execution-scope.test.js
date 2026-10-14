'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const root = path.resolve(__dirname, '../backend/src')
function between(text, begin, end) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length)
  assert.ok(start >= 0 && finish > start)
  return text.slice(start, finish)
}
function setup() {
  const scopeText = fs.readFileSync(path.join(root, 'utils/warehouseScope.js'), 'utf8')
  const helperText = fs.readFileSync(path.join(root, 'modules/warehouse-tasks/warehouse-tasks.helpers.js'), 'utf8')
  let shipText = fs.readFileSync(path.join(root, 'modules/warehouse-tasks/warehouse-tasks.ship.js'), 'utf8')
  shipText = between(shipText, 'async function shipWithinTransaction(', 'async function ship(')
  if (process.env.PURCHASE_CASH_SCOPE_MUTANT === 'early') shipText = shipText.replace('if (purchaseReturnIdentity) assertTaskScope(purchaseReturnIdentity, { scopeWarehouseIds, pdaWarehouseId })', 'void 0')
  if (process.env.PURCHASE_CASH_SCOPE_MUTANT === 'proof') shipText = shipText.replace(', { cashProof: true }', '')
  const module = { exports: {} }, calls = []
  const scope = between(scopeText, 'function assertInScope(', '/** 全局设备')
  const helper = between(helperText, 'function assertTaskScope(', 'function logSideEffectFailure(')
  vm.runInNewContext(scope + '\n' + helper + '\n' + shipText + '\nmodule.exports=shipWithinTransaction', {
    module, AppError, lockPurchaseReturn: async (...args) => {
      calls.push(args)
      assert.equal(args[3]?.cashProof, true, 'Actual PR money proof must be requested before stock actions')
      throw new AppError('Fixture stops at the locked cash proof boundary', 409, 'CASH_PROOF_FIXTURE_STOP')
    },
  })
  return { run: module.exports, calls }
}
for (const [name, options, code] of [
  ['user warehouse', { scopeWarehouseIds: [9], pdaWarehouseId: 2 }, 'WAREHOUSE_SCOPE_DENIED'],
  ['device warehouse', { scopeWarehouseIds: [2], pdaWarehouseId: 9 }, 'PDA_WAREHOUSE_MISMATCH'],
]) {
  test(`exported ship function checks ${name} identity before its new cash proof boundary`, async () => {
    const { run, calls } = setup()
    await assert.rejects(() => run({}, 1, {}, null, { ...options, purchaseReturnIdentity: { id: 3, warehouse_id: 2 } }), error => error.statusCode === 403 && error.code === code)
    assert.equal(calls.length, 0, 'No original money row or proof is read before the identity gate')
  })
}
test('in-scope original source requests locked cash proof before any warehouse task or stock action', async () => {
  const { run, calls } = setup()
  await assert.rejects(() => run({}, 1, {}, null, { scopeWarehouseIds: [2], pdaWarehouseId: 2, purchaseReturnIdentity: { id: 3, warehouse_id: 2 } }), error => error.code === 'CASH_PROOF_FIXTURE_STOP')
  assert.equal(calls.length, 1)
})
