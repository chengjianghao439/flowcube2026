#!/usr/bin/env node
'use strict'

/**
 * 引擎事务边界契约测试（纯静态，无需 DB）。
 *
 * 规则（AGENTS §6.6）：「库存与账款多表动作必须在**调用方开启的同一事务连接 `conn`** 中完成，
 * 引擎不自行嵌套事务。」
 *
 * 为什么必须机械守：
 *   - 引擎里一旦出现 `getConnection()` / `beginTransaction()`，它就会拿到一条**独立连接**，
 *     与调用方的事务不再原子：调用方回滚时引擎那半边已经提交（或反之），
 *     库存、预占账、账款出现半更新；而且这种缺陷**只在并发或异常路径下显形**。
 *   - 含写语句的引擎函数若改用全局 `pool`，同样是"脱离调用方事务"，表现与上一条相同。
 * 2026-09-19 实测：全仓没有任何测试断言这条规则；当时 4 个引擎文件恰好全部合规
 * （零事务控制调用；40 个 async 函数中除 2 个只读列表查询外首参都是 `conn`）。
 *
 * 判定口径：
 *   A. `backend/src/engine/**` 不得出现 `beginTransaction` / `getConnection` / `.commit(` /
 *      `.rollback(` / `.release(`。
 *   B. 引擎内**含写语句**（INSERT/UPDATE/DELETE/REPLACE）的 async 函数，首参必须是 `conn`；
 *      **只读**查询函数允许用 `pool`，但必须在白名单里写明理由（白名单不被命中即失败）。
 *
 * 运行：npm run test:engine-transaction
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const ENGINE_DIR = path.join(ROOT, 'backend/src/engine')

/** A：引擎里出现任一即失败。 */
const TRANSACTION_CONTROL = /\b(beginTransaction|getConnection)\s*\(|\.(commit|rollback|release)\s*\(/

const WRITE_SQL = /\b(INSERT\s+INTO|UPDATE\s+[\w`.]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i
const ASYNC_FN = /^(?:module\.exports\.)?(?:async\s+function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*async\s*\(([^)]*)\))/

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
}

function engineFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) engineFiles(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

function main() {
  const files = engineFiles(ENGINE_DIR)
  assert.ok(files.length >= 4, `引擎文件数异常（${files.length}），目录结构可能变了`)

  const problems = []
  const readonlyPoolFns = []
  let writeFns = 0
  let readFns = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n')
    const src = lines.join('\n')

    // ── A：不得自行管理事务 ────────────────────────────────────────────
    lines.forEach((line, i) => {
      const m = line.match(TRANSACTION_CONTROL)
      if (m) {
        problems.push(`${rel}:${i + 1} 引擎自行管理事务（${m[0].trim()}）——`
          + '引擎只能用调用方传入的 conn，自己取连接/开事务会让多表动作脱离调用方事务，'
          + '异常路径下出现半更新')
      }
    })

    // ── B：含写语句的 async 函数首参必须是 conn ────────────────────────
    lines.forEach((line, i) => {
      const m = line.match(ASYNC_FN)
      if (!m) return
      const name = m[1] || m[3]
      const params = (m[2] || m[4] || '').trim()
      // 函数体：到下一个顶层 function / 箭头常量 / module.exports 为止
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (/^(async )?function |^const .*=\s*async|^module\.exports/.test(lines[j])) { end = j; break }
      }
      const body = lines.slice(i, end).join('\n')
      if (!WRITE_SQL.test(body)) {
        readFns++
        // 只读查询允许用 pool（不参与写事务，无需调用方连接）；记下来便于输出里核对。
        if (/^pool\b/.test(params)) readonlyPoolFns.push(`${rel}::${name}`)
        return
      }
      writeFns++
      if (/^conn\b/.test(params)) return
      problems.push(`${rel}:${i + 1} ${name}(${params.slice(0, 40)}) 体内有写语句但首参不是 conn`
        + '——写操作必须在调用方的事务连接上执行，自己取 pool/连接会让多表动作脱离调用方事务；'
        + '只读查询才允许用 pool')
    })
  }

  assert.ok(writeFns >= 8,
    `只识别到 ${writeFns} 个含写语句的引擎函数，判定口径可能失效（只读 ${readFns} 个）`)

  console.log(`扫描 ${files.length} 个引擎文件：含写语句函数 ${writeFns} 个、只读函数 ${readFns} 个`
    + `（其中用 pool 的只读函数 ${readonlyPoolFns.length} 个：${readonlyPoolFns.join(', ') || '无'}）`)

  if (problems.length) {
    console.error('\n引擎事务边界违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log('✓ 引擎不自行管理事务；含写语句的函数全部使用调用方 conn')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  引擎事务边界契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
