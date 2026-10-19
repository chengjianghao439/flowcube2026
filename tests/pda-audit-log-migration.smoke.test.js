'use strict'
// Dedicated owned MySQL only. No app/server/GUI/document-activity code is imported.
const { test, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const mysql = require('../backend/node_modules/mysql2/promise')
const { assertOwnedRepairInstance } = require('./helpers/repairInstanceOwnership')
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
const root = path.resolve(__dirname, '..'), migration = '293_pda_audit_logs_formal_schema.sql'
const tables = ['pda_error_logs', 'pda_undo_logs']
const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true }
assert.equal(process.env.NODE_ENV, 'test')
assert.equal(config.host, '127.0.0.1')
assert.ok(Number.isInteger(config.port) && config.port > 0 && ![3306, 3307].includes(config.port))
assert.equal(config.database, 'flowcube_pdaaudit293_test')
assert.ok(process.env.FLOWCUBE_REPAIR_INSTANCE_FILE, 'owned runner proof is required before connection/write')
let conn, freshDefinition
let migrationTimezone = '+00:00', migrationZones = []
const normalize = value => JSON.parse(JSON.stringify(value))
const sql = () => fs.readFileSync(path.join(root, 'backend/src/database', migration), 'utf8')
const owned = connection => assertOwnedRepairInstance(connection || conn, { config })
async function query(text, args) { const [rows] = await conn.query(text, args); return normalize(rows) }
async function schema() {
  return {
    tables: await query('SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,AUTO_INCREMENT,TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME', [tables]),
    columns: await query('SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,CHARACTER_SET_NAME,COLLATION_NAME,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME,ORDINAL_POSITION', [tables]),
    indexes: await query('SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,COLLATION,INDEX_TYPE,IS_VISIBLE,EXPRESSION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX', [tables]),
    constraints: await query('SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME,CONSTRAINT_NAME', [tables]),
  }
}
function definition(s) { return { tables: s.tables.map(({ AUTO_INCREMENT: _unused, ...x }) => x), columns: s.columns, indexes: s.indexes, constraints: s.constraints } }
async function rows() {
  const present = await query('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [tables])
  const result = {}
  for (const name of tables) {
    if (!present.some(x => x.TABLE_NAME === name && x.TABLE_TYPE === 'BASE TABLE')) { result[name] = null; continue }
    const tail = name === 'pda_undo_logs' ? ',item_id,CAST(prev_qty AS CHAR) AS prev,CAST(new_qty AS CHAR) AS next' : ',HEX(reason) AS reasonBytes'
    result[name] = await query('SELECT id,task_id,HEX(barcode) AS barcodeBytes,operator_id,HEX(operator_name) AS operatorBytes,UNIX_TIMESTAMP(created_at) AS epoch' + tail + ' FROM `' + name + '` ORDER BY id')
  }
  return result
}
async function snapshot() { return { schema: await schema(), rows: await rows(), ledger: await query('SELECT filename FROM db_migrations WHERE filename=?', [migration]) } }
function realMigrationRunner() {
  const file = path.join(root, 'backend/src/database/migrate.js'), module = { exports: {} }
  // Run the real migration/ledger/error path for 293 only. Other migrations were executed by the original owned runner.
  const deps = { fs: { ...fs, readdirSync(dir) { assert.equal(dir, path.dirname(file)); return [migration] } }, path,
    'mysql2/promise': { async createConnection(options) {
      assert.equal(options.host, config.host); assert.equal(options.port, config.port); assert.equal(options.database, config.database)
      const c = await mysql.createConnection({ ...options, dateStrings: true }); await owned(c)
      await c.query('SET SESSION time_zone=?', [migrationTimezone])
      const [[zone]] = await c.query('SELECT @@session.time_zone AS timezone')
      migrationZones.push(zone.timezone)
      return c
    } },
    '../config/env': { env: { DB_HOST: config.host, DB_PORT: config.port, DB_USER: config.user, DB_PASSWORD: config.password, DB_NAME: config.database } }, './sqlStatements': { splitSqlStatements },
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, __dirname: path.dirname(file), console: { log() {}, warn() {}, error() {} }, require(name) { assert.ok(Object.hasOwn(deps, name), 'unexpected migration dependency'); return deps[name] } }, { filename: file })
  return module.exports.runMigrations
}
async function migrate() { await owned(); await realMigrationRunner()() }
async function resetAuditFixtures() {
  migrationTimezone = '+00:00'; migrationZones = []
  await owned()
  // Test-only reset in this newly owned instance; never an operational rollback recipe.
  for (const name of tables) {
    const [entry] = await query('SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [name])
    if (entry) await conn.query((entry.TABLE_TYPE === 'VIEW' ? 'DROP VIEW ' : 'DROP TABLE ') + '`' + name + '`')
  }
  await conn.query('DELETE FROM db_migrations WHERE filename=?', [migration])
  await conn.query("SET SESSION time_zone='+00:00'")
}
const legacy = {
  pda_error_logs: 'CREATE TABLE pda_error_logs (id INT AUTO_INCREMENT PRIMARY KEY,task_id INT,barcode VARCHAR(64),reason VARCHAR(255),operator_id INT,operator_name VARCHAR(64),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
  pda_undo_logs: 'CREATE TABLE pda_undo_logs (id INT AUTO_INCREMENT PRIMARY KEY,task_id INT,item_id INT,barcode VARCHAR(64),prev_qty DECIMAL(10,2),new_qty DECIMAL(10,2),operator_id INT,operator_name VARCHAR(64),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
}
async function createLegacy(which = tables) {
  for (const name of which) await conn.query(legacy[name])
}
async function seed() {
  await conn.query("INSERT INTO pda_error_logs (id,task_id,barcode,reason,operator_id,operator_name,created_at) VALUES (7,11,?,'旧夹具 A',4,?,'2026-01-02 04:05:06'),(8,NULL,NULL,NULL,NULL,NULL,NULL)", ['合成🙂 A é', '合成操作员'])
  await conn.query("INSERT INTO pda_undo_logs (id,task_id,item_id,barcode,prev_qty,new_qty,operator_id,operator_name,created_at) VALUES (17,11,12,?,1.25,0.50,4,?,'2026-01-02 04:05:06'),(18,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)", ['合成🙂 A é', '合成操作员'])
  await conn.query('ALTER TABLE pda_error_logs AUTO_INCREMENT=900')
  await conn.query('ALTER TABLE pda_undo_logs AUTO_INCREMENT=1000')
}
async function assertRejectedUnchanged() {
  const before = await snapshot()
  await assert.rejects(migrate(), error => /__pda_audit_logs_293_.*_preflight_mismatch__/.test(error.message))
  assert.deepEqual(await snapshot(), before, 'both tables, rows and migration ledger must remain unchanged')
}
before(async () => {
  conn = await mysql.createConnection(config); await owned()
  const files = fs.readdirSync(path.join(root, 'backend/src/database')).filter(x => x.endsWith('.sql'))
  const [{ count }] = await query('SELECT COUNT(*) AS count FROM db_migrations')
  assert.equal(Number(count), files.length, 'original owned runner must have migrated the complete current directory')
  assert.equal((await query('SELECT filename FROM db_migrations WHERE filename=?', [migration])).length, 1)
  freshDefinition = definition(await schema())
})
beforeEach(resetAuditFixtures)
after(async () => { if (conn) await conn.end() })

test('fresh 293 through the actual runner creates the canonical schema and one receipt; replay skips it', async () => {
  await migrate(); assert.deepEqual(definition(await schema()), freshDefinition)
  const before = await snapshot(); await migrate(); assert.deepEqual(await snapshot(), before)
  assert.equal(before.ledger.length, 1)
})
for (const timezone of ['+00:00', '+08:00']) test('legacy rows, timestamp epochs and auto-increment survive conversion at ' + timezone, async () => {
  await createLegacy(); await seed(); const before = await rows()
  migrationTimezone = timezone
  await conn.query('SET SESSION time_zone=?', [timezone]); await migrate()
  assert.deepEqual(migrationZones, [timezone], 'the actual migration connection must use the requested timezone')
  assert.deepEqual(await rows(), before)
  const afterSchema = await schema(); assert.deepEqual(definition(afterSchema), freshDefinition)
  assert.equal(Number(afterSchema.tables.find(x => x.TABLE_NAME === 'pda_error_logs').AUTO_INCREMENT), 900)
  assert.equal(Number(afterSchema.tables.find(x => x.TABLE_NAME === 'pda_undo_logs').AUTO_INCREMENT), 1000)
})
async function readAuditReport(filters = {}) {
  const module = { exports: {} }, warnings = []
  const deps = {
    '../../utils/qtyPrecision': require('../backend/src/utils/qtyPrecision'),
    '../../utils/unitConversion': require('../backend/src/utils/unitConversion'),
    '../fulfillment/fulfillment.refresh': {}, '../../config/db': { pool: conn },
    '../../utils/AppError': require('../backend/src/utils/AppError'),
    '../../utils/warehouseScope': { scopeFilter() { throw new Error('this preservation fixture uses the original unrestricted report') } },
    '../../utils/sqlIdentifier': require('../backend/src/utils/sqlIdentifier'),
    '../../engine/containerEngine': {}, '../../constants/warehouseTaskStatus': {},
    '../warehouse-tasks/warehouse-tasks.service': {}, '../warehouse-tasks/warehouse-task-events.service': {},
    '../warehouse-tasks/warehouse-tasks.helpers': {}, '../../utils/operationRequest': {},
    '../../utils/logger': { warn(...args) { warnings.push(args) } },
  }
  const file = path.join(root, 'backend/src/modules/scan-logs/scan-logs.service.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, require(name) { assert.ok(Object.hasOwn(deps, name)); return deps[name] } }, { filename: file })
  const result = normalize(await module.exports.getAnomalyReport(filters))
  assert.equal(warnings.length, 0, 'missing-table/query degradation must not masquerade as visible preserved history')
  return result
}
test('three synthetic existing error records keep all fields, epochs, count and report visibility', async () => {
  await createLegacy()
  await conn.query("INSERT INTO pda_error_logs (id,task_id,barcode,reason,operator_id,operator_name,created_at) VALUES (41,NULL,?, ?,91,?,'2026-09-01 16:00:00'),(42,NULL,?, ?,92,?,'2026-09-02 15:59:59'),(43,NULL,?, ?,93,?,NULL)",
    ['合成🙂 A', '合成原因甲', '合成员甲', 'synthetic é B', '合成原因乙', '合成员乙', '合成 C', '合成原因丙', '合成员丙'])
  const before = await rows(), reportBefore = await readAuditReport()
  assert.equal(before.pda_error_logs.length, 3)
  assert.equal(reportBefore.summary.totalErrors, 3)
  assert.equal(reportBefore.byReason.length, 3); assert.equal(reportBefore.byBarcode.length, 3)
  assert.equal(reportBefore.byOperator.length, 3)
  migrationTimezone = '+08:00'
  await migrate()
  assert.deepEqual(migrationZones, ['+08:00'])
  assert.deepEqual(await rows(), before, 'all existing IDs, fields and timestamp epochs must survive')
  const reportAfter = await readAuditReport()
  // Group ordering may change with collation; compare each group by its stable key.
  for (const [key, field] of [['byReason','reason'], ['byBarcode','barcode'], ['byOperator','operatorId'], ['dailyTrend','date']]) {
    const ordered = report => [...report[key]].sort((a,b) => String(a[field]).localeCompare(String(b[field])))
    assert.deepEqual(ordered(reportAfter), ordered(reportBefore), key + ' must still expose all original groups')
  }
  assert.deepEqual(reportAfter.summary, reportBefore.summary)
  const final = await rows(); await migrate(); assert.deepEqual(await rows(), final)
  assert.equal((await readAuditReport()).summary.totalErrors, 3)
})
test('existing column/table comments remain untouched during collation conversion', async () => {
  await createLegacy(); await seed()
  await conn.query("ALTER TABLE pda_error_logs COMMENT='synthetic existing table comment', MODIFY reason VARCHAR(255) DEFAULT NULL COMMENT 'synthetic existing column comment'")
  const before = await snapshot(); await migrate(); const after = await snapshot()
  assert.equal(after.schema.tables.find(x => x.TABLE_NAME === 'pda_error_logs').TABLE_COMMENT, before.schema.tables.find(x => x.TABLE_NAME === 'pda_error_logs').TABLE_COMMENT)
  assert.equal(after.schema.columns.find(x => x.TABLE_NAME === 'pda_error_logs' && x.COLUMN_NAME === 'reason').COLUMN_COMMENT, 'synthetic existing column comment')
  assert.deepEqual(after.rows, before.rows)
})
for (const name of tables) test('one valid existing table and one missing table converge: ' + name, async () => {
  await createLegacy([name]); await migrate(); assert.deepEqual(definition(await schema()), freshDefinition)
})
for (const [good, bad] of [['pda_error_logs', 'pda_undo_logs'], ['pda_undo_logs', 'pda_error_logs']]) test('two-table preflight rejects malformed ' + bad + ' before mutating ' + good, async () => {
  await createLegacy(); await seed(); await conn.query('ALTER TABLE `' + bad + '` ADD extra_col INT')
  await assertRejectedUnchanged()
})
test('malformed second table cannot cause the missing first table to be created', async () => {
  await createLegacy(['pda_undo_logs']); await conn.query('ALTER TABLE pda_undo_logs ADD extra_col INT'); await assertRejectedUnchanged()
})
test('view with a PDA table name is rejected before creating or converting another table', async () => {
  await createLegacy(['pda_error_logs']); await conn.query('CREATE VIEW pda_undo_logs AS SELECT 1 AS id'); await assertRejectedUnchanged()
})
const drifts = [
 ['unsigned id', 'ALTER TABLE pda_undo_logs MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT'],
 ['unsigned task', 'ALTER TABLE pda_undo_logs MODIFY task_id INT UNSIGNED DEFAULT NULL'],
 ['unsigned quantity', 'ALTER TABLE pda_undo_logs MODIFY prev_qty DECIMAL(10,2) UNSIGNED DEFAULT NULL'],
 ['quantity precision', 'ALTER TABLE pda_undo_logs MODIFY prev_qty DECIMAL(11,2) DEFAULT NULL'],
 ['quantity scale', 'ALTER TABLE pda_undo_logs MODIFY new_qty DECIMAL(10,3) DEFAULT NULL'],
 ['not nullable', 'ALTER TABLE pda_undo_logs MODIFY task_id INT NOT NULL DEFAULT 0'],
 ['non-null default', 'ALTER TABLE pda_undo_logs ALTER task_id SET DEFAULT 0'],
 ['unknown varchar length', 'ALTER TABLE pda_undo_logs MODIFY barcode VARCHAR(65) DEFAULT NULL'],
 ['timestamp type', 'ALTER TABLE pda_undo_logs MODIFY created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP'],
 ['timestamp precision', 'ALTER TABLE pda_undo_logs MODIFY created_at TIMESTAMP(1) NULL DEFAULT CURRENT_TIMESTAMP(1)'],
 ['timestamp nullability', 'ALTER TABLE pda_undo_logs MODIFY created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'],
 ['timestamp default', 'ALTER TABLE pda_undo_logs MODIFY created_at TIMESTAMP NULL DEFAULT NULL'],
 ['timestamp on-update', 'ALTER TABLE pda_undo_logs MODIFY created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
 ['column order', 'ALTER TABLE pda_undo_logs MODIFY barcode VARCHAR(64) DEFAULT NULL AFTER id'],
 ['engine', 'ALTER TABLE pda_undo_logs ENGINE=MyISAM'],
 ['unknown collation', 'ALTER TABLE pda_undo_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'],
 ['wrong named column', 'ALTER TABLE pda_undo_logs ADD KEY idx_pda_undo_logs_task(item_id)'],
 ['wrong named order', 'ALTER TABLE pda_undo_logs ADD KEY idx_pda_undo_logs_task(task_id,item_id)'],
 ['named unique', 'ALTER TABLE pda_undo_logs ADD UNIQUE KEY idx_pda_undo_logs_task(task_id)'],
 ['named prefix', 'ALTER TABLE pda_undo_logs ADD KEY idx_pda_undo_logs_created(barcode(8))'],
 ['named descending', 'ALTER TABLE pda_undo_logs ADD KEY idx_pda_undo_logs_task(task_id DESC)'],
 ['named invisible', 'ALTER TABLE pda_undo_logs ADD KEY idx_pda_undo_logs_task(task_id) INVISIBLE'],
 ['unknown index', 'ALTER TABLE pda_undo_logs ADD KEY synthetic_unknown_index(item_id)'],
 ['unknown check', 'ALTER TABLE pda_undo_logs ADD CONSTRAINT synthetic_unknown_check CHECK(task_id IS NULL OR task_id>0)'],
]
for (const [title, ddl] of drifts) test('strict preflight rejects ' + title + ' without partial mutation', async () => {
  await createLegacy(); await conn.query(ddl); await assertRejectedUnchanged()
})
test('composite primary key independently fails the real index predicate', async () => {
  await createLegacy()
  await conn.query('ALTER TABLE pda_undo_logs DROP PRIMARY KEY, ADD PRIMARY KEY(id,task_id), MODIFY task_id INT NOT NULL DEFAULT 0')
  // MySQL requires primary-key members to be NOT NULL. Observe the independent
  // index verdict so the required column drift cannot conceal a weakened PK guard.
  let observed = false
  for (const statement of splitSqlStatements(sql())) {
    if (/SET @pda293_sql := IF\(@pda293_error_ok/.test(statement)) { observed = true; break }
    assert.doesNotMatch(statement, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i)
    await conn.query(statement)
  }
  assert.ok(observed, 'inspect only metadata before the first failure guard or DDL')
  const [verdict] = await query('SELECT @pda293_undo_columns_ok AS columnsOk,@pda293_undo_indexes_ok AS indexesOk')
  assert.equal(Number(verdict.columnsOk), 0)
  assert.equal(Number(verdict.indexesOk), 0, 'the PK/index predicate itself must reject a composite primary key')
  await assertRejectedUnchanged()
})
test('drift of the first-table named index also leaves both old collations unchanged', async () => {
  await createLegacy(); await conn.query('ALTER TABLE pda_error_logs ADD KEY idx_pda_error_logs_created(task_id)'); await assertRejectedUnchanged()
})
for (const stage of ['first create', 'first convert', 'first added index']) test('partial DDL failure after ' + stage + ' reenters through the real runner and preserves history', async () => {
  if (stage !== 'first create') { await createLegacy(); await seed() }
  const before = await rows(), statements = splitSqlStatements(sql())
  let complete = false, prepared = ''
  for (const statement of statements) {
    await conn.query(statement)
    if (/SET @pda293_sql := IF\(@pda293_convert/.test(statement)) prepared = 'convert'
    else if (/SET @pda293_sql := IF\(@pda293_index_count/.test(statement)) prepared = 'index'
    if ((stage === 'first create' && /CREATE TABLE IF NOT EXISTS `pda_error_logs`/.test(statement)) || (stage === 'first convert' && /^EXECUTE pda293_stmt/.test(statement) && prepared === 'convert') || (stage === 'first added index' && /^EXECUTE pda293_stmt/.test(statement) && prepared === 'index')) { complete = true; break }
  }
  assert.ok(complete, 'the intended real DDL interruption point must execute')
  assert.equal((await query('SELECT filename FROM db_migrations WHERE filename=?', [migration])).length, 0)
  await migrate(); assert.deepEqual(definition(await schema()), freshDefinition)
  if (stage !== 'first create') assert.deepEqual(await rows(), before)
  const final = await snapshot(); await migrate(); assert.deepEqual(await snapshot(), final)
})
