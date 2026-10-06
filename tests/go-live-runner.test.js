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
  assert.equal(pkg.scripts['smoke:go-live-runtime'], 'node --test --test-concurrency=1 tests/go-live-runtime.smoke.test.js')
  assert.equal(pkg.scripts['smoke:go-live-owned'], 'bash scripts/repair-smoke-ephemeral.sh --go-live')
  const script = fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8')
  assert.match(script, /DB_NAME='flowcube_golive20261006_test'/)
  assert.match(script, /run_smoke smoke:go-live-runtime/)
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
  assert.match(workflow, /go-live-owned:/)
  assert.match(workflow, /run: npm run smoke:go-live-owned/)
})
