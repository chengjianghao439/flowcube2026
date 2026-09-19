#!/usr/bin/env node
'use strict'

/**
 * PDA 列表即时刷新契约测试（纯静态，无需 DB / 浏览器）。
 *
 * 规则（AGENTS §9，来自真实故障）：「PDA 列表必须即时刷新」——拣货、收货、打包、复核、
 * 调拨、盘点、退货列表统一 `refetchOnMount: 'always'`。keep-alive 下 PDA 页面组件常驻，
 * 不这样做就会出现「订单列表已空、商品列表仍显示待拣 0/2」或**「ERP 刚派发的单据看不到」**
 * ——仓库现场表现为"刷新了也没有单"，只能退出重进。
 *
 * 为什么需要机械守住：2026-09-19 实测，这条规则**全仓没有任何测试引用 `refetchOnMount`**，
 * 即零守卫。当时 12 处 PDA 列表查询恰好全部合规，所以只要有人新增一个列表页忘了写，
 * 全链路不会有任何提示。
 *
 * 判定范围（刻意收窄，避免误报）：
 *   只扫 `frontend/src/pages/pda/**` 与 `usePda*` hooks 里 **`useQuery({...})` 声明块内部**的
 *   `queryKey`——`invalidateQueries({ queryKey })`、`setQueryData` 等同名调用不算（第一版
 *   没区分，把 21 处失效调用误报成违规）。
 *   列表特征：queryKey 只有一段（详情查询必然带 id 参数，形如 `['pda-task', taskId]`），
 *   或以 `-pending` / `-items` 结尾。
 *
 * 运行：npm run test:pda-list-refresh
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'frontend/src')
const DECL_RE = /use(?:Visible)?Query\s*\(\s*\{/g

/** 文档里点名的七类 PDA 列表，必须各自仍有列表查询被扫到（防止守卫因删页面而静默失效）。 */
const REQUIRED_LIST_KEYS = [
  'pda-my-tasks',            // 拣货
  'pda-inbound-tasks',       // 收货 / 上架
  'pda-pack-tasks',          // 打包
  'pda-check-tasks',         // 复核
  'pda-transfers',           // 调拨
  'pda-stockcheck-pending',  // 盘点
  'pda-return-tasks',        // 退货
]

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'generated' || e.name === 'node_modules') continue
      collect(p, out)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
  }
  return out
}

/** 取 `useXxxQuery({` 之后配平的参数体，用于判断该次查询是否声明了刷新策略。 */
function readQueryBody(src, from) {
  let i = from
  let depth = 1
  let body = ''
  for (; i < src.length && depth > 0; i++) {
    const c = src[i]
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') {
      depth--
      if (depth === 0) break
    }
    body += c
  }
  return body
}

function main() {
  const files = collect(SRC).filter((f) => /\/pages\/pda\//.test(f) || /usePda/.test(f))
  assert.ok(files.length > 20, `PDA 文件数异常（${files.length}），目录结构可能变了`)

  const found = []
  const problems = []

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file)
    DECL_RE.lastIndex = 0
    let m
    while ((m = DECL_RE.exec(src)) !== null) {
      const body = readQueryBody(src, m.index + m[0].length)
      const km = body.match(/queryKey:\s*\[([^\]]*)\]/)
      if (!km) continue

      const keyExpr = km[1].trim()
      const isList = !keyExpr.includes(',') || /-(?:pending|items)['"]/.test(keyExpr)
      if (!isList) continue

      const line = src.slice(0, m.index).split('\n').length
      const hasRefresh = /refetchOnMount|refetchInterval/.test(body)
      found.push({ rel, line, keyExpr })
      if (!hasRefresh) {
        problems.push(`${rel}:${line} 列表查询 [${keyExpr}] 没有声明 refetchOnMount 或 refetchInterval`
          + '：keep-alive 下 PDA 组件常驻，缺少它会出现「ERP 刚派发的单据看不到」')
      }
    }
  }

  // 反空转：扫到 0 处说明判定口径或目录结构失效，不能让守卫"全绿但什么都没查"。
  assert.ok(found.length >= 10, `只扫到 ${found.length} 处 PDA 列表查询，判定口径可能失效`)
  const keys = new Set(found.flatMap((f) => [...f.keyExpr.matchAll(/'([^']+)'/g)].map((x) => x[1])))
  const missing = REQUIRED_LIST_KEYS.filter((k) => !keys.has(k))
  assert.deepEqual(missing, [],
    `文档点名的 PDA 列表查询已扫不到，请确认页面是否被改名/删除并同步本清单：${missing.join(', ')}`)

  console.log(`扫描 ${files.length} 个 PDA 文件，列表查询 ${found.length} 处，覆盖 ${keys.size} 个 key`)

  if (problems.length) {
    console.error('\nPDA 列表刷新契约违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log('✓ PDA 列表查询均已声明 refetchOnMount 或 refetchInterval')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  PDA 列表刷新契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
