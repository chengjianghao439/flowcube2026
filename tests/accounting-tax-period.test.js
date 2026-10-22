const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

function fixture() {
  const calls = []
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 1 }] } }
  function load(filename) {
    const module = { exports: {} }, requireReal = createRequire(filename)
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports,
      require(name) {
        if (name === '../../config/db') return { pool }
        if (name === './accounting.ledger.service') return load(path.join(path.dirname(filename), 'accounting.ledger.service.js'))
        return requireReal(name)
      },
    }, { filename })
    return module.exports
  }
  return { service: load(path.join(__dirname, '../backend/src/modules/accounting/accounting.tax.service.js')), calls }
}
for (const period of ['202600', '202613', '20261']) {
  for (const method of ['getVatReport', 'getIncomeTaxReport', 'upsertAdjustment']) {
    test(`${method} rejects invalid tax period ${period} before SQL`, async () => {
      const f = fixture()
      await assert.rejects(f.service[method]({ companyId: 7, period, taxType: 1, adjustItem: '合成调整', amount: 1.23 }, 9), error => error.statusCode === 400)
      assert.equal(f.calls.length, 0)
    })
  }
}
test('valid tax adjustment retains company, period, amount and operator', async () => {
  const f = fixture()
  const result = await f.service.upsertAdjustment({ companyId: 7, period: '202602', taxType: 2, adjustItem: ' 合成调整 ', amount: 1.23 }, 9)
  assert.equal(result.period, '202602')
  assert.equal(f.calls.length, 1)
  assert.deepEqual(Array.from(f.calls[0].params), [7, '202602', 2, '合成调整', 1.23, null, 9])
})
