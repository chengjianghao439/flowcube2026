'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const plain = value => JSON.parse(JSON.stringify(value))
const row = (code, category, balance_dir, d, c) => ({
  code, name: code, category, balance_dir, d: String(d), c: String(c),
})
const normal = amount => [row('1601', 1, 1, amount, 0), row('2202', 2, 2, 0, amount)]
const depreciated = (cost, depreciation) => [
  ...normal(cost), row('1602', 1, 2, 0, depreciation), row('660203', 6, 1, depreciation, 0),
]

function reports(byCompany = { 1: [] }, failure = null) {
  const calls = []
  const pool = { query: async (sql, params = []) => {
    calls.push({ sql, params: plain(params) })
    assert.match(sql, /^\s*SELECT\b/i, 'fixture must never permit writes')
    if (failure) throw failure
    if (sql.includes('FROM acct_companies')) {
      return [Object.keys(byCompany).map(id => ({ id: Number(id), code: `C${id}`, name: `合成账套${id}` }))]
    }
    assert.match(sql, /FROM acct_accounts a/)
    assert.match(sql, /a\.company_id\s*=\s*\?/)
    assert.match(sql, /a\.is_leaf\s*=\s*1/)
    return [plain(byCompany[Number(params.at(-1))] || [])]
  } }
  function load(name, overrides = {}) {
    const filename = path.join(__dirname, '../backend/src/modules/accounting/', name)
    const real = createRequire(filename), module = { exports: {} }
    let source = fs.readFileSync(filename, 'utf8')
    if (process.env.ACCOUNTING_REPORT_MUTANT === 'natural_asset') {
      const marker = 'const assetAmount = round2(Number(r.d) - Number(r.c))'
      assert.equal(source.split(marker).length - 1, 1, 'mutation must replace exactly one asset calculation')
      source = source.replace(marker, 'const assetAmount = b')
    }
    vm.runInNewContext(source, {
      module, console,
      require: id => id === '../../config/db' ? { pool } : Object.hasOwn(overrides, id) ? overrides[id] : real(id),
    }, { filename })
    return module.exports
  }
  const ledger = load('accounting.ledger.service.js')
  const group = load('consolidation.service.js', { './accounting.ledger.service': { periodRange: ledger.periodRange } })
  return {
    calls,
    single: companyId => ledger.getBalanceSheet({ period: '202610', companyId }),
    group: () => group.getConsolidatedBalanceSheet({ period: '202610', groupId: 1 }),
  }
}

const cases = [
  { name: 'empty', rows: [], asset: 0, liability: 0, equity: 0 },
  { name: 'ordinary asset', rows: normal(100), asset: 100, liability: 100, equity: 0 },
  { name: 'depreciation reduces asset', rows: depreciated(100, 10), asset: 90, liability: 100, equity: -10, contra: -10 },
  { name: 'negative net asset stays visible', rows: depreciated(10, 12), asset: -2, liability: 10, equity: -12, contra: -12 },
  { name: 'credit asset balance stays negative', rows: [row('1002', 1, 1, 0, 10), row('2202', 2, 2, 10, 0)], asset: -10, liability: -10, equity: 0 },
  { name: 'cent amounts retain two-place result', rows: depreciated(100.01, 0.01), asset: 100, liability: 100.01, equity: -0.01, contra: -0.01 },
  { name: 'reversed depreciation nets to zero', rows: [...normal(100), row('1602', 1, 2, 10, 10), row('660203', 6, 1, 10, 10)], asset: 100, liability: 100, equity: 0 },
]
function check(result, expected) {
  assert.equal(result.assetTotal, expected.asset)
  assert.equal(result.liabTotal, expected.liability)
  assert.equal(result.equityTotal, expected.equity)
  assert.equal(result.liabEquityTotal, expected.asset)
  assert.equal(result.balanced, true)
  if (expected.contra !== undefined) assert.equal(result.assets.find(x => x.code === '1602')?.amount, expected.contra)
}
for (const kind of ['single', 'group']) for (const sample of cases) {
  test(`${kind}: ${sample.name}`, async () => {
    const f = reports({ 1: sample.rows })
    const result = kind === 'single' ? await f.single(1) : await f.group()
    check(result, sample)
    assert.equal(f.calls.length, kind === 'single' ? 1 : 2)
  })
}
test('company isolation and grouped sum both retain contra-asset sign', async () => {
  const f = reports({ 1: depreciated(100, 10), 2: depreciated(200, 20) })
  check(await f.single(1), { asset: 90, liability: 100, equity: -10, contra: -10 })
  check(await f.single(2), { asset: 180, liability: 200, equity: -20, contra: -20 })
  check(await f.group(), { asset: 270, liability: 300, equity: -30, contra: -30 })
})
for (const kind of ['single', 'group']) test(`${kind}: read error never becomes a zero success`, async () => {
  const f = reports({ 1: normal(100) }, Error('CONTROLLED_REPORT_READ_FAILURE'))
  await assert.rejects(kind === 'single' ? f.single(1) : f.group(), /CONTROLLED_REPORT_READ_FAILURE/)
})
