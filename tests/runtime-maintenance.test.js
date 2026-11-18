'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

async function withLoki(fetch) {
  const diagnostics = [], output = []
  const module = { exports: {} }
  const filename = path.join(root, 'backend/src/utils/logger.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: () => ({ getRequestContext: () => ({}) }),
    process: { env: { NODE_ENV: 'test', LOKI_URL: 'http://127.0.0.1/loki-fixture' } },
    console: { error: (...args) => diagnostics.push(args), warn: (...args) => output.push(args) },
    fetch, AbortSignal,
  }, { filename })
  for (let i = 0; i < 5; i++) module.exports.warn('fixture warning')
  assert.equal(output.length, 5, 'local output is synchronous')
  await new Promise(resolve => setImmediate(resolve))
  return diagnostics
}

test('Loki 204 succeeds, refusal and timeout are visible without flooding local diagnostics', async () => {
  assert.equal((await withLoki(async () => ({ ok: true, status: 204 }))).length, 0)
  for (const status of [429, 503]) {
    const lines = await withLoki(async () => ({ ok: false, status }))
    assert.equal(lines.length, 1)
    assert.match(lines.flat().join(' '), new RegExp(String(status)))
  }
  const timeout = await withLoki(async () => { throw Object.assign(new Error('fixture timeout'), { name: 'TimeoutError' }) })
  assert.equal(timeout.length, 1)
  assert.match(timeout.flat().join(' '), /TimeoutError/)
})

test('backend Compose forwards the production logistics stop switch into the container', () => {
  const main = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')
  const override = fs.readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8')
  const backend = main.split(/^  backend:/m)[1].split(/^  [a-z][\w-]*:/m)[0]
  assert.match(backend, /^\s+LOGISTICS_WORKER_ENABLED: \$\{LOGISTICS_WORKER_ENABLED:-1\}$/m)
  assert.doesNotMatch(override, /^\s+LOGISTICS_WORKER_ENABLED:/m, 'production must not override the requested switch')
})
