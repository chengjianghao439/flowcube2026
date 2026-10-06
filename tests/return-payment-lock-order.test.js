// Real helpers and statement projection; all SQL/event boundaries are offline.
// Reverse: reject statement-before-payment or remove current projection option => failures below.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.resolve(__dirname, '../backend/src')
const unknown = []
afterEach(() => { assert.deepEqual(unknown.splice(0), []) })
function load(file, deps) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    unknown.push(`require ${file}: ${name}`); throw Error(`Unstubbed require ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
function fixture({ movedMember = false, movedRecord = false, paid = 20, projectionRows, snapshotEmpty = false, currentExists = true, recordType = 1 } = {}) {
  const events = [], updates = [], sqls = []
  const record = { id: 5, type: recordType, order_id: 10, order_no: recordType === 2 ? 'SO10' : 'PO10', total_amount: 100, paid_amount: paid }
  const conn = { query: async (sql, params = []) => {
    sqls.push(sql)
    if (sql.includes('FROM payment_records WHERE')) {
      if (sql.includes('FOR UPDATE')) { events.push('AP'); return [[{ ...record, id: movedRecord ? 6 : 5 }]] }
      if (sql.includes('FOR SHARE')) { events.push('currentPresence'); return [currentExists ? [{ ...record }] : []] }
      events.push('peek'); return [snapshotEmpty ? [] : [{ ...record }]]
    }
    if (/SELECT (?:DISTINCT )?statement_id/.test(sql)) {
      const members = movedMember && /FOR SHARE|FOR UPDATE/.test(sql) ? [2, 20] : [2, 10]
      return [members.map(statement_id => ({ statement_id }))]
    }
    if (sql.includes('FROM reconciliation_statements') && sql.includes('FOR UPDATE')) { events.push(`stmt:${params[0]}`); return [[{ id: params[0], status: 2 }]] }
    if (sql.includes('FROM reconciliation_statement_items i')) {
      if (/FOR SHARE|FOR UPDATE/.test(sql)) return [projectionRows || [{ total_amount: 90, paid_amount: paid }, { total_amount: 40, paid_amount: 10 }]]
      return [[{ total: 999, paid: 0 }]] // RR read view established before a lock wait.
    }
    if (sql.includes('SELECT status FROM reconciliation_statements')) return [[{ status: 2 }]]
    if (sql.includes('UPDATE payment_records')) { events.push('writeAP'); updates.push(params); return [{ affectedRows: 1 }] }
    if (sql.includes('UPDATE reconciliation_statements')) { events.push('projection'); updates.push(params); return [{ affectedRows: 1 }] }
    unknown.push(`SQL ${sql}`); throw Error(`Unexpected SQL ${sql}`)
  } }
  const statements = load('modules/payments/reconciliation-statements.service.js', {
    '../../config/db': {}, '../../utils/AppError': AppError,
    '../../utils/codeGenerator': {}, '../../utils/decimalMoney': require('../backend/src/utils/decimalMoney'), '../../constants/settlementType': { SETTLEMENT_TYPE: { MONTHLY: 2 } }, '../../utils/pagination': {},
  })
  const helpers = load('modules/returns/returns.helpers.js', {
    '../../utils/AppError': AppError, '../../utils/codeGenerator': {},
    '../payments/payment-events.service': { PAYMENT_EVENT: {}, record: async actual => { assert.equal(actual, conn); events.push('event') } },
    '../payments/reconciliation-statements.service': statements, '../../utils/requestContext': { getRequestId: () => null },
  })
  return { conn, helpers, statements, events, updates, sqls }
}
const input = { recordType: 1, orderId: 10, orderNo: 'PO10', returnNo: 'PR11', returnType: 'purchase', amount: 10, operator: { userId: 9 } }
test('return adjustment locks all statements ascending before current AP; original money and event preserved', async () => {
  const f = fixture()
  const result = await f.helpers.adjustPaymentRecordForReturn(f.conn, input)
  assert.deepEqual(f.events.filter(e => e.startsWith('stmt') || e === 'AP'), ['stmt:2', 'stmt:10', 'AP'])
  assert.equal(result.newTotal, 90); assert.equal(result.newBalance, 70)
  assert.equal(f.updates[0][0], 90); assert.equal(f.updates[0][3], 5)
  assert.ok(f.events.includes('event'))
})
test('statement membership drift after AP wait rejects without locking a new statement or writing money', async () => {
  const f = fixture({ movedMember: true })
  await assert.rejects(f.helpers.adjustPaymentRecordForReturn(f.conn, input), e => e.code === 'RETURN_PAYMENT_CONTEXT_CHANGED')
  assert.ok(!f.events.includes('stmt:20')); assert.equal(f.updates.length, 0)
})
test('latest payment identity drift rejects without applying return to another record', async () => {
  const f = fixture({ movedRecord: true })
  await assert.rejects(f.helpers.adjustPaymentRecordForReturn(f.conn, input), e => e.code === 'RETURN_PAYMENT_CONTEXT_CHANGED')
  assert.equal(f.updates.length, 0)
})
test('return refresh uses current complete member rows after locks rather than old RR aggregate', async () => {
  const f = fixture()
  await f.helpers.adjustPaymentRecordForReturn(f.conn, input)
  const projections = f.updates.slice(1)
  assert.equal(projections.length, 2)
  for (const args of projections) { assert.equal(args[0], 130); assert.equal(args[1], 30); assert.equal(args[2], 100) }
})
test('paid80 / total100 / return30 still fails before money or projection writes', async () => {
  const f = fixture({ paid: 80 })
  await assert.rejects(f.helpers.adjustPaymentRecordForReturn(f.conn, { ...input, amount: 30 }), e => e.statusCode === 409)
  assert.equal(f.updates.length, 0)
  await assert.rejects(f.helpers.assertReturnPaymentHeadroom(f.conn, { ...input, amount: 30 }), e => e.statusCode === 409)
})
test('other statement refresh callers retain their original aggregate/default read contract', async () => {
  const f = fixture()
  const result = await f.statements.refreshSettlement(f.conn, 2)
  assert.equal(result.total, 999)
  assert.ok(!f.sqls.some(sql => /FOR SHARE|FOR UPDATE/.test(sql)))
})
test('current member projection retains four-decimal monetary totals instead of binary summation tails', async () => {
  const f = fixture({ projectionRows: [{ total_amount: '0.1000', paid_amount: '0.1000' }, { total_amount: '0.2000', paid_amount: '0.2000' }] })
  const result = await f.statements.refreshSettlement(f.conn, 2, { currentRead: true })
  assert.equal(result.total, 0.3); assert.equal(result.paid, 0.3)
  assert.equal(f.updates[0][0], 0.3); assert.equal(f.updates[0][1], 0.3)
})
const saleInput = { ...input, recordType: 2, orderNo: 'SO10', returnNo: 'SR11', returnType: 'sale' }
test('ordinary sale return empty RR identity but current AR exists rejects before statements, money or events', async () => {
  const f = fixture({ snapshotEmpty: true, recordType: 2 })
  await assert.rejects(f.helpers.adjustPaymentRecordForReturn(f.conn, saleInput), e => e.code === 'RETURN_PAYMENT_CONTEXT_CHANGED')
  assert.deepEqual(f.events, ['peek', 'currentPresence'])
  assert.equal(f.updates.length, 0)
  assert.ok(f.sqls.every(sql => sql.includes('FROM payment_records WHERE')))
})
test('ordinary sale return truly missing current AR retains null and performs no writes or statement locks', async () => {
  const f = fixture({ snapshotEmpty: true, currentExists: false, recordType: 2 })
  assert.equal(await f.helpers.adjustPaymentRecordForReturn(f.conn, saleInput), null)
  assert.deepEqual(f.events, ['peek', 'currentPresence'])
  assert.equal(f.updates.length, 0)
  assert.ok(f.sqls.every(sql => sql.includes('FROM payment_records WHERE')))
})

test('PR explicit headroom opt-in supplies exact RF source; ordinary sale/manual or no exact PO retain old unstructured 409', async () => {
  const f = fixture({ paid: 80 })
  await assert.rejects(f.helpers.assertReturnPaymentHeadroom(f.conn, { ...input, amount: 30, purchaseReturnId: 11 }), e => {
    assert.equal(e.code, 'PURCHASE_RETURN_REFUND_REQUIRED')
    assert.equal(e.data.purchaseReturnId, 11); assert.equal(e.data.purchaseOrderId, 10)
    assert.match(e.message, /负余额/); return e.statusCode === 409
  })
  for (const variant of [{ ...saleInput, purchaseReturnId: 11 }, { ...input }, { ...input, orderId: null, purchaseReturnId: 11 }, { ...input, recordType: 0, purchaseReturnId: 11 }]) {
    await assert.rejects(f.helpers.assertReturnPaymentHeadroom(f.conn, { ...variant, amount: 30 }), e => e.statusCode === 409 && !e.code && !e.data)
  }
  assert.equal(f.updates.length, 0)
})
