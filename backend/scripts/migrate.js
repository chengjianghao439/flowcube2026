#!/usr/bin/env node
require('dotenv').config()

const { runMigrations } = require('../src/database/migrate')

// --check-gaps：只做编号静态检查（不连库），进 CI 用。
// 历史遗留的重复（057/064/089）与缺号（008/009/040）只 warn 不失败；
// 但「新增的重复编号」（撞已有迁移文件）必须失败——防止手滑新建同号迁移文件在部署时才暴露。
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

runMigrations()
  .then(() => {
    console.log('[Migrate] done')
    process.exit(0)
  })
  .catch((error) => {
    console.error('[Migrate] failed:', error)
    process.exit(1)
  })
