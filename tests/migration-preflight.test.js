const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkMigrationConditions } = require('../backend/scripts/migration-preflight')
function fixture({ applied = [], flags = { binlog: 1, trusted: 0 }, grants = ['GRANT ALL PRIVILEGES ON `app`.* TO account'], fail = false } = {}) {
  const calls = []
  const conn = { query: async sql => {
    calls.push(sql)
    if (fail) throw Error('synthetic secret must not leak')
    if (sql.includes('information_schema.tables')) return [[{ present: 1 }]]
    if (sql === 'SELECT filename FROM db_migrations') return [applied.map(filename => ({ filename }))]
    if (sql.startsWith('SELECT @@GLOBAL')) return [[flags]]
    if (sql === 'SELECT DATABASE() AS databaseName') return [[{ databaseName: 'app' }]]
    if (sql === 'SHOW GRANTS') return [grants.map(value => ({ grant: value }))]
    throw Error('unexpected query')
  } }
  return { conn, calls }
}
const sources = { '001_base.sql': 'CREATE TABLE sample (id INT)', '241_trigger.sql': 'CREATE TRIGGER t AFTER INSERT ON sample FOR EACH ROW SET @x=1' }
const options = { files: Object.keys(sources), read: filename => sources[filename] }
test('无待执行触发器不把trust=0误判成迁移失败；所有语句只读', async () => {
  const f = fixture({ applied: ['241_trigger.sql'] })
  const result = await checkMigrationConditions(f.conn, options)
  assert.deepEqual(result.pending, ['001_base.sql'])
  assert.equal(f.calls.some(sql => /@@GLOBAL|SHOW GRANTS/.test(sql)), false)
  assert.ok(f.calls.every(sql => /^(SELECT|SHOW)/.test(sql)))
})
test('仅注释提及CREATE TRIGGER不要求额外条件', async () => {
  const f = fixture()
  await checkMigrationConditions(f.conn, { files: ['note.sql'], read: () => '-- CREATE TRIGGER x\nSELECT 1' })
  assert.equal(f.calls.some(sql => /@@GLOBAL/.test(sql)), false)
})
for (const flags of [{ binlog: 0, trusted: 0 }, { binlog: 1, trusted: 1 }]) test('待执行触发器已有数据库条件则通过，不写参数', async () => {
  const f = fixture({ flags })
  await checkMigrationConditions(f.conn, options)
  assert.ok(f.calls.includes('SHOW GRANTS'))
})
test('待执行触发器trust=0只认实际迁移账户已有的全局SUPER/ALL', async () => {
  for (const grant of ['GRANT SUPER ON *.* TO account', 'GRANT ALL PRIVILEGES ON *.* TO account']) await checkMigrationConditions(fixture({ grants: [grant, 'GRANT ALL PRIVILEGES ON `app`.* TO account'] }).conn, options)
  for (const grant of ['GRANT ALL PRIVILEGES ON app.* TO account', 'GRANT SELECT ON app.super TO account']) await assert.rejects(checkMigrationConditions(fixture({ grants: [grant] }).conn, options), /迁移条件不足/)
})
test('查询失败、未知参数均拒绝且不改配置', async () => {
  await assert.rejects(checkMigrationConditions(fixture({ fail: true }).conn, options))
  await assert.rejects(checkMigrationConditions(fixture({ flags: { binlog: 'unknown', trusted: 0 } }).conn, options), /迁移条件未知/)
})

test('所有SQL已执行时trust=0无需参数或GRANT检查', async () => {
  const f = fixture({ applied: Object.keys(sources) })
  assert.deepEqual((await checkMigrationConditions(f.conn, options)).pending, [])
  assert.equal(f.calls.some(sql => /@@GLOBAL|SHOW GRANTS/.test(sql)), false)
})
test('动态字符串中的触发器或函数仍要求已有条件', async () => {
  for (const sql of ["SET @sql='CREATE TRIGGER t AFTER INSERT ON sample FOR EACH ROW SET @v=1'; PREPARE s FROM @sql", "SET @sql='CREATE FUNCTION f() RETURNS INT RETURN 1'"]) {
    await assert.rejects(checkMigrationConditions(fixture().conn, { files: ['dynamic.sql'], read: () => sql }), /迁移条件不足/)
  }
})
test('参数NULL/空串不冒充binlog关闭', async () => {
  for (const binlog of [null, '', undefined]) await assert.rejects(checkMigrationConditions(fixture({ flags: { binlog, trusted: 0 } }).conn, options), /迁移条件未知/)
})

test('binlogoff/trust1不代替数据库TRIGGER权限，SUPER也不代替基本DDL权限', async () => {
  for (const flags of [{ binlog: 0, trusted: 0 }, { binlog: 1, trusted: 1 }]) await assert.rejects(checkMigrationConditions(fixture({flags, grants: []}).conn, options), /迁移条件不足/)
  await assert.rejects(checkMigrationConditions(fixture({grants: ['GRANT SUPER ON *.* TO account']}).conn, options), /迁移条件不足/)
  await assert.rejects(checkMigrationConditions(fixture({flags: {binlog:0,trusted:0}, grants: ['GRANT TRIGGER ON `other`.* TO account']}).conn, options), /迁移条件不足/)
})
test('带空格DEFINER与ALTER FUNCTION必须取得对应数据库权限', async () => {
  for (const [sql, privilege] of [['CREATE FUNCTION f() RETURNS INT RETURN 1', 'CREATE ROUTINE'], ['ALTER FUNCTION f SQL SECURITY INVOKER', 'ALTER ROUTINE']]) {
    const opts={files:['routine.sql'],read:()=>sql}
    await assert.rejects(checkMigrationConditions(fixture({flags:{binlog:0,trusted:0},grants:[]}).conn,opts),/迁移条件不足/)
    await checkMigrationConditions(fixture({flags:{binlog:0,trusted:0},grants:[`GRANT ${privilege} ON \`app\`.* TO account`]}).conn,opts)
  }
})

test('显式DEFINER身份未知必须拒绝，不能只凭SUPER猜目标身份', async () => {
  await assert.rejects(checkMigrationConditions(fixture({grants:['GRANT ALL PRIVILEGES ON *.* TO account']}).conn,{files:['definer.sql'],read:()=>"CREATE DEFINER = 'root' @ 'localhost' FUNCTION f() RETURNS INT DETERMINISTIC RETURN 1"}),/DEFINER/)
})
test('binlog1/trust0即使SUPER也必须有可证明函数声明', async () => {
  const f=()=>fixture({grants:['GRANT ALL PRIVILEGES ON *.* TO account']}).conn
  for (const declaration of ['', 'NOT DETERMINISTIC']) await assert.rejects(checkMigrationConditions(f(),{files:['function.sql'],read:()=>`CREATE FUNCTION f() RETURNS INT ${declaration} RETURN 1`}),/函数声明/)
  for (const declaration of ['DETERMINISTIC','NO SQL','READS SQL DATA']) await checkMigrationConditions(f(),{files:['function.sql'],read:()=>`CREATE FUNCTION f() RETURNS INT ${declaration} RETURN 1`})
})

test('MySQL可执行注释中的敏感DDL不能绕过预检', async () => {
  await assert.rejects(checkMigrationConditions(fixture({grants:[]}).conn,{files:['exec.sql'],read:()=> '/*!50003 CREATE*/ /*!50003 TRIGGER t AFTER INSERT ON sample FOR EACH ROW SET @v=1 */'}),/迁移条件不足/)
})
