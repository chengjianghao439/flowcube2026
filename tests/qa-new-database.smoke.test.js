'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const mysql = require('../backend/node_modules/mysql2/promise')
const { runMigrations, executeMigrationStatements } = require('../backend/src/database/migrate')
const approved = require('./fixtures/qa-roles-approved-20261021.json').roles
const root = path.resolve(__dirname, '..')
const bootstrapSql = fs.readFileSync(path.join(root, 'backend/src/database/bootstrap/new-install-role-defaults.sql'), 'utf8')
const exec = promisify(execFile)

// These schemas are created by this process, never reused, and dropped by exact
// generated name in finally. The caller must supply an isolated test instance.
async function schema(fn) {
  const cfg = validateTestEnvironment()
  const name = `flowcube_qanew_${process.pid}_${randomBytes(5).toString('hex')}_test`
  const admin = await mysql.createConnection(cfg)
  let created = false, conn
  try {
    await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci', [name])
    created = true
    conn = await mysql.createConnection({ ...cfg, database: name })
    await fn({ conn, name })
  } finally {
    if (conn) { await conn.rollback(); await conn.end() }
    try { if (created) await admin.query('DROP DATABASE ??', [name]) } finally { await admin.end() }
  }
}
function cli(name) {
  return exec(process.execPath, [path.join(root, 'backend/scripts/bootstrap-new-database.js')], {
    cwd: root, env: { ...process.env, DB_NAME: name }, maxBuffer: 8 * 1024 * 1024,
  })
}
async function projection(conn) {
  const [roles] = await conn.query('SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id')
  const [permissions] = await conn.query('SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,BINARY permission')
  return { roles, permissions }
}

test('真实新库CLI走001—295及新SQL后正常执行严格296，最终13角色精确after；重跑不改库', async () => schema(async ({ conn, name }) => {
  const result = await cli(name)
  assert.match(result.stdout, /新库初始化完成/)
  const state = await projection(conn)
  assert.deepEqual(state.roles.map(r => ({ ...r, id: Number(r.id), is_system: Number(r.is_system) })), approved.map(({ id, code, name, remark, is_system }) => ({ id, code, name, remark, is_system })))
  assert.deepEqual(state.permissions.map(r => `${Number(r.role_id)}:${r.permission}`).sort(), approved.flatMap(r => r.after.map(p => `${r.id}:${p}`)).sort())
  const [done] = await conn.query('SELECT filename FROM db_migrations ORDER BY filename')
  const expectedFiles = fs.readdirSync(path.join(root, 'backend/src/database')).filter(f => f.endsWith('.sql')).sort()
  assert.deepEqual(done.map(r => r.filename), expectedFiles)
  const [[counts]] = await conn.query("SELECT COUNT(*) n FROM sys_role_default_revisions WHERE revision_key='qa_roles_20261021_v2'")
  assert.equal(Number(counts.n), 13)
  await assert.rejects(cli(name), error => /db_migrations/.test(error.stderr) && /新建空库/.test(error.stderr))
  assert.deepEqual(await projection(conn), state)
  await runMigrations({ connection: conn })
  assert.deepEqual(await projection(conn), state, 'ordinary upgrade replay cannot reset customized/new role state')
}))

for (const [kind, sql] of [
  ['迁移记录表', 'CREATE TABLE db_migrations (id INT)'],
  ['普通表', 'CREATE TABLE existing_table (id INT)'],
  ['视图', 'CREATE VIEW existing_view AS SELECT 1 AS id'],
  ['存储过程', 'CREATE PROCEDURE existing_proc() SELECT 1'],
  ['函数', 'CREATE FUNCTION existing_func() RETURNS INT DETERMINISTIC RETURN 1'],
  ['事件', 'CREATE EVENT existing_event ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1'],
]) {
  test(`真实新库入口在写入前拒绝已有${kind}，不创建迁移表`, async () => schema(async ({ conn, name }) => {
    await conn.query(sql)
    const [before] = await conn.query('SHOW FULL TABLES')
    await assert.rejects(cli(name), error => /新库初始化仅接受/.test(error.stderr))
    assert.deepEqual((await conn.query('SHOW FULL TABLES'))[0], before)
  }))
}

test('普通空库迁移仍严格拒绝12角色默认种子，不伪造296回执；新入口拒绝中断非空库', async () => schema(async ({ conn, name }) => {
  await assert.rejects(runMigrations({ connection: conn }), error => error.code === 'MIGRATION_PREFLIGHT_FAILED' && /role_missing|metadata/.test(error.message))
  await conn.rollback()
  const [[count]] = await conn.query("SELECT COUNT(*) n FROM db_migrations WHERE filename='296_qa_role_permissions.sql'")
  assert.equal(Number(count.n), 0)
  const state = await projection(conn)
  assert.equal(state.roles.length, 12)
  await assert.rejects(cli(name), error => /NEW_DATABASE_NOT_EMPTY|新库初始化仅接受/.test(error.stderr))
  assert.deepEqual(await projection(conn), state)
}))

