const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const express = require('../backend/node_modules/express')
const cors = require('../backend/node_modules/cors')
const { buildCorsOptions } = require('../backend/src/config/cors')

async function request(t, options, origin, method = 'OPTIONS') {
  const app = express()
  app.use(cors(buildCorsOptions({ IS_PROD: true, ...options })))
  app.get('/probe', (_req, res) => res.json({ ok: true }))
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  await once(server, 'listening')
  const headers = origin === undefined ? {} : { Origin: origin }
  if (method === 'OPTIONS') headers['Access-Control-Request-Method'] = 'GET'
  return fetch(`http://127.0.0.1:${server.address().port}/probe`, { method, headers })
}

test('explicit Electron null origin works without reflecting arbitrary sites', async t => {
  const res = await request(t, { CORS_ALLOW_NULL_ORIGIN: true }, 'null')
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), 'null')
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
})

test('production domain and bundled Android origin can share an exact allowlist', async t => {
  const config = { CORS_ORIGIN: ' https://erp.example , https://localhost, ' }
  for (const origin of ['https://erp.example', 'https://localhost']) {
    const res = await request(t, config, origin)
    assert.equal(res.headers.get('access-control-allow-origin'), origin)
  }
})

test('allowing Electron does not allow an unrelated website', async t => {
  const res = await request(t, { CORS_ALLOW_NULL_ORIGIN: true, CORS_ORIGIN: 'https://erp.example' }, 'https://evil.example')
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  assert.equal(res.headers.get('access-control-allow-credentials'), null)
})

test('allowlist does not allow suffix matches, changed ports, or http downgrades', async t => {
  for (const origin of ['https://erp.example.evil.example', 'https://erp.example:444', 'http://erp.example']) {
    const res = await request(t, { CORS_ORIGIN: 'https://erp.example' }, origin)
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  }
})

test('null stays disabled unless separately enabled', async t => {
  const res = await request(t, { CORS_ORIGIN: 'https://erp.example' }, 'null')
  assert.equal(res.headers.get('access-control-allow-origin'), null)
})

test('requests without Origin still reach the API without CORS headers', async t => {
  const res = await request(t, {}, undefined, 'GET')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(res.headers.get('access-control-allow-origin'), null)
})

test('empty production policy does not allow localhost implicitly', async t => {
  const res = await request(t, {}, 'https://localhost')
  assert.equal(res.headers.get('access-control-allow-origin'), null)
})

test('development localhost default remains available', async t => {
  const res = await request(t, { IS_PROD: false }, 'http://localhost:5173')
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})

test('explicit legacy reflection remains opt-in for staged configuration changes', async t => {
  for (const config of [{ CORS_REFLECT: true }, { CORS_ORIGIN: '*' }]) {
    const res = await request(t, config, 'https://legacy.example')
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://legacy.example')
  }
})
