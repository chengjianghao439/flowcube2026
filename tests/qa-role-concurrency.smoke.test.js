'use strict'
// Each case creates a unique schema on the explicitly configured test server.
// Only the three copied role tables and a new migration ledger are populated.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { randomBytes } = require('node:crypto')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const mysql = require('../backend/node_modules/mysql2/promise')
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
const roles = require('./fixtures/qa-roles-approved-20261021.json').roles
const filename = '296_qa_role_permissions.sql'
const dir = path.resolve(__dirname, '../backend/src/database')
const sql = fs.readFileSync(path.join(dir, filename), 'utf8')
function runner(cfg, createConnection) {
  const file = path.join(dir, 'migrate.js'), m = { exports: {} }
  const deps = { fs: { ...fs, readdirSync: () => [filename] }, path,
    'mysql2/promise': { createConnection }, '../config/env': { env: { DB_HOST: cfg.host, DB_PORT: cfg.port, DB_USER: cfg.user, DB_PASSWORD: cfg.password, DB_NAME: cfg.database } }, './sqlStatements': { splitSqlStatements } }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: m, __dirname: dir, console: { log() {}, warn() {}, error() {} }, require(n) { assert.ok(Object.hasOwn(deps, n), n); return deps[n] } }, { filename: file })
  return m.exports
}
async function scenario(fn) {
  const cfg = validateTestEnvironment()
  const admin = await mysql.createConnection(cfg)
  const database = `flowcube_qa296_${randomBytes(6).toString('hex')}_test`
  const owned = { ...cfg, database }
  let created = false
  const clients = []
  const connect = async () => { const c = await mysql.createConnection(owned); clients.push(c); return c }
  try {
    await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci', [database]); created = true
    const setup = await connect()
    for (const table of ['sys_roles', 'sys_role_permissions', 'sys_role_default_revisions']) {
      const [[row]] = await admin.query('SHOW CREATE TABLE ??', [table])
      await setup.query(row['Create Table'])
    }
    await setup.query('INSERT INTO sys_roles (id,code,name,remark,is_system) VALUES ?', [roles.map(r => [r.id,r.code,r.name,r.remark,r.is_system])])
    await setup.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [roles.flatMap(r => r.before.map(p => [r.id,p]))])
    await fn({ cfg: owned, setup, connect })
  } finally {
    for (const c of clients) { try { await c.rollback(); await c.end() } catch { /* The real runner may already have ended its own connection. */ } }
    if (created) await admin.query('DROP DATABASE ??', [database])
    await admin.end()
  }
}
async function snapshot(c) {
  const [meta] = await c.query('SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id')
  const [grants] = await c.query('SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission')
  const [receipts] = await c.query('SELECT revision_key,role_code,role_id,outcome,before_count,after_count,reason FROM sys_role_default_revisions ORDER BY role_code')
  return { meta, grants, receipts }
}
async function expected(c, field) {
  const [rows] = await c.query('SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission')
  for (const r of roles) assert.deepEqual(rows.filter(p => Number(p.role_id) === r.id).map(p => p.permission).sort(), r[field].slice().sort(), r.code)
}
async function apply(c) {
  try { await runner({}, () => {}).executeMigrationStatements(c, sql, filename) }
  catch (error) { await c.rollback(); throw error }
}
async function waiting(c, connection) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const [[row]] = await c.query('SELECT COUNT(*) n FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?', [connection.connection.threadId])
    if (+row.n > 0) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const [trx] = await c.query('SELECT trx_mysql_thread_id,trx_state FROM information_schema.INNODB_TRX')
  const [state] = await c.query('SELECT ID,COMMAND,STATE,LEFT(INFO,180) info FROM information_schema.PROCESSLIST WHERE ID=?', [connection.threadId])
  assert.fail('expected real lock wait thread=' + connection.threadId + ' transactions=' + JSON.stringify(trx) + ' state=' + JSON.stringify(state))
}

