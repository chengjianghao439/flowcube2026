'use strict'
const root = require('node:path').resolve(__dirname, '../..')
process.env.DB_NAME ||= 'flowcube_fix_24_test'
process.env.DB_POOL_SIZE = '1'
require(root + '/tests/helpers/testEnvironment').configureTestEnvironment()
const fs = require('node:fs')
const { pool } = require(root + '/backend/src/config/db')
async function main() {
  const held = await pool.getConnection()
  let settled = false
  const start = performance.now()
  const pending = pool.query('SELECT 1 AS ok').then(([rows]) => {
    settled = true
    return { ok: rows[0].ok, elapsedMs: Math.round(performance.now() - start) }
  })
  await new Promise(resolve => setTimeout(resolve, 11200))
  const beforeRelease = { elapsedMs: Math.round(performance.now() - start), settled }
  held.release()
  const afterRelease = await pending
  const evidence = { target: process.env.DB_NAME, connectionLimit: 1, configuredConnectTimeoutMs: 10000, beforeRelease, afterRelease }
  fs.writeFileSync('/tmp/flowcube-round2-pool-evidence.json', JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence))
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
