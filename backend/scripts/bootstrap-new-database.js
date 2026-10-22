#!/usr/bin/env node
'use strict'
// Credentials and target must be explicitly injected by the operator; no .env fallback.
const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
const missing = required.filter(key => process.env[key] === undefined || (key !== 'DB_PASSWORD' && !process.env[key].trim()))
if (missing.length) {
  console.error(`[Bootstrap] 必须显式配置 ${missing.join(', ')}；请核对新建空库目标后重试`)
  process.exitCode = 1
} else {
  const { bootstrapNewDatabase } = require('../src/database/bootstrapNewDatabase')
  bootstrapNewDatabase().catch(error => {
    console.error('[Bootstrap] failed:', error.message || String(error))
    process.exitCode = 1
  })
}
