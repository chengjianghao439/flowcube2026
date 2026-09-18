#!/usr/bin/env node
'use strict'

/**
 * SQL 占位符契约测试（机械核对，无需 DB）。
 *
 * 背景（2026-09-18 修审计 [16] 时**顺手发现的线上 P0**）：`products.service.create` 的
 * `INSERT INTO product_items (...)` 列了 19 列，却写了 20 个 `?`。commit 34ef329
 * （「去序列化」那一批）从列名和参数数组里删掉了 `qa_required`，**漏删了一个占位符**，
 * 于是 `POST /api/products` 每次都以 `ER_PARSE_ERROR: ... near '?)'` 失败——新建商品
 * 全线不可用，而没有任何测试会碰到它：现有冒烟测试都用裸 SQL 直插 product_items，
 * 没有一条走 service.create。这类错「编译期、lint、类型检查都看不见」，只能用机械核对兜住。
 *
 * 判定口径（只认机械可判定的那种写法）：
 *   INSERT INTO <table> (a,b,c) VALUES (?,?,?)
 * 且 VALUES 里**只有** `?`、逗号与空白（含函数、字面量、子查询的一律跳过，避免误报）。
 * 列数必须等于占位符个数。
 *
 * 运行：node tests/sql-placeholder-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SCAN_DIRS = ['backend/src', 'backend/scripts']
/** 防「静默失效」的下限：正则或目录结构一旦改坏，扫到的语句会骤降，必须报错而不是变绿 */
const MIN_STATEMENTS = 80

const INSERT_RE = /INSERT\s+INTO\s+`?([A-Za-z_]\w*)`?\s*\(([^()]*?)\)\s*VALUES\s*\(([^()]*?)\)/gi

function collectFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(full))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function main() {
  const problems = []
  let checked = 0

  for (const rel of SCAN_DIRS) {
    const dir = path.join(ROOT, rel)
    if (!fs.existsSync(dir)) continue
    for (const file of collectFiles(dir)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const m of source.matchAll(INSERT_RE)) {
        const [, table, cols, vals] = m
        // 动态拼列名/参数的一律跳过：机械判定不了，宁可漏也不误报
        if (cols.includes('${') || vals.includes('${')) continue
        // VALUES 只允许 `?`、逗号、空白
        if (!/^[\s?,]*$/.test(vals)) continue
        const cols_ = cols.split(',').map(c => c.trim().replace(/`/g, '')).filter(Boolean)
        const placeholders = (vals.match(/\?/g) || []).length
        checked++
        if (cols_.length !== placeholders) {
          const line = source.slice(0, m.index).split('\n').length
          problems.push({
            where: `${path.relative(ROOT, file)}:${line}`,
            detail: `INSERT INTO ${table} 列了 ${cols_.length} 列（${cols_.join(',')}），却写了 ${placeholders} 个 ?`,
          })
        }
      }
    }
  }

  if (checked < MIN_STATEMENTS) {
    console.error(`扫描到的可机械判定 INSERT 只有 ${checked} 条（下限 ${MIN_STATEMENTS}）——`
      + '说明本测试的正则或扫描目录已经失效，请修好扫描逻辑，不要下调下限来让它变绿')
    process.exit(1)
  }

  if (problems.length) {
    console.error('SQL 占位符与列数不一致（运行期必然 ER_PARSE_ERROR，整条链路直接 500）：')
    for (const p of problems) console.error(`  ✗ ${p.where}  ${p.detail}`)
    console.error('  修法：让列名、占位符、参数数组三者数量一致；要么补回漏掉的列，要么删掉多余的 ?')
  } else {
    console.log(`✓ 已核对 ${checked} 条 INSERT：列数与 ? 个数全部一致`)
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  SQL 占位符契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处不一致'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

assert.ok(fs.existsSync(path.join(ROOT, 'backend', 'src')), '找不到 backend/src')
main()
