'use strict'
// No DB/config/app imports. Actual builders/service execute against a strict SQL boundary.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const AppError = require('../backend/src/utils/AppError')
const source = require('../backend/src/constants/voucherSource')
const { assertPeriodComplete } = require('../backend/src/modules/accounting/accounting.period-completeness')
const lock = require('../backend/src/modules/accounting/accounting.period-lock')
const base = path.join(__dirname, '../backend/src/modules/accounting')
const period = '209805', date = '2098-05-10'

function compile(file, requires, transform = s => s) {
  const module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(file, 'utf8')), { module, exports: module.exports, require: name => {
    if (!Object.hasOwn(requires, name)) throw Error('Unapproved require in offline test: ' + name)
    return requires[name]
  }, Map, Set, Date, JSON, Number, String, Object, BigInt, Array, Math }, { filename: file })
  return module.exports
}
function nativeEngine() {
  return compile(path.join(base, 'voucher-engine.js'), {
    crypto, '../../utils/AppError': AppError, '../../utils/logger': { info() {}, warn() {} },
    '../../constants/voucherSource': source, './voucher-sale-periods': { SALE_TYPES: [] },
    './accounting.period-lock': lock, './voucher-source-revisions': {}, './voucher-sale-money': {},
    '../../utils/backendTime': { beijingTodayYmd: d => d.toISOString().slice(0, 10) },
    '../inbound-tasks/inbound-purchase-source': { assertPurchaseSettlementSources: async () => {} },
  })
}
function fixture() {
  return { funds: [], payables: [], purchase: [], manual: [], headers: [], entries: [], pl: [], queries: [], events: [],
    accounts: ['1001', '1002', '1122', '2202', '1405', '222101', '6001', '6601', '6602', '4103'].map((code, i) => ({ id: i + 1, code, name: code })), allowWrites: false }
}
function incoming(f, overrides = {}) {
  f.funds.push({ id: 11, biz_type: 1, direction: 1, amount: '100.0000', happened_at: date,
    voucher_date_override: null, source_account_id: 9, source_account_type: 1, biz_no: 'B6-source', party_name: 'Synthetic party', ...overrides })
}
function connection(f) {
  return {
    async query(sql, params = []) {
      f.queries.push({ sql, params })
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        assert.ok(f.allowWrites, 'Completeness must stay read-only: ' + sql)
        return [{ insertId: 900 }]
      }
      if (/FROM acct_companies/.test(sql)) { f.events.push('company-X'); return [[{ id: params[0] }]] }
      if (/FROM acct_periods/.test(sql)) return [[]]
      if (/SELECT a.code, a.name, a.category/.test(sql)) return [f.pl]
      if (/SELECT id, source_hash, status FROM acct_vouchers/.test(sql)) return [[].concat(f.closing || [])]
      if (/FROM acct_voucher_entries e JOIN acct_vouchers v/.test(sql)) {
        assert.equal(params[0], 1)
        return [f.entries.filter(e => f.headers.some(h => h.id === e.voucher_id && h.company_id === 1))]
      }
      if (/FROM acct_vouchers/.test(sql)) {
        assert.equal(params[0], 1); assert.match(sql, /FOR UPDATE/)
        return [f.headers.filter(h => h.company_id === 1)]
      }
      if (/SELECT t.id,t.biz_type/.test(sql)) { f.events.push('ordinary-snapshot'); return [f.funds] }
      if (/t.id AS txnId/.test(sql)) return [f.funds.filter(t => t.source_account_id != null).map(t => ({
        txnId: t.id, biz_type: t.biz_type, amount: t.amount, biz_no: t.biz_no, party_name: t.party_name,
        vdate: t.happened_at, vdate_override: t.voucher_date_override, acctType: t.source_account_type,
      }))]
      if (/SELECT pr.id,pr.order_id/.test(sql)) return [f.payables]
      if (/pr.order_id AS poId/.test(sql)) return [f.purchase]
      if (/pr.debit_account_code,/.test(sql)) return [f.manual]
      if (/FROM fin_invoices/.test(sql)) return [[]]
      if (/SELECT id, code, name FROM acct_accounts/.test(sql)) return [f.accounts]
      throw Error('Unexpected offline SQL: ' + sql)
    },
    async beginTransaction() { f.events.push('begin') }, async commit() { f.events.push('commit') },
    async rollback() { f.events.push('rollback') }, release() { f.events.push('release') },
  }
}
function book(f, engine, spec, { id = 1, root = null, reversed = null, status = 1, reversal = 0 } = {}) {
  const legs = spec.legs.map(l => ({ ...l, amount: engine.round2(l.amount) })).filter(l => l.amount > 0)
  f.headers.push({ id, company_id: 1, source_type: spec.sourceType, source_id: root || reversal ? null : spec.sourceId,
    source_root_id: root, reversed_id: reversed, is_reversal: reversal, source_period: '', status,
    period, voucher_date: spec.voucherDate, source_hash: engine.hashSpec(engine.toDateStr(spec.voucherDate), legs),
    total_debit: legs.filter(l => l.direction === 1).reduce((s, l) => s + l.amount, 0),
    total_credit: legs.filter(l => l.direction === 2).reduce((s, l) => s + l.amount, 0) })
  for (const leg of legs) f.entries.push({ ...leg, voucher_id: id, account_id: f.accounts.find(a => a.code === leg.code).id,
    auxType: leg.auxType || 0, auxId: leg.auxId || null, auxName: leg.auxName || null })
}
const rejectsVoucher = fn => assert.rejects(fn, e => e.statusCode === 409 && e.code === 'ACCT_BUSINESS_VOUCHER_REQUIRED')
const rejectsSource = fn => assert.rejects(fn, e => e.statusCode === 409 && e.code === 'ACCT_BUSINESS_SOURCE_INVALID')

