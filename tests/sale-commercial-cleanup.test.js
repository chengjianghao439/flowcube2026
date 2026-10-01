'use strict'
// Execute the actual main catch/finally bytes, replacing only business setup.
// No app, database or browser is loaded; this guards resource/error behavior.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const ts = require('../frontend/node_modules/typescript')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const scripts = ['sale-commercial-lifecycle.smoke.test.js', 'sale-commercial-partial-cancel.smoke.test.js']
function mainSource(source) {
  const tree = ts.createSourceFile('smoke.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const main = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'main')
  const statement = main.body.statements.find(ts.isTryStatement)
  assert.ok(statement.finallyBlock, 'actual smoke must retain its finally')
  return source.slice(main.getStart(tree), statement.tryBlock.getStart(tree))
    + '{ if (original) throw original; return "business success" }'
    + source.slice(statement.tryBlock.end, main.end)
}
function includes(error, expected) {
  return error === expected || error?.cause === expected || Array.isArray(error?.errors) && error.errors.some(e => includes(e, expected))
}
async function probe(file, mode, source = fs.readFileSync(path.join(__dirname, file), 'utf8')) {
  const fault = mode.replace(/^success-/, '')
  const original = mode === 'clean-success' || mode.startsWith('success-') ? null : new Error('ORIGINAL_BUSINESS_FAILURE')
  const failures = [], events = []
  const fail = message => { const e = new Error(message); failures.push(e); throw e }
  const fixture = { sales: [1], products: [1], userId: 1, deviceId: 1, scopeUserId: 2, scopeDeviceIds: [2] }
  const q = async sql => {
    events.push(sql)
    if ((fault === 'query-error' || fault === 'all-errors') && sql.includes('locked_by_task_id')) fail('OWN_PROOF_QUERY_FAILURE')
    if ((fault === 'device-error' || fault === 'all-errors') && sql.startsWith('DELETE FROM pda_device_sessions')) fail('OWN_DEVICE_CLEANUP_FAILURE')
    return [{ is_active: 0, count: fault === 'assertion-error' && sql.includes('locked_by_task_id') ? 1 : 0, qty: 0 }]
  }
  const server = { close(callback) {
    events.push('server.close')
    if (fault === 'server-error' || fault === 'all-errors') {
      const e = new Error('OWN_SERVER_CLOSE_FAILURE'); failures.push(e); callback(e)
    } else callback()
  } }
  const pool = { async end() { events.push('pool.end'); if (fault === 'pool-error' || fault === 'all-errors') fail('OWN_POOL_CLOSE_FAILURE') } }
  const fn = new AsyncFunction('fs', 'fixture', 'f', 'q', 'assert', 'server', 'pool', 'ref', 'ownPrint', 'originalSvc', 'operator', 'randomUUID', 'http', 'token', 'require', 'console', 'original', `return (${mainSource(source)})()`)
  let error, result
  try {
    result = await fn({ writeFileSync() { if (fault === 'manifest-error' || fault === 'all-errors') fail('OWN_MANIFEST_FAILURE') } }, fixture, fixture, q, assert, server, pool, 'private-cleanup-probe', null, {}, () => ({}), () => '', async () => ({}), '', createRequire(path.join(__dirname, file)), { log() {} }, original)
  } catch (e) { error = e }
  return { original, failures, events, error, result }
}
function verify(p, mode) {
  const fault = mode.replace(/^success-/, '')
  assert.equal(p.events.filter(e => e === 'server.close').length, 1, 'server.close must be attempted exactly once')
  assert.equal(p.events.filter(e => e === 'pool.end').length, 1, 'pool.end must be attempted even if server.close fails')
  if (p.original) assert.ok(includes(p.error, p.original), 'original business exception must survive cleanup failures')
  for (const error of p.failures) assert.ok(includes(p.error, error), 'every cleanup exception must be retained')
  if (fault === 'assertion-error') assert.ok(p.error.errors.some(e => e?.cause?.code === 'ERR_ASSERTION'), 'proof assertion must be collected with original failure')
  if (fault === 'device-error' || fault === 'all-errors') assert.ok(p.events.some(e => e.startsWith('UPDATE sys_users')), 'device cleanup failure must not skip actor shutdown')
  if (mode === 'clean-success') { assert.equal(p.error, undefined); assert.equal(p.result, 'business success') }
  else assert.ok(p.error)
}
for (const file of scripts) {
  for (const mode of ['clean', 'assertion-error', 'query-error', 'manifest-error', 'device-error', 'server-error', 'pool-error', 'all-errors', 'clean-success', 'success-query-error', 'success-server-error', 'success-all-errors']) {
    test(`${file}: actual finally preserves errors and closes resources (${mode})`, async () => verify(await probe(file, mode), mode))
  }
}
