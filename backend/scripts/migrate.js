#!/usr/bin/env node

const { runMigrations } = require('../src/database/migrate')

// --check-gaps：只做编号静态检查（不连库），进 CI 用。
// 既有历史重复文件及缺号只提示，新文件造成的重复必须失败。
if (process.argv.includes('--check-gaps')) {
  runMigrations({ checkGapsOnly: true })
    .then((result) => {
      if (result?.newDuplicates?.length) {
        console.error('[Migrate] check-gaps FAILED：存在新增重复迁移编号，CI 拒绝通过')
        process.exit(1)
      }
      process.exit(0)
    })
    .catch((error) => {
      console.error('[Migrate] check-gaps failed:', error)
      process.exit(1)
    })
  return
}

require('dotenv').config()
runMigrations()
  .then(() => {
    console.log('[Migrate] done')
    process.exit(0)
  })
  .catch((error) => {
    // Long role differences must finish writing to stderr before termination.
    console.error('[Migrate] failed:', error.message || String(error))
    process.exitCode = 1
  })