for (const [biz_type, direction] of [[1, 1], [2, 2], [3, 2], [5, 2]]) {
  test('FIN01 actual fund builder biz ' + biz_type + ': missing rejected, full accepted', async () => {
    const f = fixture(), engine = nativeEngine(), conn = connection(f)
    incoming(f, { biz_type, direction })
    await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
    const specs = await engine.buildFundVouchers(conn); assert.equal(specs.length, 1)
    book(f, engine, specs[0]); await assertPeriodComplete(conn, period, 1, engine)
    assert.ok(f.queries.every(q => !/^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql)))
  })
}
test('FIN01 missing leg rejected despite unchanged source hash and header totals', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f)
  book(f, engine, (await engine.buildFundVouchers(conn))[0]); f.entries.pop()
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 stale business amount and stale hash rejected independently', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f)
  book(f, engine, (await engine.buildFundVouchers(conn))[0]); f.funds[0].amount = '101.0000'
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
  f.funds[0].amount = '100.0000'; f.headers[0].source_hash = 'old'
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 actual manual red offsets are counted, never restore positive source', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f)
  const spec = (await engine.buildFundVouchers(conn))[0]
  book(f, engine, spec, { status: 3 })
  book(f, engine, { ...spec, sourceType: 'manual', legs: spec.legs.map(l => ({ ...l, direction: l.direction === 1 ? 2 : 1 })) }, { id: 2, reversed: 1, reversal: 1 })
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 tiny fund uses original zero-cent projection; no zero voucher required', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f, { amount: '0.0001' })
  assert.equal((await engine.buildFundVouchers(conn)).length, 0)
  await assertPeriodComplete(conn, period, 1, engine)
})
test('FIN01 orphan transaction/account and invalid direction fail closed before builder JOIN', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f, { source_account_id: null })
  await rejectsSource(() => assertPeriodComplete(conn, period, 1, engine))
  f.funds[0].source_account_id = 9; f.funds[0].direction = 2
  await rejectsSource(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 existing source voucher with missing original fund fails closed', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f)
  book(f, engine, (await engine.buildFundVouchers(conn))[0]); f.funds = []
  await rejectsSource(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 posting override belongs to posting month; original month unchanged', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f)
  incoming(f, { happened_at: '2098-04-10', voucher_date_override: date })
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
  await assertPeriodComplete(conn, '209804', 1, engine)
  assert.equal(f.funds[0].happened_at, '2098-04-10')
})
test('FIN01 ledger company filter cannot be satisfied by another company voucher', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f)
  book(f, engine, (await engine.buildFundVouchers(conn))[0]); f.headers[0].company_id = 2
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 AP builders: purchase gross and classified manual; NULL classification remains excluded', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f)
  f.payables = [{ id: 20, order_id: 30, created_at: date, source_order_id: 30 }, { id: 21, order_id: null, created_at: date, debit_account_code: '6601', is_freight: 0 }, { id: 22, order_id: null, created_at: date, debit_account_code: null }]
  f.purchase = [{ poId: 30, order_no: 'B6-PO', vdate: date, supplier_id: 40, supplier_name: 'Supplier', gross: '100.0000' }]
  f.manual = [{ id: 21, vdate: date, total_amount: '50.0000', debit_account_code: '6601', is_freight: 0, party_name: 'Supplier' }]
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
  for (const s of [...await engine.buildPurchaseSettle(conn, new Map()), ...await engine.buildUnbilledPayable(conn)]) book(f, engine, s, { id: f.headers.length + 1 })
  await assertPeriodComplete(conn, period, 1, engine)
})
test('FIN01 purchase immutable automatic revision chain is compared by net, then stale changed source rejected', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f)
  f.payables = [{ id: 20, order_id: 30, created_at: date, source_order_id: 30 }]
  f.purchase = [{ poId: 30, vdate: date, gross: 80 }]
  const current = (await engine.buildPurchaseSettle(conn, new Map()))[0]
  const old = { ...current, legs: current.legs.map(l => ({ ...l, amount: 100 })) }
  book(f, engine, old, { status: 3 })
  book(f, engine, { ...old, legs: old.legs.map(l => ({ ...l, direction: l.direction === 1 ? 2 : 1 })) }, { id: 2, root: 1, reversed: 1, reversal: 1 })
  book(f, engine, current, { id: 3, root: 1 })
  await assertPeriodComplete(conn, period, 1, engine)
  f.purchase[0].gross = 79
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
})
test('FIN01 zeroed purchase auto-reversal remains valid after source disappearance', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f)
  const spec = { sourceType: 'purchase_settle', sourceId: 30, voucherDate: date, legs: [{ code: '1405', direction: 1, amount: 100 }, { code: '2202', direction: 2, amount: 100, auxType: 1 }] }
  book(f, engine, spec, { status: 3 })
  book(f, engine, { ...spec, legs: spec.legs.map(l => ({ ...l, direction: l.direction === 1 ? 2 : 1 })) }, { id: 2, root: 1, reversed: 1, reversal: 1 })
  await assertPeriodComplete(conn, period, 1, engine)
})
test('FIN01 auxiliary identity corruption rejected without trusting source hash', async () => {
  const f = fixture(), engine = nativeEngine(), conn = connection(f); incoming(f)
  book(f, engine, (await engine.buildFundVouchers(conn))[0]); f.entries[1].auxType = 0
  await rejectsVoucher(() => assertPeriodComplete(conn, period, 1, engine))
})
function periodService(f, engine) {
  const conn = connection(f)
  const facade = { ...engine, assertSalePeriodCurrent: async () => f.events.push('sale-proof'),
    upsertVoucher: async (_conn, spec) => {
      f.closingSpec = spec
      f.closing = { id: 900, status: 1, source_hash: engine.hashSpec(spec.voucherDate, spec.legs) }
      return { created: true, id: 900 }
    } }
  return compile(path.join(base, 'accounting.period.service.js'), {
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../utils/logger': { info() {} }, '../../utils/backendTime': { beijingTodayYmd: () => date },
    './voucher-engine': facade, '../../constants/voucherSource': source, './accounting.period-lock': lock,
    './accounting.period-completeness': { assertPeriodComplete }, './voucher-supplier-refunds': { assertPeriodCurrent: async () => f.events.push('RF-proof') },
  }, code => process.env.B6_ACCOUNTING_MUTANT === 'FIN01' ? code.replace("    await require('./accounting.period-completeness').assertPeriodComplete(conn, p, companyId, engine)\n", '')
    : process.env.B6_ACCOUNTING_MUTANT === 'FIN03' ? code.replace('  // 净利润为零仍须结平非零损益科目；仅省略没有金额的 4103 差额腿。', '  else return null') : code)
}
test('FIN01 actual closePeriod holds company X before first snapshot and rolls back missing ordinary source', async () => {
  const f = fixture(), engine = nativeEngine(); incoming(f); f.allowWrites = true
  await rejectsVoucher(() => periodService(f, engine).closePeriod(period, {}, 1))
  assert.ok(f.events.indexOf('company-X') < f.events.indexOf('ordinary-snapshot'))
  assert.ok(f.events.includes('rollback')); assert.ok(!f.events.includes('commit'))
  assert.ok(f.queries.every(q => !/INSERT INTO acct_periods/.test(q.sql)))
})
for (const expense of [100, 99, 0]) {
  test('FIN03 actual service generation income/expense ' + (expense ? '100/' + expense : '0/0'), async () => {
    const f = fixture(), engine = nativeEngine(); f.allowWrites = true
    if (expense) f.pl = [{ code: '6001', name: '收入', category: 5, d: 0, c: 100 }, { code: '6601', name: '费用', category: 6, d: expense, c: 0 }]
    const r = await periodService(f, engine).generateClosingVouchers(period, 1, 1)
    if (!expense) { assert.equal(r.generated, 0); assert.equal(r.status.pl, 'not_required'); return }
    assert.equal(r.status.pl, 'current'); assert.equal(f.closingSpec.legs.length, expense === 100 ? 2 : 3)
    assert.equal(f.closingSpec.legs.some(l => l.code === '4103'), expense !== 100)
    assert.equal(f.closingSpec.legs.find(l => l.code === '6001').direction, 1)
    assert.equal(f.closingSpec.legs.find(l => l.code === '6601').direction, 2)
    assert.equal(engine.assertBalanced(f.closingSpec.legs).debit, 100)
  })
}
