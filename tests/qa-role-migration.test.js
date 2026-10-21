'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const fixture = require('./fixtures/qa-roles-approved-20261021.json')
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
const root = path.resolve(__dirname, '..')
const filename = '296_qa_role_permissions.sql'
function runner(conn, sql, files = [filename]) {
  const file = path.join(root, 'backend/src/database/migrate.js'), module_ = { exports: {} }
  const deps = {
    fs: { readdirSync: () => files, readFileSync: () => sql }, path,
    'mysql2/promise': { createConnection: async () => conn },
    '../config/env': { env: {} }, './sqlStatements': { splitSqlStatements },
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: module_, __dirname: path.dirname(file), console: { log() {}, warn() {}, error() {} }, require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name] } }, { filename: file })
  return module_.exports
}
test('迁移入口完整抛出全部诊断并回滚，不执行后续写入或登记', async () => {
  const diagnostics = fixture.roles.flatMap(r => r.before.map(p => ({ migration_error: `${r.id}/${r.code}/${r.name}: missing ${p}` })))
  const calls = []
  const conn = {
    async query(sql) { calls.push(sql); return [sql === 'SELECT diagnostics' ? diagnostics : []] },
    async rollback() { calls.push('ROLLBACK') }, async end() { calls.push('END') },
  }
  await assert.rejects(runner(conn, 'START TRANSACTION; SELECT diagnostics; DELETE forbidden; COMMIT;').runMigrations(), error => {
    assert.equal(error.code, 'MIGRATION_PREFLIGHT_FAILED')
    for (const row of diagnostics) assert.ok(error.message.includes(row.migration_error), row.migration_error)
    return true
  })
  assert.ok(calls.includes('ROLLBACK'))
  assert.equal(calls.at(-1), 'END')
  assert.ok(!calls.includes('DELETE forbidden'))
  assert.ok(!calls.some(s => s.startsWith('INSERT INTO db_migrations')))
})
test('SQL错误也整体回滚，原始错误保持，不登记迁移', async () => {
  const calls = [], failure = new Error('synthetic SQL failure')
  const conn = {
    async query(sql) { calls.push(sql); if (sql === 'DELETE mutation') throw failure; return [[]] },
    async rollback() { calls.push('ROLLBACK') }, async end() { calls.push('END') },
  }
  await assert.rejects(runner(conn, 'START TRANSACTION; DELETE mutation; COMMIT;').runMigrations(), e => e === failure)
  assert.ok(calls.includes('ROLLBACK'))
  assert.ok(!calls.includes('COMMIT'))
  assert.ok(!calls.some(s => s.startsWith('INSERT INTO db_migrations')))
})
test('完整认可夹具逐权限匹配文档，不以数量替代；撤35增3，7角色撤整项报表', () => {
  const text = fs.readFileSync(path.join(root, fixture.approved_document), 'utf8')
  const parts = text.split(/^### (\d+) (.+?)（([^）]+)）\n/m)
  assert.equal((parts.length - 1) / 4, 13)
  let removed = 0, added = 0
  for (let i = 1; i < parts.length; i += 4) {
    const [id, name, code, body] = parts.slice(i, i + 4)
    const r = fixture.roles.find(r => r.id === +id)
    assert.equal(r.code, code); assert.equal(r.name, name)
    assert.ok(body.includes(`remark：${r.remark}。`)); assert.ok(body.includes(`is_system：\`${r.is_system}\``))
    const rows = [...body.matchAll(/^\| `([^`]+)` \| (有|无) \| (保留|撤回|新增) \|$/gm)]
    assert.deepEqual(rows.filter(x => x[2] === '有').map(x => x[1]), r.before)
    assert.deepEqual(rows.filter(x => x[3] !== '撤回').map(x => x[1]), r.after)
    removed += r.before.filter(p => !r.after.includes(p)).length
    added += r.after.filter(p => !r.before.includes(p)).length
  }
  assert.equal(removed, 35); assert.equal(added, 3)
  assert.equal(fixture.roles.filter(r => r.before.includes('report.view') && !r.after.includes('report.view')).length, 7)
})
test('新增296唯一且SQL执行前后都有全量失败守卫，沿原语句切分约定', () => {
  const sql = fs.readFileSync(path.join(root, 'backend/src/database', filename), 'utf8')
  assert.equal(fs.readdirSync(path.join(root, 'backend/src/database')).filter(s => s.startsWith('296_')).length, 1)
  assert.doesNotMatch(sql, /\b(?:INSERT IGNORE|DELIMITER|GROUP_CONCAT)\b/i)
  assert.ok((sql.match(/AS migration_error/g) || []).length >= 2)
  assert.ok((sql.match(/FOR UPDATE/g) || []).length >= 3)
})

test('显式迁移前缀只执行指定终点，默认仍执行全部，未知终点连库前报错', async () => {
  const calls = []
  const conn = { async query(sql, params) { calls.push({ sql, params }); return [[]] }, async rollback() {}, async end() {} }
  const files = ['295_role_duties_approval.sql', filename]
  await runner(conn, 'DO 1;', files).runMigrations({ through: files[0] })
  assert.deepEqual(calls.filter(c => c.sql.startsWith('INSERT INTO db_migrations')).map(c => c.params[0]), [files[0]])
  calls.length = 0
  await runner(conn, 'DO 1;', files).runMigrations()
  assert.deepEqual(calls.filter(c => c.sql.startsWith('INSERT INTO db_migrations')).map(c => c.params[0]), files)
  calls.length = 0
  await assert.rejects(runner(conn, 'DO 1;', files).runMigrations({ through: 'not-a-migration' }), /未知迁移终点/)
  assert.equal(calls.length, 0)
})

test('CLI完整输出长诊断后自然退出，不能立即process.exit截断管道', async () => {
  const message = fixture.roles.flatMap(r => r.before.map(p => `${r.id}/${r.code}: missing ${p}`)).join('\n')
  const failure = new Error(message), printed = [], calls = []
  const process_ = { argv: [], exit(code) { calls.push(code) } }
  const source = fs.readFileSync(path.join(root, 'backend/scripts/migrate.js'), 'utf8')
  const main = vm.runInNewContext('(function(require, process, console) {\n' + source.replace(/^#![^\n]*\n/, '') + '\n})')
  main(name => {
    if (name === 'dotenv') return { config() {} }
    assert.equal(name, '../src/database/migrate')
    return { runMigrations: async () => { throw failure } }
  }, process_, { log() {}, error(...args) { printed.push(args) } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [], 'CLI must let stderr flush naturally')
  assert.equal(process_.exitCode, 1)
  assert.equal(printed.length, 1)
  assert.equal(printed[0][1], message, 'every diagnostic must reach the console as full text')
})
