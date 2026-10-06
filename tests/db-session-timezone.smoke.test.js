'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')

test('application sessions retain Beijing approval dates on a UTC MySQL server at day/month boundaries', async () => {
  let conn
  try {
    conn = await pool.getConnection()
    const [[zones]] = await conn.query('SELECT @@session.time_zone AS session_zone,@@global.time_zone AS global_zone,@@system_time_zone AS system_zone')
    assert.equal(zones.session_zone, '+08:00')
    console.log(`[session-timezone] session=${zones.session_zone} global=${zones.global_zone} system=${zones.system_zone}`)
    // Session-local clock and temporary table: no global setting or persistent business row is changed.
    await conn.query('CREATE TEMPORARY TABLE flowcube_session_approval_test (id INT PRIMARY KEY,approved_at DATETIME NOT NULL,client_written_at DATETIME NOT NULL)')
    const instants = ['2026-10-06T17:58:02Z', '2026-10-31T16:30:00Z', '2026-10-31T15:30:00Z']
    for (const [index, instant] of instants.entries()) {
      const when = new Date(instant), expectedDate = beijingTodayYmd(when)
      await conn.query('SET timestamp = ?', [when.getTime() / 1000])
      await conn.query('INSERT INTO flowcube_session_approval_test (id,approved_at,client_written_at) VALUES (?,NOW(),?)', [index + 1, when])
      const [[row]] = await conn.query("SELECT approved_at,client_written_at,DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date,DATE_FORMAT(client_written_at,'%Y-%m-%d') AS client_date FROM flowcube_session_approval_test WHERE id=?", [index + 1])
      assert.equal(row.approved_date, expectedDate)
      assert.equal(row.client_date, expectedDate)
      assert.equal(row.approved_at.getTime(), when.getTime())
      assert.equal(row.client_written_at.getTime(), when.getTime())
      assert.equal(beijingTodayYmd(row.approved_at), expectedDate)
      console.log(`[session-timezone] UTC=${instant} approved_date=${row.approved_date} client_date=${row.client_date}`)
    }
    await conn.query('SET timestamp = ?', [Date.parse('2026-11-02T17:00:00Z') / 1000])
    const [[fixed]] = await conn.query("SELECT DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date FROM flowcube_session_approval_test WHERE id=3")
    assert.equal(fixed.approved_date, '2026-10-31', 'later execution cannot replace the original approval date/month')
  } finally {
    try {
      if (conn) {
        await conn.query('SET timestamp = 0')
        await conn.query('DROP TEMPORARY TABLE IF EXISTS flowcube_session_approval_test')
      }
    } finally { conn?.release(); await pool.end() }
  }
})
