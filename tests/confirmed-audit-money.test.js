const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
function load(file, stubs) {
  const filename = path.resolve(__dirname, '../backend/src', file), module = { exports: {} }, fallback = createRequire(filename)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: id => id in stubs ? stubs[id] : fallback(id) })
  return module.exports
}
test('account refresh writes exact four decimal balance after signed accumulation', async () => {
  const svc = load('modules/finance/finance-accounts.service.js', { '../../config/db': {}, '../../utils/codeGenerator': {} })
  for (const [opening, delta, expected] of [['0.1','0.2','0.3000'],['-0.2','0.1','-0.1000'],['9999999999.9998','0.0001','9999999999.9999']]) {
    let saved
    await svc.refreshBalance({ query: async (sql, args) => {
      if (sql.includes('SELECT opening')) return [[{ opening_balance: opening }]]
      if (sql.includes('SELECT COALESCE')) return [[{ delta }]]
      saved = args[0]; return [{}]
    } }, 1)
    assert.equal(saved, expected)
  }
})
test('receipt allocations settle exactly and reject amounts finer than four decimals', async () => {
  for (const bad of [false, true]) {
    let receiptWrite, recordWrites = []
    const conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, query: async (sql, args) => {
      if (sql.includes('SELECT payment_date FROM payment_receipts')) return [[{ payment_date: '2026-09-27' }]]
      if (sql.includes('FROM payment_receipts')) return [[{ id: 1, receipt_no: 'RC', amount: '0.3', settled_amount: '0', status: 1, type: 2, party_name: 'test' }]]
      if (sql.includes('SELECT DISTINCT statement_id')) return [[]]
      if (sql.includes('FROM payment_records')) return [[{ id: args[0], order_no: 'SO', balance: args[0] === 1 ? '0.1' : '0.2', total_amount: args[0] === 1 ? '0.1' : '0.2', paid_amount: '0', type: 2, party_name: 'test', status: 1 }]]
      if (sql.startsWith('UPDATE payment_records')) recordWrites.push(args)
      if (sql.startsWith('UPDATE payment_receipts')) receiptWrite = args
      return [{ insertId: 1 }]
    } }
    const svc = load('modules/payments/payment-receipts.service.js', {
      '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/codeGenerator': {},
      '../../utils/operationRequest': { beginResourceOperationRequest: async () => ({}), completeOperationRequest: async () => {} },
      './party-identity': { assertAllocationParty: async () => {} }, './payment-events.service': { PAYMENT_EVENT: {}, record: async () => {} },
      './reconciliation-statements.service': {}, '../finance/finance-accounts.service': {},
      '../accounting/finance-period.guard': { assertFinancePeriodOpen: async () => ({}) },
    })
    const run = () => svc.settle(1, { allocations: [{ recordId: 1, amount: bad ? 0.1000001 : 0.1 }, { recordId: 2, amount: 0.2 }] }, {}, 'key')
    if (bad) await assert.rejects(run(), e => e.code === 'MONEY_PRECISION_INVALID')
    else {
      const result = await run()
      assert.equal(result.settledAmount, 0.3)
      assert.equal(result.balance, 0)
      assert.equal(receiptWrite[0], '0.3000')
      assert.equal(receiptWrite[1], '0.0000')
      assert.equal(recordWrites[0][0], '0.1000')
    }
  }
})
