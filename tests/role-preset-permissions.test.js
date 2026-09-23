const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PERMISSIONS } = require('../backend/src/constants/permissions')

test('job role presets only grant known permissions and keep reserved powers unassigned', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../backend/src/database/257_seed_job_role_presets.sql'), 'utf8')
  const grants = [...sql.matchAll(/SELECT '[^']+' AS code, '([^']+)' AS permission/g)].map(match => match[1])
  assert.ok(grants.length > 0, 'migration must contain preset grants')
  const known = new Set(Object.values(PERMISSIONS))
  assert.deepEqual(grants.filter(permission => !known.has(permission)), [], 'unknown permission')

  const reserved = new Set([
    PERMISSIONS.PAYMENT_CONFIRM,
    PERMISSIONS.FINANCE_ACCOUNT_ADJUST,
    PERMISSIONS.TRANSFER_ORDER_FORCE_CLOSE,
    PERMISSIONS.ACCOUNTING_PERIOD_MANAGE,
    PERMISSIONS.SALE_CREDIT_OVERRIDE,
  ])
  assert.deepEqual(grants.filter(permission => reserved.has(permission)
    || /^(user|role|settings|approval\.flow)\./.test(permission)), [], 'reserved power')
})

test('job role preset staging table uses the role code collation', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../backend/src/database/257_seed_job_role_presets.sql'), 'utf8')
  assert.match(sql, /CREATE TEMPORARY TABLE new_job_role_presets\s*\(code VARCHAR\(50\) PRIMARY KEY\)\s*ENGINE=MEMORY\s*DEFAULT CHARSET=utf8mb4\s*COLLATE=utf8mb4_unicode_ci/i)
})
