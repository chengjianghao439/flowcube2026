'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createFixture, listen, payload } = require('./helpers/pdaAuditLogApiFixture')

for (const kind of ['error', 'undo']) {
  for (const character of ['A', '码', '🙂']) {
    test(`${kind}: accepts exactly 64 ${character} characters unchanged`, async () => {
      const f = createFixture(async () => [{ affectedRows: 1 }]), http = await listen(f)
      try {
        const barcode = character.repeat(64), response = await http.post(kind, payload(kind, barcode))
        assert.equal(response.status, 201); assert.equal(response.body.success, true)
        assert.equal(f.inserts.length, 1)
        assert.equal(f.inserts[0].params[kind === 'error' ? 1 : 2], barcode)
      } finally { await http.close() }
    })
    for (const length of [65, 80]) test(`${kind}: rejects ${length} ${character} characters before SQL`, async () => {
      const f = createFixture(async () => [{ affectedRows: 1 }]), http = await listen(f)
      try {
        const response = await http.post(kind, payload(kind, character.repeat(length)))
        assert.equal(response.status, 400); assert.equal(response.body.success, false)
        assert.match(response.body.message, /条码.*64.*字符/)
        assert.equal(f.inserts.length, 0)
      } finally { await http.close() }
    })
  }
  test(`${kind}: explicit API reports an INSERT failure, never recorded success`, async () => {
    const f = createFixture(async () => { throw Object.assign(new Error('synthetic missing table'), { code: 'ER_NO_SUCH_TABLE' }) })
    const http = await listen(f)
    try {
      const response = await http.post(kind, payload(kind, 'VALID'))
      assert.equal(response.status, 500); assert.equal(response.body.success, false)
      assert.equal(response.body.code, 'DB_TABLE_MISSING')
      assert.doesNotMatch(response.body.message, /已记录/)
      assert.equal(f.inserts.length, 1)
    } finally { await http.close() }
  })
  test(`${kind}: shared optional logger still returns normally on write failure`, async () => {
    const error = new Error('synthetic write failure'), f = createFixture(async () => { throw error })
    const method = kind === 'error' ? 'logScanError' : 'logUndo'
    await f.service[method](payload(kind, 'VALID'))
    assert.equal(f.inserts.length, 1); assert.equal(f.warnings.length, 1)
    await assert.rejects(f.service[method](payload(kind, 'VALID'), { strict: true }), value => value === error)
  })
}

test('API runtime CI bridge refuses disconnected aliases, workflow or runner', () => {
  const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8')
  const pkg = JSON.parse(read('package.json')), workflow = read('.github/workflows/test.yml'), runner = read('scripts/repair-smoke-ephemeral.sh')
  const policy = read('tests/deployment-resources.test.js')
  const start = policy.indexOf('  const isReached = (name) => {'), end = policy.indexOf('  const testScripts =', start)
  assert.ok(start >= 0 && end > start)
  function reached(scripts = pkg.scripts, workflowText = workflow, runnerText = runner) {
    const module = { exports: null }
    vm.runInNewContext(policy.slice(start, end) + "\nmodule.exports = isReached('smoke:pda-audit-log-api-runtime')", {
      module, pkg: { scripts }, workflowText, matrixSuites: new Set(), root, path,
      fs: { readFileSync(file) { assert.equal(file, path.join(root, 'scripts/repair-smoke-ephemeral.sh')); return runnerText } },
    })
    return module.exports
  }
  assert.equal(reached(), true)
  assert.equal(reached({ ...pkg.scripts, 'smoke:pda-audit-log-api-owned': 'bash scripts/repair-smoke-ephemeral.sh --wrong-suite' }), false)
  assert.equal(reached(pkg.scripts, workflow.replaceAll('npm run smoke:pda-audit-log-api-owned', 'npm run absent-suite')), false)
  assert.equal(reached(pkg.scripts, workflow, runner.replace('run_smoke smoke:pda-audit-log-api-runtime', 'run_smoke absent-suite')), false)
})
