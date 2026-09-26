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
 *   2. 既轮询又显式传 `pageSize` 的页面，批量不得小于 100（已核实不生效的豁免逐条登记在 allowlist）。
 *
 * 运行：node tests/frontend-polling-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'frontend/src')

const MIN_INTERVAL_MS = 5000
const MIN_POLLED_PAGE_SIZE = 100

/**
 * 扫整个 `frontend/src`，不只是 `pages/`。
 *
 * 2026-09-19 发现范围缺口：本测试自称「任何 `refetchInterval` 都不得小于 5 秒」，但只
 * `walk(PAGES)`——而轮询点早已搬到 hooks 里（`usePdaAdjustment`、`usePdaCancelReturn`、
 * `usePdaTodoCounts`、`usePollingReport`）。这些文件当时恰好合规（15s/30s），所以守卫一直
 * 全绿；但只要有人在 hooks 里写 `refetchInterval: 3_000`，**自旋的页面就全都不在扫描范围里**。
 * 这类「守卫覆盖小于它声明的规则」和规则本身同样危险，故一并扫 `hooks/`、`components/`。
 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      // generated 是机器产物，不参与源码契约
      if (e.name === 'generated' || e.name === 'node_modules') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
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
  const files = walk(SRC)
  assert.ok(files.length > 100, `前端源码文件数异常（${files.length}），目录结构可能变了`)

  // 已核对的「pageSize 写小了、但不会放大请求」的调用。这类豁免有共同的根因：
  // **外部 pageSize 根本没被采用**。守卫只做文本匹配，看不到 client 里的分支，故逐条登记并写明证据；
  // 未命中的登记条目会让测试失败，避免清单僵化。
  //   1. `listMode: 'summary'`（client.ts:402 分支）单页直返，不进 `collectAllRecords` 取齐，
  //      不按 ceil(总数/批量) 放大；
  //   2. 默认取齐路径会先把 pageSize 传出去，但 client.ts:415 先**无条件 delete** 掉它，
  //      实际批量由 `pageSize ?? 200` 决定——已用 HTTP 拦截测试实测，见
  //      frontend/src/api/warehouse-tasks.return-out-paging.test.ts。
  const BOUNDED_SUMMARY_ALLOWLIST = new Map([
    ['frontend/src/hooks/useDashboard.ts:61',
      '首页「待我审批」只展示前 5 条摘要：listPendingApprovalsApi(..., true) → listMode: summary 单页直返'],
    ['frontend/src/pages/inbound-tasks/index.tsx:104',
      '入库任务列表走默认取齐路径：client.ts:415 已 delete 外部 pageSize，首请实际 pageSize=200'
      + '（后端 normalizePagination clamp 到 [1,500]，200 原样通过），写的 20 不生效、不放大请求'],
  ])
  const usedAllowlist = new Set()

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
      // 表达式用具名常量时（如 `isActiveTab ? AUTO_REFRESH_MS : false`），字面量扫描看不到数字，
      // `!nums.length` 就 continue，于是**这个轮询点静默脱离守卫**——2026-09-19 把「条码打印查询」
      // 的 15000 提成常量时踩到：polled 从 28 掉回 27，而输出仍是 PASS。这里回溯同文件的常量定义
      // 把值捞回来，保证覆盖不因「提取常量」这种无害重构而消失（反向验证：把该常量改成 3000 必须失败）。
      if (!nums.length) {
        for (const ident of expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
          const dm = source.match(new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*(\\d[\\d_]*)`))
          if (dm) nums.push(Number(dm[1].replace(/_/g, '')))
        }
      }
      if (!nums.length) continue
      polled++
      const min = Math.min(...nums.filter(n => n > 0))
      if (min < MIN_INTERVAL_MS) {
        problems.push(`${rel}:${lineOf(source, m.index)} 轮询间隔 ${min}ms 小于 ${MIN_INTERVAL_MS}ms（${expr.trim()}）`)
      }
    }

    // 2) 既轮询又显式指定 pageSize 时，批量不能太小
    //
    // 2026-09-26 订正：本节开头写「自动取齐会把批量从默认 200 缩到 20」，这句**已不成立**。
    // 现在的 `payloadClient.get`（client.ts:415）**无条件 delete 掉外部 page/pageSize**，再改由
    // `collectAllRecords` 从第 1 页重算，所以默认列表路径下**外部 pageSize 根本不生效**——
    // 写 20 和写 200 发出的是同一个请求（首请 `pageSize ?? 200`，后端 clamp 到 [1,500]）。
    // 已用 HTTP 层拦截测试实测（frontend/src/api/warehouse-tasks.return-out-paging.test.ts：
    // 传 page=2 实测发出的是 page=1&pageSize=200）。
    //
    // 真正让外部 pageSize 生效的只有两种 listMode：`summary`（单页直返）与 `paged`（原样透传）。
    // 但**本测试看不出某个 pageSize 属于哪种调用**：summary 往往写在被调的 API 文件里
    // （如 useDashboard → listPendingApprovalsApi → approvals.ts），页面文件里没有任何 listMode 字面。
    // 所以这里**不按 listMode 收窄范围**（那会漏掉整类真实场景）；仍然检查所有轮询文件的 pageSize，
    // 把「已核实外部 pageSize 被丢弃、因而无放大」的调用逐条登记进 allowlist——保守，且不会漏。
    if (/refetchInterval/.test(source)) {
      // 与上面 refetchInterval 同款陷阱：正则原先只认数字字面量，`pageSize: SOME_CONST`
      // 就静默脱离守卫。2026-09-26 实测：把轮询页的 `pageSize: 20` 提成具名常量
      // `RETURN_OUT_PAGE_SIZE = 20`，本测试照样 PASS——「守卫覆盖小于它声明的规则」。
      // 故这里也回溯同文件常量定义；表达式含多个数字时取最小（保守）。
      const pageSizeRe = /pageSize\s*:\s*([^,}\n]+)/g
      let ps
      while ((ps = pageSizeRe.exec(source)) !== null) {
        const expr = ps[1]
        const nums = (expr.match(/\d[\d_]*/g) || []).map(s => Number(s.replace(/_/g, '')))
        if (!nums.length) {
          for (const ident of expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
            const dm = source.match(new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*(\\d[\\d_]*)`))
            if (dm) nums.push(Number(dm[1].replace(/_/g, '')))
          }
        }
        if (!nums.length) continue
        const size = Math.min(...nums)
        if (size >= MIN_POLLED_PAGE_SIZE) continue
        const key = `${rel}:${lineOf(source, ps.index)}`
        if (BOUNDED_SUMMARY_ALLOWLIST.has(key)) { usedAllowlist.add(key); continue }
        problems.push(`${key} 轮询页面的 pageSize=${size} 小于 ${MIN_POLLED_PAGE_SIZE}`
          + '（自动取齐会按 ceil(总数/批量) 串行请求，批量越小请求越多）')
      }
    }
  }

  const staleAllowlist = [...BOUNDED_SUMMARY_ALLOWLIST.keys()].filter(k => !usedAllowlist.has(k))
  assert.deepEqual(staleAllowlist, [],
    `这些有界摘要豁免已不再命中（代码已改或已删除），必须从清单里删掉：${staleAllowlist.join(', ')}`)

  console.log(`扫描源码 ${files.length} 个（frontend/src 全量，含 hooks/components），发现轮询点 ${polled} 处`)

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
