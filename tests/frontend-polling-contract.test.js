#!/usr/bin/env node
'use strict'

/**
 * 前端轮询与分页批量契约测试（纯静态，无需 DB）。
 *
 * 背景（2026-09-18 多维度审计 P2）：「条码打印查询」页同时犯了两个错——
 * 写死 `pageSize: 20`（列表走 payloadClient 自动取齐，会把批量从默认 200 缩到 20、
 * 请求数放大 10 倍）**并且**每 3 秒轮询，于是约 1000 条记录就是 ~1000 次/分，
 * 恰好打满全局 IP 限流。限流按 IP，同一出口的整个办公室会被一起限流。
 *
 * 单独看「3 秒轮询」或「批量 20」都不算离谱，**乘起来才出事**，所以机械契约同时管两头：
 *   1. 任何 `refetchInterval` 都不得小于 5 秒（表格/记录类页面没有秒级实时性要求）；
 *   2. 既轮询又显式传 `pageSize` 的页面，批量不得小于 100（自动取齐按 ceil(总数/批量) 串行请求）。
 *
 * 运行：node tests/frontend-polling-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PAGES = path.join(ROOT, 'frontend/src/pages')

const MIN_INTERVAL_MS = 5000
const MIN_POLLED_PAGE_SIZE = 100

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/**
 * 剥离注释后再扫描：否则**注释里对旧写法的引述**（如本页修复说明里写的 `pageSize: 20`）
 * 会被当成真实代码报违规——本测试第一版就踩了这个坑。
 * 用等长空白替换，保留偏移与换行，使行号仍然准确。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
}

function main() {
  const files = walk(PAGES)
  assert.ok(files.length > 20, `页面文件数异常（${files.length}），目录结构可能变了`)

  const problems = []
  let polled = 0

  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const source = stripComments(fs.readFileSync(f, 'utf8'))

    // 1) 轮询间隔下限
    const intervalRe = /refetchInterval\s*:\s*([^,\n]+)/g
    let m
    while ((m = intervalRe.exec(source)) !== null) {
      const expr = m[1]
      const nums = (expr.match(/\d[\d_]*/g) || []).map(s => Number(s.replace(/_/g, '')))
      if (!nums.length) continue
      polled++
      const min = Math.min(...nums.filter(n => n > 0))
      if (min < MIN_INTERVAL_MS) {
        problems.push(`${rel}:${lineOf(source, m.index)} 轮询间隔 ${min}ms 小于 ${MIN_INTERVAL_MS}ms（${expr.trim()}）`)
      }
    }

    // 2) 既轮询又显式指定 pageSize 时，批量不能太小
    if (/refetchInterval/.test(source)) {
      const pageSizeRe = /pageSize\s*:\s*(\d[\d_]*)/g
      let ps
      while ((ps = pageSizeRe.exec(source)) !== null) {
        const size = Number(ps[1].replace(/_/g, ''))
        if (size < MIN_POLLED_PAGE_SIZE) {
          problems.push(`${rel}:${lineOf(source, ps.index)} 轮询页面的 pageSize=${size} 小于 ${MIN_POLLED_PAGE_SIZE}`
            + '（自动取齐会按 ceil(总数/批量) 串行请求，批量越小请求越多）')
        }
      }
    }
  }

  console.log(`扫描页面 ${files.length} 个，发现轮询点 ${polled} 处`)

  if (problems.length) {
    console.error('\n前端轮询/分页契约违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log(`✓ 轮询间隔均 ≥ ${MIN_INTERVAL_MS}ms，轮询页面的批量均 ≥ ${MIN_POLLED_PAGE_SIZE}`)
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  前端轮询契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
