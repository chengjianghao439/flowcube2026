'use strict'

// 销售历史容量订正：离线守卫接 static；实库仅在现有归属 runner 内启用。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const file = path.join(root, 'backend/src/database/283_sale_order_capacity_known_legacy.sql')
const targets = [['remark', 30, 500], ['receiver_name', 5, 100], ['receiver_phone', 11, 50], ['receiver_address', 30, 255]]
const source = () => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
function contract(sql) {
  const plans = sql.split('SET @sale_capacity_283_sql =').slice(1)
  assert.equal(plans.length, 4, 'four known sales columns require a conditional plan')
  targets.forEach(([column, old, capacity], i) => {
    const plan = plans[i]
    for (const literal of ["TABLE_SCHEMA = DATABASE()", "TABLE_NAME = 'sale_orders'", `COLUMN_NAME = '${column}'`,
      "DATA_TYPE = 'varchar'", `CHARACTER_MAXIMUM_LENGTH = ${old} `, "IS_NULLABLE = 'YES'", 'COLUMN_DEFAULT IS NULL',
      "EXTRA = ''", "GENERATION_EXPRESSION = ''", 'CHARACTER_SET_NAME REGEXP', 'COLLATION_NAME REGEXP',
      `MODIFY COLUMN \`${column}\` VARCHAR(${capacity}) CHARACTER SET`, 'COLLATION_NAME', 'COLUMN_COMMENT',
      "'NO_BACKSLASH_ESCAPES'", 'QUOTE(COLUMN_COMMENT)', "'SELECT 1'", 'PREPARE sale_capacity_283_stmt',
      'EXECUTE sale_capacity_283_stmt', 'DEALLOCATE PREPARE sale_capacity_283_stmt']) assert.ok(plan.includes(literal), `${column}: ${literal}`)
  })
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|UPDATE|TRUNCATE)\b/i, 'only column capacity changes; no data rewrite')
}
test('283 repairs only confirmed sales shapes, retaining all other column metadata', () => contract(source()))
test('capacity guard rejects loss of shape, metadata and SQL-mode protection', () => {
  const sql = source(); contract(sql)
  for (const literal of ['TABLE_SCHEMA = DATABASE()', 'CHARACTER_MAXIMUM_LENGTH = 30 ', 'COLUMN_DEFAULT IS NULL',
    "GENERATION_EXPRESSION = ''", 'COLUMN_COMMENT', "'NO_BACKSLASH_ESCAPES'"]) assert.throws(() => contract(sql.replaceAll(literal, 'REMOVED_GUARD')))
})

