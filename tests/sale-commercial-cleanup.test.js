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
  const cleanupFixtureSessionFamilies = async currentPool => {
    assert.equal(currentPool, pool, 'family cleanup uses the same owned fixture pool')
    events.push('families.cleanup')
    if (fault === 'family-error' || fault === 'all-errors') fail('OWN_FAMILY_CLEANUP_FAILURE')
  }
  const fn = new AsyncFunction('fs', 'fixture', 'f', 'q', 'assert', 'server', 'pool', 'ref', 'ownPrint', 'originalSvc', 'operator', 'randomUUID', 'http', 'token', 'require', 'console', 'original', 'cleanupFixtureSessionFamilies', `return (${mainSource(source)})()`)
  let error, result
  try {
    result = await fn({ writeFileSync() { if (fault === 'manifest-error' || fault === 'all-errors') fail('OWN_MANIFEST_FAILURE') } }, fixture, fixture, q, assert, server, pool, 'private-cleanup-probe', null, {}, () => ({}), () => '', async () => ({}), '', createRequire(path.join(__dirname, file)), { log() {} }, original, cleanupFixtureSessionFamilies)
  } catch (e) { error = e }
  return { original, failures, events, error, result }
}
function verify(p, mode) {
  const fault = mode.replace(/^success-/, '')
  assert.equal(p.events.filter(e => e === 'server.close').length, 1, 'server.close must be attempted exactly once')
  assert.equal(p.events.filter(e => e === 'pool.end').length, 1, 'pool.end must be attempted even if server.close fails')
  assert.equal(p.events.filter(e => e === 'families.cleanup').length, 1, 'owned families are cleaned before closing the pool')
  assert.ok(p.events.indexOf('families.cleanup') < p.events.indexOf('pool.end'), 'family cleanup must precede pool closure')
  if (p.original) assert.ok(includes(p.error, p.original), 'original business exception must survive cleanup failures')
  for (const error of p.failures) assert.ok(includes(p.error, error), 'every cleanup exception must be retained')
  if (fault === 'assertion-error') assert.ok(p.error.errors.some(e => e?.cause?.code === 'ERR_ASSERTION'), 'proof assertion must be collected with original failure')
  if (fault === 'device-error' || fault === 'all-errors') assert.ok(p.events.some(e => e.startsWith('UPDATE sys_users')), 'device cleanup failure must not skip actor shutdown')
  if (mode === 'clean-success') { assert.equal(p.error, undefined); assert.equal(p.result, 'business success') }
  else assert.ok(p.error)
}
for (const file of scripts) {
  for (const mode of ['clean', 'assertion-error', 'query-error', 'manifest-error', 'device-error', 'server-error', 'pool-error', 'family-error', 'all-errors', 'clean-success', 'success-query-error', 'success-server-error', 'success-family-error', 'success-all-errors']) {
    test(`${file}: actual finally preserves errors and closes resources (${mode})`, async () => verify(await probe(file, mode), mode))
  }
}

function metadataSource(source) {
  const tree = ts.createSourceFile('smoke.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let statement
  function visit(node) {
    if (ts.isTryStatement(node) && node.finallyBlock
      && node.tryBlock.getText(tree).includes('SAVEPOINT metadata')
      && node.finallyBlock.getText(tree).includes('pool.query=originalPoolQuery')) statement = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(statement, 'actual metadata transaction must retain its own cleanup')
  const prefix = statement.parent.statements.filter(n => ts.isVariableStatement(n)
    && n.declarationList.declarations.some(d => ['metadataError','metadataCleanupErrors'].includes(d.name.getText(tree))))
    .map(n => n.getText(tree)).join('\n')
  const postCleanup = statement.parent.statements.slice(statement.parent.statements.indexOf(statement) + 1, statement.parent.statements.indexOf(statement) + 3)
  assert.ok(postCleanup.every(ts.isIfStatement)
    && postCleanup[0].expression.getText(tree) === 'metadataCleanupErrors.length'
    && postCleanup[1].expression.getText(tree) === 'metadataError', 'metadata errors must be thrown after finally cleanup')
  return prefix + '\ntry { if (original) throw original }'
    + source.slice(statement.tryBlock.end, postCleanup[1].end) + '\nreturn "metadata success"'
}
async function metadataProbe(mode) {
  const original = mode.startsWith('success') ? null : new Error('ORIGINAL_METADATA_FAILURE')
  const failures = [], events = [], originalPoolQuery = () => {}
  const pool = { query:() => {} }
  const fail = message => { const error = new Error(message); failures.push(error); throw error }
  const conn = {
    async rollback() {
      assert.equal(pool.query, originalPoolQuery, 'pool query must be restored before cleanup')
      events.push('rollback')
      if (mode.includes('rollback') || mode.includes('both')) fail('METADATA_ROLLBACK_FAILURE')
    },
    release() {
      events.push('release')
      if (mode.includes('release') || mode.includes('both')) fail('METADATA_RELEASE_FAILURE')
    },
  }
  const source = fs.readFileSync(path.join(__dirname, scripts[0]), 'utf8')
  const fn = new AsyncFunction('original', 'pool', 'originalPoolQuery', 'conn', metadataSource(source))
  let error, result
  try { result = await fn(original, pool, originalPoolQuery, conn) } catch (e) { error = e }
  assert.equal(pool.query, originalPoolQuery, 'actual metadata block must restore pool query')
  assert.deepEqual(events, ['rollback','release'], 'actual metadata block must release after rollback failure')
  if (original) assert.ok(includes(error, original), 'actual metadata block must preserve original business error')
  for (const failure of failures) assert.ok(includes(error, failure), 'actual metadata block must preserve every cleanup failure')
  if (failures.length) {
    assert.equal(error.name, 'AggregateError')
    if (original) assert.equal(error.cause, original, 'cleanup aggregate cause must identify original business error')
  } else if (original) assert.equal(error, original)
  else { assert.equal(error, undefined); assert.equal(result, 'metadata success') }
}
for (const mode of ['business','business-rollback','business-release','business-both','success','success-rollback','success-release','success-both']) {
  test(`lifecycle actual metadata inner cleanup preserves errors and attempts release (${mode})`, async () => metadataProbe(mode))
}
