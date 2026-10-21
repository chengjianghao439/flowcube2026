'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

function bootstrap(objects = [], failure) {
  const calls = [], module_ = { exports: {} }
  const conn = {
    async query(sql) { calls.push(['query', sql]); return [objects] },
    async rollback() { calls.push(['rollback']) },
    async end() { calls.push(['end']) },
  }
  const deps = {
    fs: { readFileSync: () => 'bootstrap SQL' }, path,
    'mysql2/promise': { async createConnection() { calls.push(['connect']); return conn } },
    '../config/env': { env: {} },
    './migrate': {
      async runMigrations(options) { calls.push(['migrate', options]); if (failure) throw failure },
      async executeMigrationStatements(connection, sql, filename, options) { calls.push(['bootstrap', { connection, sql, filename, options }]) },
    },
  }
  const file = path.join(root, 'backend/src/database/bootstrapNewDatabase.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: module_, __dirname: path.dirname(file), console: { log() {} }, require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name] } }, { filename: file })
  return { calls, conn, run: module_.exports.bootstrapNewDatabase }
}

for (const objectType of ['BASE TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT']) {
  test(`初始化在任何写入前拒绝已有${objectType}，包括迁移记录表`, async () => {
    const f = bootstrap([{ object_type: objectType, object_name: objectType === 'BASE TABLE' ? 'db_migrations' : 'existing_object' }])
    await assert.rejects(f.run(), error => {
      assert.equal(error.code, 'NEW_DATABASE_NOT_EMPTY')
      assert.match(error.message, /existing_object|db_migrations/)
      assert.match(error.message, /新建空库/)
      return true
    })
    assert.deepEqual(f.calls.map(c => c[0]), ['connect', 'query', 'rollback', 'end'])
    const sql = f.calls.find(c => c[0] === 'query')[1]
    for (const table of ['TABLES', 'ROUTINES', 'TRIGGERS', 'EVENTS']) assert.ok(sql.includes(`information_schema.${table}`), table)
  })
}
test('空库同一连接依次执行001—295、新初始化SQL、普通全部迁移；连接由入口收尾', async () => {
  const f = bootstrap()
  await f.run()
  assert.deepEqual(f.calls.map(c => c[0]), ['connect', 'query', 'migrate', 'bootstrap', 'migrate', 'end'])
  const migrations = f.calls.filter(c => c[0] === 'migrate')
  assert.equal(migrations[0][1].through, '295_role_duties_approval.sql')
  assert.equal(migrations[1][1].through, undefined, '296 must run as ordinary strict migration')
  assert.equal(migrations[0][1].connection, f.conn)
  assert.equal(migrations[1][1].connection, f.conn)
  assert.match(f.calls.find(c => c[0] === 'bootstrap')[1].filename, /bootstrap/)
})
test('历史迁移失败即停，保留原错误并关闭连接，不装载新角色', async () => {
  const failure = new Error('migration failed'), f = bootstrap([], failure)
  await assert.rejects(f.run(), error => error === failure)
  assert.deepEqual(f.calls.map(c => c[0]), ['connect', 'query', 'migrate', 'rollback', 'end'])
})
test('正式初始化不引用测试夹具，SQL放子目录不混入普通编号迁移', () => {
  const source = fs.readFileSync(path.join(root, 'backend/src/database/bootstrapNewDatabase.js'), 'utf8')
  assert.doesNotMatch(source, /tests\/|prepareQaRoleTestDatabase|fixtures/)
  assert.ok(fs.existsSync(path.join(root, 'backend/src/database/bootstrap/new-install-role-defaults.sql')))
  const files = fs.readdirSync(path.join(root, 'backend/src/database')).filter(f => f.endsWith('.sql'))
  assert.ok(files.every(f => /^\d{3}_/.test(f)))
})

test('新SQL冻结精确历史12种子与认可13角色before，不以数量替代', () => {
  const sql = fs.readFileSync(path.join(root, 'backend/src/database/bootstrap/new-install-role-defaults.sql'), 'utf8')
  const rows = [...sql.matchAll(/^ \('(seed|approved)',(\d+),'([^']+)','([^']+)','([^']*)',([01]),'(\[[^']*\])'\)/gm)]
    .map(([, phase, id, code, name, remark, isSystem, permissions]) => ({ phase, id: +id, code, name, remark, is_system: +isSystem, permissions: JSON.parse(permissions) }))
  const approved = require('./fixtures/qa-roles-approved-20261021.json').roles
  assert.deepEqual(rows.filter(r => r.phase === 'approved').map(({ phase: _phase, ...r }) => r), approved.map(r => ({ id: r.id, code: r.code, name: r.name, remark: r.remark, is_system: r.is_system, permissions: r.before })))
  const sql295 = fs.readFileSync(path.join(root, 'backend/src/database/295_role_duties_approval.sql'), 'utf8')
  const pairs = table => [...sql295.match(new RegExp('INSERT INTO ' + table + ' \\([^]*?VALUES([^]*?);'))[1].matchAll(/\('([^']+)', '([^']+)'\)/g)].map(m => m.slice(1))
  const removed = pairs('role_duties_revoke'), added = pairs('role_duties_grant')
  const expected = require('./fixtures/role-defaults-v0136.json').roles.map(r => ({ ...r,
    permissions: [...r.permissions.filter(p => !removed.some(([code, permission]) => code === r.code && permission === p)), ...added.filter(([code]) => code === r.code).map(([, permission]) => permission)].sort(),
  }))
  assert.deepEqual(rows.filter(r => r.phase === 'seed').map(({ phase: _phase, ...r }) => r), expected)
  assert.doesNotMatch(sql, /\bINSERT IGNORE\b/i)
  assert.ok(sql.indexOf('AS migration_error') < sql.indexOf('DELETE FROM sys_role_permissions'))
  assert.ok(sql.indexOf('new_install_assertion SELECT') < sql.indexOf('DELETE FROM sys_role_permissions'))
})

test('新库CLI缺显式DB配置时不加载运行配置、不读取.env或连接；错误自然完整输出', async () => {
  const file = path.join(root, 'backend/scripts/bootstrap-new-database.js')
  const source = fs.readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, '')
  const calls = [], process_ = { env: {} }, printed = []
  const main = vm.runInNewContext('(function(require, process, console) {\n' + source + '\n})')
  main(name => { calls.push(name) }, process_, { error(...args) { printed.push(args) } })
  assert.deepEqual(calls, [])
  assert.equal(process_.exitCode, 1)
  assert.match(printed[0][0], /DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME/)
  const message = 'complete diagnostic\n'.repeat(1000), failure = new Error(message)
  const configured = { env: { DB_HOST: '127.0.0.1', DB_PORT: '40001', DB_USER: 'synthetic', DB_PASSWORD: '', DB_NAME: 'flowcube_bootstrap_test' } }
  main(name => { assert.equal(name, '../src/database/bootstrapNewDatabase'); return { async bootstrapNewDatabase() { throw failure } } }, configured, { error(...args) { printed.push(args) } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(configured.exitCode, 1)
  assert.equal(printed.at(-1)[1], message)
})
