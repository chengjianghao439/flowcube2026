'use strict'
// Append-only HTTP + real MySQL regression. No DELETE/TRUNCATE/DROP/ALTER or business-table writes.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mysql = require('../backend/node_modules/mysql2/promise')
const { assertOwnedRepairInstance } = require('./helpers/repairInstanceOwnership')
const { createFixture, listen, payload } = require('./helpers/pdaAuditLogApiFixture')
const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4' }
assert.equal(process.env.NODE_ENV, 'test'); assert.equal(config.host, '127.0.0.1')
assert.ok(Number.isInteger(config.port) && config.port > 0 && ![3306, 3307].includes(config.port))
assert.equal(config.database, 'flowcube_pdaauditapi_test')
assert.ok(process.env.FLOWCUBE_REPAIR_INSTANCE_FILE)
let conn, fixture, http
async function count(kind) {
  const [[row]] = await conn.query(kind === 'error' ? 'SELECT COUNT(*) AS n FROM pda_error_logs' : 'SELECT COUNT(*) AS n FROM pda_undo_logs')
  return Number(row.n)
}
before(async () => {
  conn = await mysql.createConnection(config); await assertOwnedRepairInstance(conn, { config })
  const [columns] = await conn.query("SELECT TABLE_NAME,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('pda_error_logs','pda_undo_logs') AND COLUMN_NAME='barcode'")
  assert.equal(columns.length, 2); assert.ok(columns.every(row => Number(row.CHARACTER_MAXIMUM_LENGTH) === 64))
  fixture = createFixture(async (sql, params) => { await assertOwnedRepairInstance(conn, { config }); return conn.query(sql, params) })
  http = await listen(fixture)
})
after(async () => { if (http) await http.close(); if (conn) await conn.end() })
for (const kind of ['error', 'undo']) {
  for (const character of ['A', '码', '🙂']) {
    test(`${kind}: 64 ${character} characters persist exactly in VARCHAR(64)`, async () => {
      const beforeCount = await count(kind), barcode = character.repeat(64)
      const response = await http.post(kind, payload(kind, barcode))
      assert.equal(response.status, 201); assert.equal(response.body.success, true)
      assert.equal(await count(kind), beforeCount + 1)
      const [rows] = await conn.query(kind === 'error'
        ? 'SELECT barcode,CHAR_LENGTH(barcode) AS n FROM pda_error_logs ORDER BY id DESC LIMIT 1'
        : 'SELECT barcode,CHAR_LENGTH(barcode) AS n FROM pda_undo_logs ORDER BY id DESC LIMIT 1')
      assert.equal(rows[0].barcode, barcode); assert.equal(Number(rows[0].n), 64)
    })
    for (const length of [65, 80]) test(`${kind}: ${length} ${character} characters return 400 and append no row`, async () => {
      const beforeCount = await count(kind), attempts = fixture.inserts.length
      const response = await http.post(kind, payload(kind, character.repeat(length)))
      assert.equal(response.status, 400); assert.equal(response.body.success, false)
      assert.match(response.body.message, /条码.*64.*字符/)
      assert.equal(await count(kind), beforeCount); assert.equal(fixture.inserts.length, attempts)
    })
  }
  test(`${kind}: injected write failure returns 500, no row, then a new valid call succeeds`, async () => {
    const beforeCount = await count(kind)
    fixture.failWith(Object.assign(new Error('synthetic injected write failure'), { code: 'ER_DISK_FULL' }))
    try {
      const response = await http.post(kind, payload(kind, 'INJECTED'))
      assert.equal(response.status, 500); assert.equal(response.body.success, false)
      assert.doesNotMatch(response.body.message, /已记录/)
      assert.equal(await count(kind), beforeCount)
    } finally { fixture.failWith(null) }
    assert.equal((await http.post(kind, payload(kind, 'AFTER-FAILURE'))).status, 201)
    assert.equal(await count(kind), beforeCount + 1)
  })
}
test('only the new synthetic audit rows were appended; no schema changes', async () => {
  assert.equal(await count('error'), 4); assert.equal(await count('undo'), 4)
  const [rows] = await conn.query("SELECT TABLE_NAME,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('pda_error_logs','pda_undo_logs') AND COLUMN_NAME='barcode'")
  assert.ok(rows.every(row => Number(row.CHARACTER_MAXIMUM_LENGTH) === 64))
})
