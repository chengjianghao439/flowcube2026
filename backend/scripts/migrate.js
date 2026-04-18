#!/usr/bin/env node
require('dotenv').config()

const { runMigrations } = require('../src/database/migrate')

runMigrations()
  .then(() => {
    console.log('[Migrate] done')
    process.exit(0)
  })
  .catch((error) => {
    console.error('[Migrate] failed:', error)
    process.exit(1)
  })
