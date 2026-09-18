#!/usr/bin/env node
'use strict'

/**
 * 前端登出路径契约测试（纯静态，无需 DB）。
 *
 * 背景（2026-09-18 多维度审计 P2）：PDA 工作台的「重新登录」直接调了 store 的 `logout()`，
 * 绕过了 `lib/authSession.performSessionLogout()`，于是**不清 React Query 缓存、不作废服务端
 * refresh token、也不清 PDA 待确认请求记录**。PDA 是共用设备，换班/换人后会看到上一账号的
 * 列表数据与「结果待确认」误报。
 *
 * 这类问题会随着新页面/新入口反复出现（ERP 侧 2026-08-21 修过一次、PDA 侧又漏），
 * 所以做成机械契约：**除统一封装与 store 定义本身外，任何前端源码都不得直接调用登出**。
 *
 * 运行：node tests/frontend-session-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'frontend/src')

/** 允许直接调用登出的文件（统一封装 + store 定义） */
const ALLOWED = new Set([
  'frontend/src/lib/authSession.ts',
  'frontend/src/store/authStore.ts',
])

/** 直接登出调用：`.logout()` 或从 store 解构 `s => s.logout` */
const DIRECT_LOGOUT = /(?:\.logout\(\)|\bs\s*=>\s*s\.logout\b)/

/** 认作「统一封装」的证据：修复后页面必须引用它 */
const SESSION_HELPER = 'performSessionLogout'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

function main() {
  const files = walk(SRC).filter(f => !/\.test\.(ts|tsx)$/.test(f))
  assert.ok(files.length > 100, `前端源码文件数异常（${files.length}），目录结构可能变了`)

  const violations = []
  let allowedHits = 0
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const source = fs.readFileSync(f, 'utf8')
    if (!DIRECT_LOGOUT.test(source)) continue
    if (ALLOWED.has(rel)) { allowedHits++; continue }
    const line = source.slice(0, source.search(DIRECT_LOGOUT)).split('\n').length
    violations.push(`${rel}:${line}`)
  }

  console.log(`扫描前端源码 ${files.length} 个文件；统一封装与 store 定义中的合法调用 ${allowedHits} 处`)

  if (violations.length) {
    console.error('\n以下文件绕过了统一登出封装，直接调用 store 的登出：')
    for (const v of violations) console.error('  ✗ ' + v)
    console.error(`\n请改用 lib/authSession 的 ${SESSION_HELPER}()——它才会清 React Query 缓存、`)
    console.error('作废服务端 refresh token 并清 PDA 待确认请求记录。')
  } else {
    console.log(`✓ 没有页面/组件直接调用登出（统一走 ${SESSION_HELPER}）`)
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  前端登出路径契约: ${violations.length === 0 ? 'PASS' : violations.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(violations.length ? 1 : 0)
}

main()
