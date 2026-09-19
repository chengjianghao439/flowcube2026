#!/usr/bin/env node
'use strict'

/**
 * 打印/补打入口契约测试（纯静态，无需 DB / 浏览器）。
 *
 * 规则（AGENTS §10，2026-09-14 用户明确的业务规则）：
 *   **补打只有一个入口——打印记录页**；其它页面（含收货/销售订单详情）不得提供补打。
 *   订单类页面只看进度：**销售订单不显示条码打印**（出货侧不打条码）、收货订单不展示打印记录。
 *   例外只有本页自己的标签入口：商品/库位/货架标签各有各的打印入口；
 *   塑料盒是**可复用固定码**，在塑料盒页「打印条码」重复打印（那是重复打印，不是补打）；
 *   PDA 打包页「重新入队打印」用于箱贴尚未打印成功的情况（服务端强制箱贴成功才可出库）。
 *   记录页只列唯一码，且入库额外排除 `source_ref_type='plastic_box_create'`。
 *
 * 为什么需要机械守住：2026-09-19 实测，这条规则**只有文档**——全仓没有任何测试引用这些
 * 打印入口。当时 6 个入口各自都恰好只被"该被它服务"的页面调用，所以任何人顺手在订单详情
 * 或销售页加一个补打按钮，全链路不会有任何提示。
 *
 * 判定口径：
 *   A. 逐个找出"打印端点"（URL 含 `/print-label` 或 `/reprint` 的前端函数），再找它们的调用页；
 *   B. 补打端点 `/print-jobs/barcodes/reprint` 的调用页**必须且只能是**打印记录页；
 *   C. 其余每个入口的调用页都必须在白名单里逐条写明理由（白名单不被命中即失败）；
 *   D. 销售相关页面不得引用任何打印端点（出货侧不打条码）；
 *   E. 记录页的入库条码查询必须排除塑料盒固定码（列表与计数两处）。
 *
 * 运行：npm run test:print-entry
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const FRONTEND = path.join(ROOT, 'frontend/src')

const REPRINT_URL_MARK = '/print-jobs/barcodes/reprint'
const PRINT_RECORDS_PAGE = 'frontend/src/pages/settings/barcode-print-query/index.tsx'

/** C：非补打端点允许的调用页。key = `调用文件::函数名`。 */
const ENTRY_ALLOWLIST = new Map([
  [`frontend/src/pages/products/index.tsx::printProductLabelApi`,
    '商品标签：商品页自己的打印入口，不在补打中心范围内'],
  [`frontend/src/pages/locations/index.tsx::printLocationLabelApi`,
    '库位标签：库位页自己的打印入口'],
  [`frontend/src/pages/racks/index.tsx::printRackLabelApi`,
    '货架标签：货架页自己的打印入口'],
  [`frontend/src/pages/plastic-boxes/index.tsx::printPlasticBoxLabelApi`,
    '塑料盒是可复用固定码，本页「打印条码」是重复打印（记录页也刻意不收录它）'],
  [`frontend/src/pages/pda/pack.tsx::printPackageLabelApi`,
    'PDA 打包页「重新入队打印」：箱贴未打印成功时补发，服务端强制箱贴成功才允许出库'],
])

/** D：这些页面属于"销售出货侧"，不得出现任何条码打印入口。 */
const SALE_SIDE = /frontend\/src\/pages\/sale\/|frontend\/src\/components\/shared\/Sale[A-Za-z]*\.tsx$/