for (const [kind, mutate, diagnostic] of [
  ['同数换权', async c => { await c.query("UPDATE sys_role_permissions SET permission='qa.bootstrap.unknown' WHERE role_id=4 AND permission='dashboard.view'") }, /missing seed permission.*dashboard.view[\s\S]*|extra seed permission.*qa.bootstrap.unknown/],
  ['元数据', async c => { await c.query("UPDATE sys_roles SET name='自定义岗位' WHERE id=4") }, /seed metadata drift/],
]) {
  test(`初始化SQL在${kind}漂移时全量诊断并拒绝，完整授权保持`, async () => schema(async ({ conn }) => {
    await runMigrations({ through: '295_role_duties_approval.sql', connection: conn })
    await mutate(conn)
    const before = await projection(conn)
    await assert.rejects(executeMigrationStatements(conn, bootstrapSql, 'bootstrap/new-install-role-defaults.sql'), error => {
      assert.equal(error.code, 'MIGRATION_PREFLIGHT_FAILED')
      assert.match(error.message, diagnostic)
      if (kind === '同数换权') {
        assert.match(error.message, /missing seed permission: 4\/sales\/dashboard.view/)
        assert.match(error.message, /extra seed permission: 4\/sales\/qa.bootstrap.unknown/)
      }
      return true
    })
    await conn.rollback()
    assert.deepEqual(await projection(conn), before)
    if (kind === '同数换权') {
      // A same-count change must expose both sides, not just a count mismatch.
      const [grants] = await conn.query('SELECT permission FROM sys_role_permissions WHERE role_id=4')
      assert.ok(grants.some(r => r.permission === 'qa.bootstrap.unknown'))
    }
    const [[count]] = await conn.query("SELECT COUNT(*) n FROM db_migrations WHERE filename='296_qa_role_permissions.sql'")
    assert.equal(Number(count.n), 0)
  }))
}

test('真实SQL逐条执行同一工作单元，诊断/SQL错误立即停止、不派发后续、不写成功回执且可回滚', async () => schema(async ({ conn }) => {
  await conn.query('CREATE TABLE db_migrations (filename VARCHAR(200) PRIMARY KEY) ENGINE=InnoDB')
  await conn.query('CREATE TABLE sequence_probe (n INT PRIMARY KEY) ENGINE=InnoDB')
  const calls = [], query = conn.query.bind(conn)
  let active = 0, maximum = 0
  const tracked = { async query(sql, params) {
    calls.push(sql)
    maximum = Math.max(maximum, ++active)
    try { return await query(sql, params) } finally { active-- }
  } }
  await executeMigrationStatements(tracked, 'INSERT INTO sequence_probe VALUES (1); INSERT INTO sequence_probe SELECT n+1 FROM sequence_probe;', 'success.sql', { recordMigration: true })
  assert.equal(maximum, 1)
  assert.match(calls.at(-1), /^INSERT INTO db_migrations/)
  assert.deepEqual((await query('SELECT n FROM sequence_probe ORDER BY n'))[0].map(r => r.n), [1, 2])
  calls.length = 0
  const diagnostic = 'x'.repeat(1800)
  await assert.rejects(executeMigrationStatements(tracked, `START TRANSACTION; INSERT INTO sequence_probe VALUES (3); SELECT '${diagnostic}' AS migration_error UNION ALL SELECT 'second diagnostic'; INSERT INTO sequence_probe VALUES (4); COMMIT;`, 'diagnostics.sql', { recordMigration: true }), error => error.code === 'MIGRATION_PREFLIGHT_FAILED' && error.message.includes(diagnostic) && error.message.includes('second diagnostic'))
  assert.ok(!calls.some(sql => /VALUES \(4\)|^COMMIT|^INSERT INTO db_migrations/.test(sql)))
  await conn.rollback()
  calls.length = 0
  await assert.rejects(executeMigrationStatements(tracked, 'START TRANSACTION; INSERT INTO sequence_probe VALUES (3); SELECT missing_column FROM sequence_probe; INSERT INTO sequence_probe VALUES (4); COMMIT;', 'failure.sql', { recordMigration: true }), error => error.code === 'ER_BAD_FIELD_ERROR')
  assert.ok(!calls.some(sql => /VALUES \(4\)|^COMMIT|^INSERT INTO db_migrations/.test(sql)))
  await conn.rollback()
  assert.deepEqual((await query('SELECT n FROM sequence_probe ORDER BY n'))[0].map(r => r.n), [1, 2])
  assert.deepEqual((await query('SELECT filename FROM db_migrations'))[0].map(r => r.filename), ['success.sql'])
}))
