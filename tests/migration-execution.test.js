'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')

const filename = '086_add_missing_indexes.sql'
const migrationSource = path.resolve(__dirname, '../backend/src/database/migrate.js')

function loadMigrator() {
  const module = { exports: {} }
  const mocks = {
    fs: { readdirSync: () => [filename], readFileSync: () => 'ALTER TABLE fixture ADD INDEX idx_fixture (id);' },
    path, 'mysql2/promise': {}, './sqlStatements': { splitSqlStatements }, '../config/env': { env: {} },
  }
  vm.runInNewContext(fs.readFileSync(migrationSource, 'utf8'), {
    module, __dirname: path.dirname(migrationSource), require: name => mocks[name], console: { log() {}, warn() {} },
  })
  return module.exports.runMigrations
}

function fixture({ apply = async () => {} } = {}) {
  let waiting = [], lockOwner
  const state = { marker: null, applied: false }
  function connect() {
    const conn = {
      async query(sql, params) {
        if (/GET_LOCK\(/.test(sql)) {
          if (lockOwner) await new Promise(resolve => waiting.push(resolve))
          lockOwner = conn
          return [[{ lockName: 'flowcube:fixture', acquired: 1 }]]
        }
        if (/RELEASE_LOCK\(/.test(sql)) {
          assert.equal(lockOwner, conn)
          lockOwner = null
          waiting.shift()?.()
          return [[{ released: 1 }]]
        }
        if (sql.startsWith('SELECT id FROM db_migrations')) return [state.applied ? [{ id: 1 }] : []]
        if (sql.startsWith('SELECT attempt.filename')) {
          return [state.marker ? [{ filename: state.marker, applied: state.applied ? 1 : null }] : []]
        }
        if (sql.startsWith('INSERT INTO db_migration_attempts')) state.marker = params[0]
        if (sql.startsWith('DELETE FROM db_migration_attempts')) state.marker = null
        if (sql.startsWith('ALTER TABLE fixture')) await apply()
        if (sql.startsWith('INSERT INTO db_migrations')) state.applied = true
        return [[]]
      },
    }
    return conn
  }
  return { state, connect, waiting: () => waiting.length }
}

test('concurrent connections serialize before reading the receipt and apply the DDL once', async () => {
  let applied = 0, signalFirst, releaseFirst
  const started = new Promise(resolve => { signalFirst = resolve })
  const pause = new Promise(resolve => { releaseFirst = resolve })
  const f = fixture({ apply: async () => { if (++applied === 1) { signalFirst(); await pause } } })
  const run = loadMigrator()
  const first = run({ connection: f.connect() })
  await started
  const second = run({ connection: f.connect() })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(applied, 1)
    assert.equal(f.waiting(), 1)
  } finally {
    releaseFirst()
    await Promise.all([first, second])
  }
  assert.equal(applied, 1)
  assert.equal(f.state.marker, null)
})

test('an interrupted DDL without a success receipt is reported and never executed again automatically', async () => {
  let applied = 0
  const disconnect = new Error('fixture lost DDL acknowledgement')
  const f = fixture({ apply: async () => { if (++applied === 1) throw disconnect } })
  const run = loadMigrator()
  await assert.rejects(run({ connection: f.connect() }), error => error === disconnect)
  await assert.rejects(run({ connection: f.connect() }), {
    code: 'MIGRATION_ATTEMPT_UNRECONCILED',
    message: /086_add_missing_indexes\.sql/,
  })
  assert.equal(applied, 1)
  assert.equal(f.state.applied, false)
})

test('a durable receipt permits cleanup of the stale attempt without applying the migration again', async () => {
  const f = fixture({ apply: async () => assert.fail('recorded DDL should not run again') })
  f.state.marker = filename
  f.state.applied = true
  await loadMigrator()({ connection: f.connect() })
  assert.equal(f.state.marker, null)
})
