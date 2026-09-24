'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { validateTestEnvironment } = require('./helpers/testEnvironment')

test('严格 schema 对账不把迁移创建的视图误判为意外物理表', () => {
  validateTestEnvironment()
  const script = path.resolve(__dirname, '../backend/scripts/schema-reconcile.js')
  const run = spawnSync(process.execPath, [script, '--strict'], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /意外表[^\n]*\n\s+- party_identity_names/)
})
