'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { assertPeriodComplete } = require('../backend/src/modules/accounting/accounting.period-completeness')
const actualSources = require('../backend/src/modules/inbound-tasks/inbound-purchase-source')
const { SOURCE_TYPES, DIR } = require('../backend/src/constants/voucherSource')
const AppError = require('../backend/src/utils/AppError')
const PERIOD = '208706'

function setup({ currentInvalid = false, currentDate = '2087-06-10', external = true } = {}, mutant = process.env.B7_ACCOUNTING_SCOPE_MUTANT === 'unscoped') {
  const f = { checked: [], queries: [], rows: [{ poId: 30, order_no: 'current', vdate: currentDate, gross: '100.0000', supplier_id: 1, supplier_name: 'Synthetic' }] }
  if (external) f.rows.push({ poId: 31, order_no: 'old', vdate: '2087-05-10', gross: '100.0000', supplier_id: 1, supplier_name: 'Synthetic' })
  let text = fs.readFileSync(path.join(__dirname, '../backend/src/modules/accounting/voucher-engine.js'), 'utf8')
  const begin = text.indexOf('async function buildPurchaseSettle('), end = text.indexOf('\n/**\n * 事件2', begin)
  assert.ok(begin > 0 && end > begin)
  text = text.slice(begin, end)
  if (mutant) {
    const original = text
    text = text.replace('WHERE pr.type = 1 AND pr.order_id IS NOT NULL${orderFilter}', 'WHERE pr.type = 1 AND pr.order_id IS NOT NULL')
    assert.notEqual(text, original, 'Mutation must remove the actual production SQL source filter')
  }
  const module = { exports: {} }
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  vm.runInNewContext(text + '\nmodule.exports=buildPurchaseSettle', { module, AppError, SOURCE_TYPES, DIR, Number, Set, Array, round2, require: name => {
    assert.equal(name, '../inbound-tasks/inbound-purchase-source')
    return actualSources
  } })
  const spec = { sourceType: 'purchase_settle', sourceId: 30, voucherDate: '2087-06-10', legs: [
    { code: '1405', direction: 1, amount: 100, summary: '采购入库' },
    { code: '2202', direction: 2, amount: 100, auxType: 1, auxId: 1, auxName: 'Synthetic', summary: '应付账款' },
  ] }
  const hashSpec = (date, legs) => JSON.stringify([date, legs])
  const engine = { buildPurchaseSettle: module.exports, buildFundVouchers: async () => [], buildUnbilledPayable: async () => [],
    loadTaxMaps: async () => ({ taxByPO: new Map() }), loadAccountMap: async () => new Map([['1405', { id: 1 }], ['2202', { id: 2 }]]),
    toDateStr: date => String(date).slice(0, 10), round2, hashSpec }
  const header = { id: 1, company_id: 1, source_type: 'purchase_settle', source_id: 30, source_period: '', source_root_id: null, reversed_id: null, is_reversal: 0,
    status: 1, period: PERIOD, voucher_date: spec.voucherDate, source_hash: hashSpec(spec.voucherDate, spec.legs), total_debit: 100, total_credit: 100 }
  const conn = { async query(sql, params = []) {
    f.queries.push({ sql, params })
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql), 'Completeness must remain read only')
    if (/FROM acct_voucher_entries e JOIN/.test(sql)) return [spec.legs.map((leg, index) => ({ ...leg, voucher_id: 1, account_id: index + 1, auxType: leg.auxType || 0, auxId: leg.auxId || null, auxName: leg.auxName || null }))]
    if (/FROM acct_vouchers/.test(sql)) return [[header]]
    if (/SELECT t.id,t.biz_type/.test(sql)) return [[]]
    if (/SELECT pr.id,pr.order_id/.test(sql)) return [f.rows.map(r => ({ id: r.poId, order_id: r.poId, created_at: r.vdate, source_order_id: r.poId }))]
    if (/pr.order_id AS poId/.test(sql)) return [sql.includes('pr.order_id IN (?)') ? f.rows.filter(r => Array.from(params[0]).includes(r.poId)) : f.rows]
    if (/FROM inbound_task_items i/.test(sql)) {
      const id = Number(params[0]); f.checked.push(id)
      return [[{ purchase_order_id: id, purchase_item_id: 1, product_id: 7, source_item_id: id === 31 || currentInvalid ? null : 1, source_order_id: id, source_product_id: 7 }]]
    }
    if (/FROM inventory_containers/.test(sql)) return [[]]
    throw Error('Unexpected SQL ' + sql)
  } }
  return { f, conn, engine }
}

test('current correct purchase closes despite external-period invalid source; real source validator executes only current source', async () => {
  const { f, conn, engine } = setup()
  await assertPeriodComplete(conn, PERIOD, 1, engine)
  assert.deepEqual(f.checked, [30])
})
test('current invalid source remains refused even when a balanced voucher exists', async () => {
  const { conn, engine } = setup({ currentInvalid: true })
  await assert.rejects(() => assertPeriodComplete(conn, PERIOD, 1, engine), e => e.code === 'INBOUND_PURCHASE_SOURCE_INVALID')
})
test('current-period voucher keeps moved-date purchase relevant to source validation', async () => {
  const { f, conn, engine } = setup({ currentInvalid: true, currentDate: '2087-05-10', external: false })
  await assert.rejects(() => assertPeriodComplete(conn, PERIOD, 1, engine), e => e.code === 'INBOUND_PURCHASE_SOURCE_INVALID')
  assert.deepEqual(f.checked, [30])
})
test('scoped empty builder never validates unrelated sources; unscoped generation still validates all', async () => {
  const { f, conn, engine } = setup()
  assert.equal((await engine.buildPurchaseSettle(conn, new Map(), { orderIds: [] })).length, 0)
  assert.deepEqual(f.checked, [])
  await assert.rejects(() => engine.buildPurchaseSettle(conn, new Map()), e => e.code === 'INBOUND_PURCHASE_SOURCE_INVALID')
  assert.deepEqual(f.checked, [30, 31])
})
test('removing actual SQL order filter restores the external-period source failure', async () => {
  const { conn, engine } = setup({}, true)
  await assert.rejects(() => assertPeriodComplete(conn, PERIOD, 1, engine), e => e.code === 'INBOUND_PURCHASE_SOURCE_INVALID')
})