if (process.env.FLOWCUBE_PARTY_PROFILE_MYSQL_PROOF === '1') test('owned MySQL repairs and replays real 283; long sales identity saves without changing prior values', async t => {
  const mysql = require('../backend/node_modules/mysql2/promise')
  const { assertOwnedRepairInstance } = require('./helpers/repairInstanceOwnership')
  const { assertSqlIdentifier } = require('../backend/src/utils/sqlIdentifier')
  const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4' }
  assert.equal(process.env.NODE_ENV, 'test'); assert.equal(config.host, '127.0.0.1')
  assert.ok(Number.isSafeInteger(config.port) && ![3306, 3307].includes(config.port))
  assert.match(config.database || '', /^flowcube_[a-zA-Z0-9_]+_test$/)
  const admin = await mysql.createConnection(config)
  const scratch = assertSqlIdentifier('flowcube_sale283_' + randomBytes(12).toString('hex') + '_test')
  let db, created = false
  try {
    const owner = await assertOwnedRepairInstance(admin, { config })
    const [present] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [scratch]); assert.equal(present.length, 0)
    await admin.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); created = true
    db = await mysql.createConnection({ ...config, database: scratch })
    assert.equal((await db.query('SELECT @@server_uuid uuid'))[0][0].uuid, owner.serverUuid)
    const initialMode = (await db.query('SELECT @@SESSION.sql_mode mode'))[0][0].mode
    const metadata = async () => (await db.query("SELECT COLUMN_NAME,COLUMN_TYPE,CHARACTER_MAXIMUM_LENGTH,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_COMMENT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' ORDER BY ORDINAL_POSITION"))[0]
    const cases = [
      { name: 'known old shapes preserve metadata and existing values', repair: true },
      { name: 'NO_BACKSLASH_ESCAPES preserves quotes and backslashes', repair: true, noBackslash: true },
      { name: 'column charset differs from default schema', repair: true, latin: true },
      { name: 'canonical capacity is a no-op', canonical: true },
      { name: 'unknown capacity is a no-op', unknown: true },
      { name: 'nonnullable known widths are a no-op', nonnullable: true },
      { name: 'non-NULL defaults remain exact', defaultValue: true },
      { name: 'generated known widths remain exact', generated: true },
    ]
    for (const scenario of cases) await t.test(scenario.name, async () => {
      await db.query('SET SESSION sql_mode=?', [initialMode])
      await db.query('DROP TABLE IF EXISTS sale_orders')
      const charset = scenario.latin ? 'latin1' : 'utf8mb4', collation = scenario.latin ? 'latin1_bin' : 'utf8mb4_bin'
      const definitions = targets.map(([column, old, capacity]) => {
        const width = scenario.canonical ? capacity : scenario.unknown ? old + 1 : old
        const suffix = scenario.generated ? "GENERATED ALWAYS AS ('abc') VIRTUAL" : scenario.nonnullable ? 'NOT NULL' : scenario.defaultValue ? "DEFAULT 'abc'" : 'DEFAULT NULL'
        return `\`${column}\` VARCHAR(${width}) CHARACTER SET ${charset} COLLATE ${collation} ${suffix} COMMENT ${mysql.escape("original ' quote \\ slash")}`
      })
      await db.query(`CREATE TABLE sale_orders(id INT PRIMARY KEY,${definitions.join(',')},INDEX idx_receiver_phone(receiver_phone))`)
      const values = ['old note', 'name', '01012345678', 'old address']
      if (!scenario.generated) await db.query('INSERT INTO sale_orders VALUES(1,?,?,?,?)', values)
      const [rows] = await db.query('SELECT * FROM sale_orders'), before = await metadata()
      const [indices] = await db.query("SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' ORDER BY INDEX_NAME,SEQ_IN_INDEX")
      if (scenario.noBackslash) await db.query('SET SESSION sql_mode=?', [initialMode + ',NO_BACKSLASH_ESCAPES'])
      for (const sql of splitSqlStatements(source())) await db.query(sql)
      const expected = before.map(column => {
        const target = targets.find(([name]) => name === column.COLUMN_NAME)
        return scenario.repair && target ? { ...column, COLUMN_TYPE: `varchar(${target[2]})`, CHARACTER_MAXIMUM_LENGTH: target[2] } : column
      })
      assert.deepEqual(await metadata(), expected)
      assert.deepEqual((await db.query('SELECT * FROM sale_orders'))[0], rows)
      assert.deepEqual((await db.query("SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_orders' ORDER BY INDEX_NAME,SEQ_IN_INDEX"))[0], indices)
      for (const sql of splitSqlStatements(source())) await db.query(sql)
      assert.deepEqual(await metadata(), expected, 'replay is a no-op')
      if (scenario.repair) {
        const long = ['n'.repeat(200), 'name'.repeat(20), '+86 (010) 1234-5678', 'address '.repeat(25)]
        await db.query('INSERT INTO sale_orders VALUES(2,?,?,?,?)', long)
        assert.deepEqual(Object.values((await db.query('SELECT * FROM sale_orders WHERE id=2'))[0][0]).slice(1), long)
      }
    })
  } finally {
    if (db) await db.end()
    if (created) {
      await assertOwnedRepairInstance(admin, { config })
      await admin.query(`DROP DATABASE \`${scratch}\``)
      assert.equal((await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [scratch]))[0].length, 0)
    }
    await admin.end()
  }
})
