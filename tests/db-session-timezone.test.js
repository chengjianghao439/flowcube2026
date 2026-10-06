'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function fixture({ instant = '2026-10-06T17:58:02Z', initialization = null, failure = null, timeoutMs = 100 } = {}) {
  const file = path.resolve(__dirname, '../backend/src/config/db.js'), requireAt = createRequire(file)
  const events = [], sessions = [], business = [], handlers = {}, exported = { exports: {} }
  let options
  const pool = {
    on: (event, callback) => { handlers[event] = callback },
    query() { throw new Error('Uninitialized native pool.query bypass') },
    execute() { throw new Error('Uninitialized native pool.execute bypass') },
    getConnection: async () => {
      const core = {
        timezone: '+00:00', destroyed: 0, released: 0,
        async query(sql) {
          events.push(sql)
          if (/SET .*time_zone/i.test(sql)) {
            if (initialization) await initialization.promise
            if (failure) throw failure
            assert.ok(sql.includes("'+08:00'"))
            this.timezone = '+08:00'
          }
          return [[]]
        },
        promise() { return this },
      }
      sessions.push(core)
      const conn = {
        connection: core,
        async query(sql, params) {
          business.push({ sql, params })
          if (sql.startsWith('SELECT')) return [[{ approved_date: new Date(Date.parse(instant) + (core.timezone === '+08:00' ? 8 * 3600000 : 0)).toISOString().slice(0, 10) }]]
          return core.query(sql)
        },
        async execute(...args) { return this.query(...args) },
        release() { core.released++ }, destroy() { core.destroyed++ },
      }
      handlers.connection(core)
      return conn
    },
  }
  const env = { DB_HOST: '127.0.0.1', DB_PORT: 12345, DB_USER: 'fixture', DB_PASSWORD: 'synthetic', DB_NAME: 'flowcube_timezone_test', DB_POOL_SIZE: 2, DB_ACQUIRE_TIMEOUT_MS: timeoutMs }
  vm.runInThisContext(`(function(require,module){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })(name => name === 'mysql2/promise' ? { createPool: config => { options = config; return pool } } : name === './env' ? { env } : requireAt(name), exported)
  return { pool: exported.exports.pool, events, sessions, business, options }
}
for (const instant of ['2026-10-06T17:58:02Z', '2026-10-31T16:30:00Z']) test(`new UTC-server session writes Beijing approval date at ${instant}`, async () => {
  const f = fixture({ instant })
  const [[row]] = await f.pool.query("SELECT DATE_FORMAT(NOW(),'%Y-%m-%d') AS approved_date")
  assert.equal(row.approved_date, beijingTodayYmd(new Date(instant)))
  assert.equal(f.options.timezone, '+08:00')
  assert.ok(f.events.some(sql => /SET .*time_zone/i.test(sql)))
  assert.ok(f.events.some(sql => sql.includes('SET NAMES utf8mb4')))
  assert.ok(f.events.some(sql => sql.includes('innodb_lock_wait_timeout = 30')))
  assert.equal(f.sessions[0].released, 1)
})
for (const method of ['getConnection', 'query', 'execute']) test(`${method} waits for session initialization before exposing connection or business SQL`, async () => {
  const initialization = deferred(), f = fixture({ initialization })
  let borrowed = false
  const pending = f.pool[method]('SELECT NOW()', ['kept']).then(result => { borrowed = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(borrowed, false)
  assert.equal(f.business.length, 0)
  initialization.resolve()
  const result = await pending
  assert.equal(f.sessions[0].timezone, '+08:00')
  if (method === 'getConnection') result.release()
  else assert.deepEqual(f.business[0].params, ['kept'])
})
for (const method of ['getConnection', 'query', 'execute']) test(`${method} destroys a rejected timezone session and executes no business SQL`, async () => {
  const failure = new Error('synthetic session initialization rejection'), f = fixture({ failure })
  await assert.rejects(f.pool[method]('SELECT NOW()'), error => error === failure)
  assert.equal(f.sessions[0].destroyed, 1)
  assert.equal(f.sessions[0].released, 0)
  assert.equal(f.business.length, 0)
})
for (const method of ['getConnection', 'query', 'execute']) test(`${method} includes initialization in the acquisition budget and returns late connections without SQL`, async () => {
  const initialization = deferred(), f = fixture({ initialization, timeoutMs: 10 })
  await assert.rejects(f.pool[method]('SELECT NOW()'), { code: 'DB_ACQUIRE_TIMEOUT' })
  initialization.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.sessions[0].released, 1)
  assert.equal(f.sessions[0].timezone, '+08:00')
  assert.equal(f.business.length, 0)
})