test('真实迁移入口遇最后角色漂移不改任何授权、不登记；纠正夹具后准确执行并登记一次', async () => scenario(async ({ cfg, setup, connect }) => {
  await setup.query("DELETE FROM sys_role_permissions WHERE role_id=13 AND permission='dashboard.view'")
  const before = await snapshot(setup)
  await assert.rejects(runner(cfg, connect).runMigrations(), e => e.code === 'MIGRATION_PREFLIGHT_FAILED' && e.message.includes('13/preset_customer_service') && e.message.includes('dashboard.view'))
  assert.deepEqual(await snapshot(setup), before)
  const [[count]] = await setup.query('SELECT COUNT(*) n FROM db_migrations WHERE filename=?', [filename]); assert.equal(+count.n, 0)
  await setup.query("INSERT INTO sys_role_permissions VALUES (13,'dashboard.view')")
  await runner(cfg, connect).runMigrations(); await expected(setup, 'after')
  const first = await snapshot(setup)
  await runner(cfg, connect).runMigrations()
  assert.deepEqual(await snapshot(setup), first)
  const [[done]] = await setup.query('SELECT COUNT(*) n FROM db_migrations WHERE filename=?', [filename]); assert.equal(+done.n, 1)
}))
test('真实迁移入口在撤权后SQL故障整体回滚且无回执/迁移记录', async () => scenario(async ({ cfg, setup, connect }) => {
  const before = await snapshot(setup), failure = new Error('synthetic interruption after revocations')
  let injected = false
  await assert.rejects(runner(cfg, async () => {
    const c = await connect(), original = c.query.bind(c)
    c.query = async (...args) => {
      const result = await original(...args)
      if (/\bDELETE p FROM sys_role_permissions/.test(args[0])) { injected = true; throw failure }
      return result
    }
    return c
  }).runMigrations(), e => e === failure)
  assert.equal(injected, true); assert.deepEqual(await snapshot(setup), before)
  const [[count]] = await setup.query('SELECT COUNT(*) n FROM db_migrations WHERE filename=?', [filename]); assert.equal(+count.n, 0)
}))
test('先获角色行锁的并发保存提交后，迁移当前重读发现漂移，不能用旧快照放行', async () => scenario(async ({ setup, connect }) => {
  const writer = await connect(), migrator = await connect()
  await writer.beginTransaction()
  await writer.query('SELECT id FROM sys_roles WHERE id=4 FOR UPDATE')
  await writer.query("DELETE FROM sys_role_permissions WHERE role_id=4 AND permission='dashboard.view'")
  await writer.query("INSERT INTO sys_role_permissions VALUES (4,'user.update')")
  const result = apply(migrator).then(() => null, e => e)
  try { await waiting(setup, migrator) } catch (e) { await writer.rollback(); const observed = await result; throw new Error(e.message + '; migration=' + observed?.message) }
  await writer.commit()
  const error = await result
  assert.equal(error.code, 'MIGRATION_PREFLIGHT_FAILED')
  for (const value of ['4/sales','dashboard.view','user.update']) assert.ok(error.message.includes(value))
  const state = await snapshot(setup)
  assert.equal(state.grants.length, 351); assert.equal(state.receipts.length, 0)
  assert.ok(state.grants.some(g => +g.role_id === 4 && g.permission === 'accounting.period.manage'))
}))
test('迁移通过预检后仍持有全角色/授权范围锁，角色修改及直接加权都等待提交', async () => scenario(async ({ setup, connect }) => {
  const migrator = await connect(), roleWriter = await connect(), grantWriter = await connect()
  let release, paused
  const gate = new Promise(resolve => { release = resolve })
  const reached = new Promise(resolve => { paused = resolve })
  const original = migrator.query.bind(migrator)
  migrator.query = async (...args) => {
    if (/\bDELETE p FROM sys_role_permissions/.test(args[0])) { paused(); await gate }
    if (args[0] === 'COMMIT') await expected(migrator, 'after')
    return original(...args)
  }
  const migrationResult = apply(migrator)
  await Promise.race([reached, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('migration did not reach the locked mutation gate')), 8000); timer.unref() })])
  let roleFinished = false, grantFinished = false
  const roleResult = roleWriter.query("UPDATE sys_roles SET remark='synthetic concurrent update' WHERE id=4").then(() => { roleFinished = true })
  const grantResult = grantWriter.query("INSERT INTO sys_role_permissions VALUES (4,'user.update')").then(() => { grantFinished = true })
  try {
    await waiting(setup, roleWriter); await waiting(setup, grantWriter)
    assert.equal(roleFinished, false); assert.equal(grantFinished, false)
  } finally { release() }
  await migrationResult; await Promise.all([roleResult, grantResult])
  assert.equal((await snapshot(setup)).receipts.length, 13)
}))
test('并发执行同一原SQL串行化，第二次只接受完整回执和全部after集合', async () => scenario(async ({ setup, connect }) => {
  const a = await connect(), b = await connect()
  await Promise.all([apply(a), apply(b)])
  await expected(setup, 'after')
  assert.equal((await snapshot(setup)).receipts.length, 13)
}))
test('绕过JS诊断处理的原SQL也在写权限前被CHECK拒绝', async () => scenario(async ({ setup }) => {
  await setup.query("INSERT INTO sys_role_permissions VALUES (7,'user.update')")
  const before = await snapshot(setup)
  let mutationReached = false
  await assert.rejects((async () => {
    try {
      for (const statement of splitSqlStatements(sql)) {
        if (/\bDELETE p FROM sys_role_permissions/.test(statement)) mutationReached = true
        await setup.query(statement)
      }
    } finally { await setup.rollback() }
  })(), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED')
  assert.equal(mutationReached, false); assert.deepEqual(await snapshot(setup), before)
}))

test('连接即使默认READ COMMITTED，迁移本次事务也锁住新增角色范围且保持会话设置', async () => scenario(async ({ setup, connect }) => {
  const migrator = await connect(), writer = await connect()
  await migrator.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED')
  let release, reached
  const gate = new Promise(resolve => { release = resolve })
  const paused = new Promise(resolve => { reached = resolve })
  const original = migrator.query.bind(migrator)
  migrator.query = async (...args) => {
    if (args[0] === 'COMMIT') { reached(); await gate }
    return original(...args)
  }
  const migrating = apply(migrator).then(() => null, error => error)
  await Promise.race([paused, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('COMMIT gate not reached')), 8000); timer.unref() })])
  const writing = writer.query("INSERT INTO sys_roles(id,code,name,remark,is_system) VALUES(104,'concurrent_extra','并发夹具','并发夹具',0)")
  let observed
  try { await waiting(setup, writer) } catch (error) { observed = error } finally { release() }
  assert.equal(await migrating, null)
  await writing
  if (observed) throw observed
  const [[state]] = await migrator.query('SELECT @@session.transaction_isolation isolationLevel')
  assert.equal(state.isolationLevel, 'READ-COMMITTED', 'only the migration transaction isolation may change')
}))