const PRINT_URL_RE = /`[^`]*\/print-label`|'[^']*\/print-label'|`[^`]*\/reprint`|'[^']*\/reprint'|`[^`]*barcodes\/reprint`/
const EXPORT_NAME_RE = /export\s+(?:async\s+)?(?:const|function)\s+([A-Za-z0-9_$]+)/

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'generated' || e.name === 'node_modules') continue
      collect(p, out)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.guard\.test\.ts$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function main() {
  const files = collect(FRONTEND)
  assert.ok(files.length > 300, `前端源码文件数异常（${files.length}），目录结构可能变了`)

  // ── A：找出所有打印端点（函数名 → URL），再找调用页 ─────────────────────
  const endpoints = new Map()   // 函数名 -> { url, defFile }
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!PRINT_URL_RE.test(line)) return
      for (let j = i; j >= 0 && j > i - 40; j--) {
        const m = lines[j].match(EXPORT_NAME_RE)
        if (!m) continue
        endpoints.set(m[1], {
          url: line.trim(),
          defFile: path.relative(ROOT, file),
        })
        break
      }
    })
  }

  assert.ok(endpoints.size >= 5,
    `只找到 ${endpoints.size} 个打印端点，判定口径可能失效：${[...endpoints.keys()].join(', ')}`)
  const reprintEntry = [...endpoints.entries()].find(([, v]) => v.url.includes(REPRINT_URL_MARK))
  assert.ok(reprintEntry, `找不到补打端点（URL 含 ${REPRINT_URL_MARK}），规则的前提没了`)

  const problems = []
  const usedAllow = new Set()
  const callSites = []

  for (const [fn, info] of endpoints) {
    const callers = new Set()
    for (const file of files) {
      const rel = path.relative(ROOT, file)
      if (rel === info.defFile) continue
      if (new RegExp(`\\b${fn}\\b`).test(fs.readFileSync(file, 'utf8'))) callers.add(rel)
    }

    // D：销售出货侧不得出现任何打印端点
    for (const c of callers) {
      if (SALE_SIDE.test(c)) {
        problems.push(`${c} 引用了打印端点 ${fn}（${info.url}）——`
          + '销售订单不显示条码打印（出货侧不打条码），补打只能走打印记录页')
      }
    }

    // B：补打端点唯一入口
    if (fn === reprintEntry[0]) {
      const unexpected = [...callers].filter((c) => c !== PRINT_RECORDS_PAGE)
      assert.deepEqual(unexpected, [],
        `补打端点 ${fn} 被这些页面调用了：${unexpected.join(', ')}——`
        + `补打只有一个入口，只能是 ${PRINT_RECORDS_PAGE}`)
      assert.ok(callers.has(PRINT_RECORDS_PAGE),
        `打印记录页不再调用补打端点 ${fn}，规则的前提没了`)
      continue
    }

    // C：其余入口逐个走白名单
    for (const c of callers) {
      const key = `${c}::${fn}`
      callSites.push(key)
      if (ENTRY_ALLOWLIST.has(key)) usedAllow.add(key)
      else {
        problems.push(`${c} 调用了打印端点 ${fn}（${info.url}）但不在白名单里——`
          + '请确认这是该页自己的标签入口，还是不应存在的补打入口；确认后写进白名单并说明理由')
      }
    }
  }

  const staleAllow = [...ENTRY_ALLOWLIST.keys()].filter((k) => !usedAllow.has(k))
  assert.deepEqual(staleAllow, [],
    `这些白名单条目已不再命中（入口已删或已搬家），必须从清单里删掉：${staleAllow.join(' | ')}`)

  // E：记录页的入库条码查询必须排除塑料盒固定码（列表 + 计数）
  const querySrc = fs.readFileSync(
    path.join(ROOT, 'backend/src/modules/print-jobs/print-jobs.query.js'), 'utf8',
  )
  const exclusions = (querySrc.match(/<> 'plastic_box_create'/g) || []).length
  assert.ok(exclusions >= 2,
    `print-jobs.query.js 里塑料盒排除只出现 ${exclusions} 处：入库条码的列表与计数查询都必须排除 `
    + "source_ref_type='plastic_box_create'（可复用固定码不进唯一码记录页）")

  console.log(`扫描 ${files.length} 个前端文件：打印端点 ${endpoints.size} 个，`
    + `白名单命中 ${usedAllow.size} 处，塑料盒排除 ${exclusions} 处`)

  if (problems.length) {
    console.error('\n打印/补打入口违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log('✓ 补打唯一入口成立，其余打印入口均在各自主页且已登记，销售侧无打印入口')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  打印/补打入口契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
