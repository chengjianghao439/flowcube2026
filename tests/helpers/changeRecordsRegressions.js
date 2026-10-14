'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { validateTestEnvironment } = require('./testEnvironment')
const { assertOwnedRepairInstance } = require('./repairInstanceOwnership')
const root = path.resolve(__dirname, '../..')
const suites = [
  'integration.test.js', 'mainline.smoke.test.js', 'concurrency-guards.smoke.test.js',
  'p0-regression.smoke.test.js', 'p1-regression.smoke.test.js',
  'operation-request-concurrency.smoke.test.js',
  'fulfillment-credit-concurrency.smoke.test.js', 'fulfillment-credit-warehouse-concurrency.smoke.test.js',
  'sale-atp.smoke.test.js',
  'sale-adjustment.smoke.test.js', 'sale-commercial-lifecycle.smoke.test.js',
  'pick-cancel-return.smoke.test.js', 'product-price-history-integrity.smoke.test.js',
  'product-price-version-guard.smoke.test.js', 'price-change-history-oldprice.smoke.test.js',
  'print-queue.smoke.test.js', 'print-jobs-warehouse-scope.smoke.test.js',
  'print-barcode-void-receipt.smoke.test.js', 'print-template-preview.smoke.test.js', 'label-render-degrade.smoke.test.js', 'print-jobs-purge.test.js',
  'warehouse-scope.smoke.test.js', 'pda-device-session.smoke.test.js',
  'accounting.smoke.test.js', 'accounting-period.smoke.test.js', 'finance.smoke.test.js',
]

async function runRegressions({ proveOwnership, runSuite, files = suites }) {
  for (const file of files) {
    await proveOwnership()
    await runSuite(file)
  }
}

function selectSuites(requested) {
  if (requested === undefined) return suites
  assert.ok(typeof requested === 'string' && requested.length > 0, '定向回归须提供明确文件')
  const files = requested.split(',')
  const allowed = new Set([...suites, 'round2-transfer.smoke.test.js', 'product-finance-period.smoke.test.js', 'payments-default-scope.smoke.test.js'])
  assert.ok(files.every(file => allowed.has(file)) && new Set(files).size === files.length, '定向回归仅接受唯一的登记文件')
  return files
}

async function main() {
  const files = selectSuites(process.env.FLOWCUBE_CHANGE_REGRESSION_FILES)
  const config = validateTestEnvironment()
  assert.equal(config.database, 'flowcube_changerecords20261010_test')
  require('./retentionReprintIsolation')
  const mysql = require('../../backend/node_modules/mysql2/promise')
  const pool = mysql.createPool({ ...config, connectionLimit: 1 })
  const proveOwnership = async () => {
    const conn = await pool.getConnection()
    try { await assertOwnedRepairInstance(conn, { config }) } finally { conn.release() }
  }
  const redact = text => {
    for (const value of [process.env.DB_PASSWORD, process.env.JWT_SECRET]) if (value) text = text.split(value).join('[REDACTED]')
    return text.replace(/("(?:ackToken|ack_token|token|refreshToken|password|secret|credential)"\s*:\s*)"[^"\n]*"/gi, '$1"[REDACTED]"').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED-JWT]')
  }
  const runSuite = file => new Promise((resolve, reject) => {
    console.log('[change-regression] START ' + file)
    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'retentionReprintIsolation.js'), path.join(root, 'tests', file)], { cwd: root, env: { ...process.env, FLOWCUBE_TEST_ENV_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      let pending = ''
      stream.on('data', data => {
        pending += data.toString()
        const lines = pending.split('\n'); pending = lines.pop()
        for (const line of lines) target.write(redact(line) + '\n')
      })
      stream.on('end', () => { if (pending) target.write(redact(pending)) })
    }
    child.on('error', reject)
    child.on('close', code => {
      console.log('[change-regression] END ' + file + ' exit=' + code)
      code === 0 ? resolve() : reject(new Error('Owned regression failed: ' + file + ' exit=' + code))
    })
  })
  try { await runRegressions({ proveOwnership, runSuite, files }) } finally { await pool.end() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { runRegressions, suites, selectSuites }
