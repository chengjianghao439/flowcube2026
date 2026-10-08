'use strict'
// Reload presentation DTOs against the SAME owned fixture, without reseeding it.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { assertOwnedRepairInstance } = require('../../tests/helpers/repairInstanceOwnership')
async function main() {
  const pid = process.env.FLOWCUBE_DESIGN_AUDIT_RUNTIME_PID
  const dir = process.env.FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR
  assert.match(pid || '', /^[1-9]\d*$/)
  assert.ok(dir && path.isAbsolute(dir) && !(fs.statSync(dir).mode & 0o077))
  const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim()
  assert.equal(command, 'node scripts/design-audit/runtime.cjs', 'only this task runtime may supply test configuration')
  // Capture privately; do not print process environment, configuration or credentials.
  const processEnv = execFileSync('ps', ['eww', '-p', pid, '-o', 'command='], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  for (const name of ['NODE_ENV', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET', 'APP_UPDATE_DOWNLOADS_DIR', 'FLOWCUBE_REPAIR_INSTANCE_FILE', 'FLOWCUBE_REPAIR_DOCKER_CONTEXT', 'FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR']) {
    const match = processEnv.match(new RegExp('(?:^| )' + name + '=([^ ]*)'))
    assert.ok(match, 'missing task test configuration')
    if (name === 'FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR') assert.equal(match[1].trim(), dir)
    process.env[name] = match[1].trim()
  }
  assert.equal(process.env.NODE_ENV, 'test')
  assert.equal(process.env.DB_HOST, '127.0.0.1')
  assert.equal(process.env.DB_NAME, 'flowcube_golive20261006_test')
  assert.ok(!['3306','3307'].includes(process.env.DB_PORT))
  process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
  process.env.SENTRY_DSN = ''
  process.env.LOKI_URL = ''
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD }
  const mysql = require('../../backend/node_modules/mysql2/promise')
  const conn = await mysql.createConnection(config)
  try { await assertOwnedRepairInstance(conn, { config }) } finally { await conn.end() }
  const app = require('../../backend/src/app')
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const factsFile = path.join(dir, 'facts.json'), facts = JSON.parse(fs.readFileSync(factsFile))
  facts.originalApi ||= facts.api
  facts.api = `http://127.0.0.1:${server.address().port}`
  facts.previewPid = process.pid
  fs.writeFileSync(factsFile, JSON.stringify(facts, null, 2), { mode: 0o600 })
  console.log('[design-audit-api] READY ' + facts.api)
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve) })
  server.closeAllConnections?.()
  await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
  await require('../../backend/src/config/db').pool.end()
}
main().catch(e => { console.error('[design-audit-api] ' + e.message); process.exitCode = 1 })
