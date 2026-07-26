#!/usr/bin/env node
'use strict'

/**
 * 前后端权限码一致性校验（纯静态，不需要数据库）
 *
 * 权限码在两处手工维护：
 *   backend/src/constants/permissions.js  —— requirePermission 的判定依据
 *   frontend/src/lib/permission-codes.ts  —— 角色配置页勾选项 + 前端按钮显隐
 *
 * 两边靠人肉同步，漂移过一次就会静默出问题，而且方向不同、症状也不同：
 *   · 只在后端有 → 角色配置页里根本勾不到这个权限，功能等于被永久锁死
 *     （实测漂移：system.health.view / system.health.autofix / transfer.order.force-close，
 *      其中调拨「异常了结」前端有按钮、后端有校验，中间却没有可勾选的权限项）
 *   · 只在前端有 → 管理员以为授权了，后端根本不认，点下去照样 403
 *
 * 本测试把这件事变成门禁：任何一边加了码而另一边没跟上，CI 直接红。
 *
 * 运行：node tests/permission-codes.test.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function loadBackendCodes() {
  const { PERMISSIONS } = require(path.join(ROOT, 'backend/src/constants/permissions.js'))
  return new Set(Object.values(PERMISSIONS).filter(v => typeof v === 'string'))
}

function loadFrontendCodes() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/src/lib/permission-codes.ts'), 'utf8')
  // 只取 'xxx.yyy' / 'xxx.yyy-zzz' 形态的字面量，避免把 label 之类的中文串算进来
  const matches = src.match(/'[a-z][a-z_]*(\.[a-z_-]+)+'/g) || []
  return new Set(matches.map(s => s.slice(1, -1)))
}

function main() {
  const be = loadBackendCodes()
  const fe = loadFrontendCodes()
  const onlyBackend = [...be].filter(c => !fe.has(c)).sort()
  const onlyFrontend = [...fe].filter(c => !be.has(c)).sort()

  const lines = []
  lines.push('═'.repeat(60))
  lines.push('  权限码一致性校验')
  lines.push('═'.repeat(60))
  lines.push(`  后端 ${be.size} 个 / 前端 ${fe.size} 个`)

  let failed = 0
  if (onlyBackend.length) {
    failed += 1
    lines.push(`  [FAIL] 只在后端定义（角色配置页勾不到，功能被锁死）：${onlyBackend.join(', ')}`)
  } else {
    lines.push('  [PASS] 后端所有权限码在前端都可配置')
  }
  if (onlyFrontend.length) {
    failed += 1
    lines.push(`  [FAIL] 只在前端定义（授权了后端也不认，点下去 403）：${onlyFrontend.join(', ')}`)
  } else {
    lines.push('  [PASS] 前端没有后端不认识的权限码')
  }

  // 后端权限码必须全部小写点分，混入大写/空格会让 requirePermission 静默匹配不上
  const malformed = [...be].filter(c => !/^[a-z][a-z_]*(\.[a-z_-]+)+$/.test(c))
  if (malformed.length) {
    failed += 1
    lines.push(`  [FAIL] 后端权限码命名不合规：${malformed.join(', ')}`)
  } else {
    lines.push('  [PASS] 后端权限码命名全部合规（小写点分）')
  }

  lines.push('═'.repeat(60))
  console.log(lines.join('\n'))
  if (failed > 0) {
    console.error('\n权限码不一致：请同时更新 backend/src/constants/permissions.js 与 frontend/src/lib/permission-codes.ts')
    process.exit(1)
  }
}

main()
