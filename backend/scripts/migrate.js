#!/usr/bin/env node
require('dotenv').config()

const { runMigrations } = require('../src/database/migrate')

// --check-gaps：只做编号静态检查（不连库），进 CI 用。
// 历史遗留的重复/缺号只 warn 不失败（修复计划 4.10：校验存在即可，不因历史遗留阻断 CI）。
if (process.argv.includes('--check-gaps')) {
  runMigrations({ checkGapsOnly: true })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[Migrate] check-gaps failed:', error)
      process.exit(1)
    })
  return
}

runMigrations()
  .then(() => {
    console.log('[Migrate] done')
    process.exit(0)
  })
  .catch((error) => {
    console.error('[Migrate] failed:', error)
    process.exit(1)
  })
