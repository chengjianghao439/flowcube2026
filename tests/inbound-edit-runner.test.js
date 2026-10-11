'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const source = () => fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').replace(/^\s*#.*$/gm, '')
function assertInboundLane(src) {
  assert.match(src, /--inbound-edit\) DB_NAME='flowcube_inboundedit20261010_test'/)
  assert.match(src, /RESOURCE_ARGS=\(--memory 768m --memory-swap 768m --cpus 1\)/)
  const lane = src.match(/elif \[\[ "\$SUITE" = '--inbound-edit' \]\]; then([\s\S]*?)\nelse/)
  assert.ok(lane, '收货编辑必须拥有独立分支')
  assert.match(lane[1], /run_smoke smoke:inbound-edit-runtime/)
  assert.doesNotMatch(lane[1], /purchase-repair|receivable|go-live-runtime|party-profile/)
  for (const proof of ['127.0.0.1::3306', 'flowcube.repair.batch', 'flowcube.repair.role', 'RUNNER_PID=$$', 'SELECT @@server_uuid', 'mode: 0o600', "flag: 'wx'", 'container_exists "$CTR_ID"', 'volume_exists "$VOL"']) assert.ok(src.includes(proof), proof)
}
test('收货编辑只使用原归属 runner 的专属数据库和独立CI入口', () => {
  assertInboundLane(source())
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['test:inbound-edit'], 'node --test tests/inbound-task-edit.test.js tests/inbound-task-edit-contract.test.js tests/inbound-task-edit-receipt.test.js tests/inbound-task-edit-sources.test.js tests/inbound-task-edit-create.test.js tests/inbound-edit-runner.test.js tests/inbound-create-idempotency.test.js')
  assert.equal(pkg.scripts['smoke:inbound-edit-runtime'], 'node --test --test-concurrency=1 tests/inbound-edit-runtime.smoke.test.js')
  assert.equal(pkg.scripts['smoke:inbound-edit-owned'], 'bash scripts/repair-smoke-ephemeral.sh --inbound-edit')
  const wf = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
  assert.match(wf, /inbound-edit-owned:/)
  assert.match(wf, /run: npm run smoke:inbound-edit-owned/)
  assert.match(wf, /run: npm run test:inbound-edit/)
})
test('删除收货入口、改成旧修复套件会使契约失败', () => {
  assertInboundLane(source())
  assert.throws(() => assertInboundLane(source().replace('run_smoke smoke:inbound-edit-runtime', ':')))
  assert.throws(() => assertInboundLane(source().replace('run_smoke smoke:inbound-edit-runtime', 'run_smoke smoke:purchase-repair')))
})
test('未知模式和额外参数在任何Docker调用前拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-runner-reject-'))
  try {
    const marker = path.join(dir, 'called')
    fs.writeFileSync(path.join(dir, 'docker'), '#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 3\n', { mode: 0o755 })
    for (const args of [['--unknown'], ['--inbound-edit', '--extra']]) {
      const r = spawnSync('bash', ['scripts/repair-smoke-ephemeral.sh', ...args], { cwd: root, env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, DOCKER_MARKER: marker }, encoding: 'utf8', timeout: 5000 })
      assert.notEqual(r.status, 0)
      assert.match(r.stdout + r.stderr, /unsupported.*suite/i)
      assert.equal(fs.existsSync(marker), false)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('真实夹具先用完整实时归属门，再导入app和写种子；禁止隐藏启动与加载真实env', () => {
  const source = fs.readFileSync(path.join(root, 'tests/helpers/inboundEditRuntimeFixture.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const setup = source.slice(source.indexOf('ctx.setup = async () =>'), source.indexOf('ctx.product = async'))
  const guard = setup.indexOf('await assertOwnedRepairInstance(conn, { config })')
  assert.ok(guard >= 0)
  assert.ok(guard < setup.indexOf('await ctx.insert('))
  assert.ok(guard < setup.indexOf("require('../../backend/src/app')"))
  assert.match(setup, /app\.listen\(0, '127\.0\.0\.1'/)
  assert.doesNotMatch(source, /require\([^\n]*(dotenv|server\.js|scheduler)/)
  assert.doesNotMatch(source, /assertOwnedRepairInstance\([^\n]*(probe|stub)/)
  assert.doesNotMatch(source, /process\.exit\(/)
  assert.match(source, /ctx\.apiPool\.end\(\)/)
  assert.match(source, /ctx\.pool\.end\(\)/)
  assert.match(source, /data_lock_waits/)
})
