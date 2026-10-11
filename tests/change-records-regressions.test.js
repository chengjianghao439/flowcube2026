'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runRegressions } = require('./helpers/changeRecordsRegressions')
const fs = require('node:fs'), path = require('node:path')

test('每个回归进程启动前重新核对归属，按顺序执行', async () => {
  const observed = []
  await runRegressions({
    files: ['first.js', 'second.js'],
    proveOwnership: async () => { observed.push('proof') },
    runSuite: async file => { observed.push(file) },
  })
  assert.deepEqual(observed, ['proof', 'first.js', 'proof', 'second.js'])
})

test('归属失效时不启动下一进程，原样报告拒绝', async () => {
  let checked = 0
  const ran = []
  await assert.rejects(runRegressions({
    files: ['first.js', 'second.js'],
    proveOwnership: async () => { if (++checked === 2) throw Error('ownership expired') },
    runSuite: async file => { ran.push(file) },
  }), /ownership expired/)
  assert.deepEqual(ran, ['first.js'])
})

test('首个回归失败立即中止，不执行后续测试', async () => {
  const ran = []
  await assert.rejects(runRegressions({
    files: ['first.js', 'second.js'],
    proveOwnership: async () => {},
    runSuite: async file => { ran.push(file); throw Error('suite failure') },
  }), /suite failure/)
  assert.deepEqual(ran, ['first.js'])
})

test('既有取货退回套件的专属入口在夹具写入前核归属，不能只凭库名放行', () => {
  const text = fs.readFileSync(path.join(__dirname, 'pick-cancel-return.smoke.test.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  function verify(source) {
    assert.ok(source.includes("process.env.DB_NAME === 'flowcube_changerecords20261010_test'"))
    assert.match(source, /!\[3306,3307\]\.includes\(config\.port\)/)
    const main = source.slice(source.indexOf('async function main()'))
    assert.ok(main.indexOf('await require(\'./helpers/repairInstanceOwnership\').assertOwnedRepairInstance') >= 0)
    assert.ok(main.indexOf('assertOwnedRepairInstance') < main.indexOf('prepareSmokeContext('))
  }
  verify(text)
  assert.throws(() => verify(text.replace('assertOwnedRepairInstance(conn, { config })', 'unused(conn, { config })')))
  assert.throws(() => verify(text.replace('![3306,3307].includes(config.port)', 'true')))
})
