'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
test('unknown ephemeral suite is rejected before any Docker operation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-runner-rejection-'))
  try {
    const marker = path.join(dir, 'docker-called')
    fs.writeFileSync(path.join(dir, 'docker'), '#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 3\n', { mode: 0o755 })
    const result = spawnSync('bash', ['scripts/repair-smoke-ephemeral.sh', '--unknown'], {
      cwd: root, env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, DOCKER_MARKER: marker }, encoding: 'utf8', timeout: 5000,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /unsupported.*suite/i)
    assert.equal(fs.existsSync(marker), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('go-live uses the original owned-instance runner and isolated CI job', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['smoke:go-live-runtime'], 'node --test --test-concurrency=1 tests/db-session-timezone.smoke.test.js tests/go-live-runtime.smoke.test.js')
  assert.equal(pkg.scripts['smoke:go-live-owned'], 'bash scripts/repair-smoke-ephemeral.sh --go-live')
  const script = fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').replace(/^\s*#.*$/gm, '')
  assert.match(script, /DB_NAME='flowcube_golive20261006_test'/)
  assert.match(script, /run_smoke smoke:go-live-runtime/)
  assert.match(script, /mysql --protocol=TCP --host=127\.0\.0\.1 --port=3306 --connect-timeout=2/)
  assert.match(script, /MYSQL_PWD="\$ROOT_PW".*\$CTR_ID.*mysql/)
  assert.match(script, /-e 'SELECT 1'/)
  assert.doesNotMatch(script, /mysqladmin ping/)
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
  assert.match(workflow, /go-live-owned:/)
  assert.match(workflow, /run: npm run smoke:go-live-owned/)
})

function assertPartyCapacityLane(source) {
  const blocks = [...source.replace(/^\s*#.*$/gm, '').matchAll(/if \[\[ "\$SUITE" = '--go-live' \]\]; then([\s\S]*?)\nelse/g)]
  const lane = blocks.find(match => match[1].includes('run_smoke smoke:go-live-runtime'))?.[1]
  assert.ok(lane, '必须在既有 go-live 专属实例分支运行')
  assert.match(lane, /run_smoke smoke:go-live-runtime[\s\S]*FLOWCUBE_PARTY_PROFILE_MYSQL_PROOF=1 run_smoke test:party-profile/)
}

test('电话旧形状真实迁移回归必须接在专属实例入口，删除开关或调用会失败', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8')
  assertPartyCapacityLane(source)
  assert.throws(() => assertPartyCapacityLane(source.replace('FLOWCUBE_PARTY_PROFILE_MYSQL_PROOF=1 ', '')))
  assert.throws(() => assertPartyCapacityLane(source.replace('run_smoke test:party-profile', ':')))
})
