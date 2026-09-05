'use strict'
process.env.DB_POOL_SIZE = '1'
process.env.DB_ACQUIRE_TIMEOUT_MS = '50'
require('./helpers/testEnvironment').configureTestEnvironment()
const assert = require('node:assert/strict')
const { pool } = require('../backend/src/config/db')
const { createReadinessHandler } = require('../backend/src/utils/readiness')
const express = require('../backend/node_modules/express')

async function main() {
  let held, server
  try {
    held = await pool.getConnection()
    await held.query('CREATE TEMPORARY TABLE round2_wait_probe (n INT)')
    await assert.rejects(pool.query('INSERT INTO round2_wait_probe VALUES (1)'), { code: 'DB_ACQUIRE_TIMEOUT', statusCode: 503 })
    await assert.rejects(pool.execute('INSERT INTO round2_wait_probe VALUES (?)', [2]), { code: 'DB_ACQUIRE_TIMEOUT' })
    held.release(); held = null
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM round2_wait_probe')
    assert.equal(row.n, 0, '已超时的排队写操作不得在释放连接后执行')
    console.log('PASS queued query/execute return 503 and never execute after connection release')
    const app = express()
    app.get('/api/health', (_req, res) => res.json({ success: true }))
    app.get('/api/ready', createReadinessHandler(pool, { timeoutMs: 30, cacheMs: 0 }))
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    assert.equal((await fetch(base + '/api/ready')).status, 200)
    held = await pool.getConnection()
    assert.equal((await fetch(base + '/api/health')).status, 200)
    assert.equal((await fetch(base + '/api/ready')).status, 503)
    held.release(); held = null
    assert.equal((await fetch(base + '/api/ready')).status, 200)
    console.log('PASS real HTTP readiness: available 200, saturated 503, recovered 200; liveness stays 200')
    console.log(JSON.stringify({ target: process.env.DB_NAME, acquisition: pool.getAcquisitionStats() }))
  } finally {
    if (held) held.release()
    if (server) await new Promise(resolve => server.close(resolve))
    await pool.end()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
