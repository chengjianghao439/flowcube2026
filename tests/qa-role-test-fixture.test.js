'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { validateTestEnvironment } = require('./helpers/testEnvironment')
const approved = require('./fixtures/qa-roles-approved-20261021.json')
const seeds = require('./fixtures/role-defaults-v0136.json')
const root = path.resolve(__dirname, '..')
// Independently project the real, unchanged 295 SQL for a fresh CI seed fixture.
const sql295 = fs.readFileSync(path.join(root, 'backend/src/database/295_role_duties_approval.sql'), 'utf8')
function pairs(table) {
  const values = sql295.match(new RegExp('INSERT INTO ' + table + ' \\([^]*?VALUES([^]*?);'))[1]
  return [...values.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(m => m.slice(1))
}
const removed = pairs('role_duties_revoke'), added = pairs('role_duties_grant')
function fixture(options = {}) {
  const calls = [], m = { exports: {} }
  const env = { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '43521', DB_NAME: 'flowcube_qa_fixture_test', DB_USER: 'synthetic', DB_PASSWORD: '', ...options.env }
  const before = seeds.roles.map(r => ({ ...r, permissions: [...r.permissions.filter(p => !removed.some(([code, perm]) => code === r.code && perm === p)), ...added.filter(([code]) => code === r.code).map(([, perm]) => perm)].sort() }))
  if (options.drift) { const r = before.find(r => r.code === 'sales'); r.permissions[r.permissions.indexOf('dashboard.view')] = 'user.update'; r.permissions.sort() }
  const conn = {
    async beginTransaction() { calls.push(['begin']) }, async commit() { calls.push(['commit']) }, async rollback() { calls.push(['rollback']) }, async end() { calls.push(['end']) },
    async query(sql, values) {
      calls.push([sql, values])
      if (sql.startsWith('SELECT filename')) return [options.done ? [{ filename: '296_qa_role_permissions.sql' }] : []]
      if (sql.startsWith('SELECT id,code')) return [before.map(({ permissions: _permissions, ...r }) => r)]
      if (sql.startsWith('SELECT role_id')) return [before.flatMap(r => r.permissions.map(permission => ({ role_id: r.id, permission })))]
      if (sql.startsWith('SELECT id,username')) return [[{ id: 1, username: 'admin', role_id: 1, is_active: options.activeUser ? 1 : 0 }]]
      if (sql.startsWith('SELECT COUNT')) return [[{ n: options.business && values[0] === 'sale_orders' ? 1 : 0 }]]
      return [{ affectedRows: 1 }]
    },
  }
  const deps = {
    // Normalize only VM boundary prototypes; compare every actual data value.
    'node:assert/strict': { ...assert, deepEqual(a,b,message) { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), message) } },
    './testEnvironment': { configureTestEnvironment: () => validateTestEnvironment(env), validateTestEnvironment: () => validateTestEnvironment(env) },
    '../fixtures/qa-roles-approved-20261021.json': approved,
    '../fixtures/role-defaults-v0136.json': seeds,
    '../../backend/node_modules/mysql2/promise': { async createConnection() { calls.push(['connect']); return conn } },
    '../../backend/src/database/migrate': { async runMigrations(options) { calls.push(['migrate', options]) } },
  }
  const file = path.join(root, 'tests/helpers/prepareQaRoleTestDatabase.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: m, console: { log() {} }, require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name] } }, { filename: file })
  return { calls, prepare: m.exports.prepareQaRoleTestDatabase }
}
for (const env of [{ NODE_ENV: 'production' }, { DB_HOST: 'remote.invalid' }, { DB_NAME: 'flowcube_production' }]) {
  test(`合成岗位准备在迁移/连接前拒绝非测试目标 ${JSON.stringify(env)}`, async () => {
    const f = fixture({ env }); await assert.rejects(f.prepare(), /test-db/); assert.deepEqual(f.calls, [])
  })
}
for (const kind of ['drift', 'activeUser', 'business']) {
  test(`合成岗位准备拒绝${kind}，不覆盖角色或授权并回滚`, async () => {
    const f = fixture({ [kind]: true }); await assert.rejects(f.prepare(), { drift: /customized pre-296/, activeUser: /inactive seed administrator/, business: /empty sale_orders/ }[kind])
    assert.ok(f.calls.some(c => c[0] === 'rollback'))
    assert.ok(!f.calls.some(c => /^(DELETE|INSERT)/.test(c[0])))
    assert.equal(f.calls.filter(c => c[0] === 'migrate').length, 1, 'strict full migration must not run after fixture refusal')
  })
}
test('精确空种子才显式安装认可before并运行普通全部迁移', async () => {
  const f = fixture(); await f.prepare()
  assert.deepEqual(f.calls.filter(c => c[0] === 'migrate').map(c => JSON.parse(JSON.stringify(c[1] ?? null))), [{ through: '295_role_duties_approval.sql' }, null])
  const insert = f.calls.find(c => c[0].startsWith('INSERT INTO sys_role_permissions'))
  assert.deepEqual(Array.from(insert[1][0], row => Array.from(row)), approved.roles.flatMap(r => r.before.map(p => [r.id,p])))
  assert.ok(f.calls.some(c => c[0] === 'commit'))
})
test('已有296不重置任何角色，仍执行后续普通迁移', async () => {
  const f = fixture({ done: true, drift: true, activeUser: true, business: true }); await f.prepare()
  assert.ok(!f.calls.some(c => /^(DELETE|INSERT|SELECT id,code)/.test(c[0])))
  assert.equal(f.calls.filter(c => c[0] === 'migrate').length, 2)
})
