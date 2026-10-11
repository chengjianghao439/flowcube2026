'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
function verify(src) {
  assert.match(src, /--change-records\) DB_NAME='flowcube_changerecords20261010_test'/)
  const lane = src.match(/elif \[\[ "\$SUITE" = '--change-records' \]\]; then([\s\S]*?)\nelse/)
  assert.ok(lane, '审计交接必须有独占命名分支')
  assert.match(lane[1], /run_smoke smoke:change-records-runtime/)
  assert.match(lane[1], /FLOWCUBE_CHANGE_REGRESSIONS/)
  assert.match(lane[1], /run_smoke smoke:change-records-regressions/)
  assert.doesNotMatch(lane[1], /purchase-repair|receivable|go-live-runtime/)
  for (const proof of ['127.0.0.1::3306', 'RUNNER_PID=$$', 'SELECT @@server_uuid', 'mode: 0o600', "flag: 'wx'", 'container_exists "$CTR_ID"', 'volume_exists "$VOL"']) assert.ok(src.includes(proof), proof)
}
test('审计交接实库只能通过完整归属runner的命名分支', () => {
  verify(fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').replace(/^\s*#.*$/gm, ''))
})
test('删掉专属入口或替换为旧清库套件会被拒绝', () => {
  const src = fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').replace(/^\s*#.*$/gm, '')
  verify(src)
  assert.throws(() => verify(src.replace('run_smoke smoke:change-records-runtime', ':')))
  assert.throws(() => verify(src.replace('run_smoke smoke:change-records-runtime', 'run_smoke smoke:purchase-repair')))
  assert.throws(() => verify(src.replace('run_smoke smoke:change-records-regressions', ':')))
})

function verifyCi(source) {
  const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
  const job = yaml.load(source).jobs['change-records-owned']
  assert.ok(job)
  const run = job.steps.find(step => step.run === 'npm run smoke:change-records-owned')
  assert.ok(run, 'CI 必须通过完整归属入口执行')
  assert.equal(String(run.env?.FLOWCUBE_CHANGE_REGRESSIONS), '1', 'CI 必须启用原业务回归')
}
test('CI 实际 owned job 同时执行变更场景和原业务回归，删入口或停用回归均被拒绝', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
  verifyCi(source)
  assert.throws(() => verifyCi(source.replace('run: npm run smoke:change-records-owned', 'run: true')))
  assert.throws(() => verifyCi(source.replace("FLOWCUBE_CHANGE_REGRESSIONS: '1'", "FLOWCUBE_CHANGE_REGRESSIONS: '0'")))
})
