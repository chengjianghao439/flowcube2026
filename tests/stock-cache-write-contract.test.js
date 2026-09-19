#!/usr/bin/env node
'use strict'

/**
 * 库存缓存写入入口契约测试（纯静态，无需 DB）。
 *
 * 规则（AGENTS §6.1/§6.2，全系统最重要的数据完整性不变量）：
 *   - `inventory_containers.remaining_qty` 是**唯一事实源**；`inventory_stock.quantity` 只是缓存，
 *     **唯一合法写入口是 `containerEngine.syncStockFromContainers()`**；
 *   - `inventory_stock.reserved` 只能经 `reservationEngine` 或 `inventoryEngine` 的合法入口变更。
 *
 * 为什么必须机械守：任何一处业务代码直接 `UPDATE inventory_stock SET quantity=...` 都会让缓存与
 * 容器实际总和**静默分叉**——读库存、算可用量、报表估值全都跟着错，而**没有任何测试会红**
 * （2026-09-18 审计与迁移 131 的注释里都记录过同类漂移事故）。
 *
 * 判定口径：
 *   A. 写 `inventory_stock` 的 `quantity` 的文件只允许 `engine/containerEngine.js`；
 *      `reserved` 只允许 `engine/reservationEngine.js` 与 `engine/inventoryEngine.js`。
 *   B. 每个写 `inventory_containers.remaining_qty` 的**函数**，必须在同一函数体内调用
 *      `syncStockFromContainers()`，或命中下面的豁免表（豁免必须写明"为什么这次改动不改变
 *      该 (商品,仓库) 的 ACTIVE 合计"）。
 *      ——「由调用方负责同步」也属于要写清理由的情形：扣减原语本身不刷缓存，风险全在调用方。
 *
 * 豁免表不被命中即失败（防僵化）；扫描到的写点少于基线也失败（防口径失效导致"全绿但没查"）。
 *
 * 运行：npm run test:stock-cache-write
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'backend/src')

/** A：库存缓存字段的唯一合法写入文件。 */
const QUANTITY_WRITERS = new Set(['backend/src/engine/containerEngine.js'])
const RESERVED_WRITERS = new Set([
  'backend/src/engine/reservationEngine.js',
  'backend/src/engine/inventoryEngine.js',
])

/** B：写 remaining_qty 但同函数内确实不需要刷缓存的正当情形。 */
const SYNC_ALLOWLIST = new Map([
  ['backend/src/engine/containerEngine.js::deductFromContainers',
    '扣减原语：缓存由调用方刷新——inventoryEngine 扣减后调 syncStockFromContainers，'
    + 'transferContainers / adjustContainersForStockcheck / adjustContainerStock 也各在同一函数内刷新'],
  ['backend/src/engine/containerEngine.js::deductFromTaskLockedContainers',
    '同上：唯一调用方 inventoryEngine 在同一函数内扣减后刷新缓存'],
  ['backend/src/engine/containerEngine.js::splitTaskLockedContainerForReturn',
    '拆分守恒：原容器 remaining 减 q、新容器以 ACTIVE 建 q，(商品,仓库) 的 ACTIVE 合计不变，'
    + '缓存无需刷新（函数内注释亦写明）'],
  ['backend/src/modules/return-tasks/return-tasks.service.js::allocateQaContainers',
    '只把 PENDING_QA 拆成 待质检/待上架/不合格，三种状态都不计入 ACTIVE 合计，缓存不受影响'],
])

const REMAINING_QTY_WRITE = /UPDATE\s+inventory_containers[\s\S]{0,300}?remaining_qty/gi
/**
 * 缓存字段的写入只认两种真实语句形态：
 *   UPDATE inventory_stock ... SET <field> = ...
 *   INSERT INTO inventory_stock (...) VALUES ... ON DUPLICATE KEY UPDATE <field> = ...
 * 第一版漏了后者（`containerEngine` 的 upsert 就是这种写法），又把 `SELECT ... const reserved =`
 * 和文档注释里的字样算成写入——所以这里先剥注释，再只匹配这两种形态。
 */
const STOCK_WRITE = new RegExp(
  '(?:UPDATE\\s+inventory_stock[\\s\\S]{0,300}?SET\\s[\\s\\S]{0,200}?(quantity|reserved)\\s*=)'
  + '|(?:INSERT\\s+INTO\\s+inventory_stock[\\s\\S]{0,300}?ON\\s+DUPLICATE\\s+KEY\\s+UPDATE\\s[\\s\\S]{0,200}?(quantity|reserved)\\s*=)',
  'gi',
)
const SYNC_CALL = /syncStockFromContainers\s*\(/

/** 剥注释：等长空白替换，保留偏移与行号（AGENTS §0.1：源码文本契约测试先去注释）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
}

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 找出所在函数名与函数体范围（顶层 function / 箭头常量函数 / 对象方法）。 */
function enclosingFunction(lines, startLine) {
  for (let i = startLine; i >= 0; i--) {
    const m = lines[i].match(
      /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*async\s*\(|^\s{2}([A-Za-z0-9_$]+)\s*:\s*async\s*\(/,
    )
    if (!m) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(async )?function |^const .*=\s*async|^module\.exports/.test(lines[j])) { end = j; break }
    }
    return { name: m[1] || m[2] || m[3], from: i, to: end, body: lines.slice(i, end).join('\n') }
  }
  return { name: '(文件顶层)', from: 0, to: lines.length, body: lines.join('\n') }
}

function main() {
  const files = collect(SRC)
  assert.ok(files.length > 200, `后端源码文件数异常（${files.length}），目录结构可能变了`)

  const problems = []
  const usedAllow = new Set()
  let qtyWrites = 0
  let remainingWrites = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    const lines = src.split('\n')

    // ── A：缓存字段的唯一写入口 ─────────────────────────────────────────
    STOCK_WRITE.lastIndex = 0
    let m
    while ((m = STOCK_WRITE.exec(src)) !== null) {
      const field = m[1] || m[2]
      qtyWrites++
      const line = src.slice(0, m.index).split('\n').length
      const allowed = field === 'quantity' ? QUANTITY_WRITERS : RESERVED_WRITERS
      if (!allowed.has(rel)) {
        problems.push(`${rel}:${line} 直接写 inventory_stock.${field}——`
          + (field === 'quantity'
            ? '唯一合法入口是 containerEngine.syncStockFromContainers()（容器汇总才是一手数据）'
            : '只能经 reservationEngine / inventoryEngine 的合法入口变更'))
      }
    }

    // ── B：写 remaining_qty 的函数必须刷缓存或有豁免 ─────────────────────
    REMAINING_QTY_WRITE.lastIndex = 0
    let w
    while ((w = REMAINING_QTY_WRITE.exec(src)) !== null) {
      remainingWrites++
      const line = src.slice(0, w.index).split('\n').length
      const fn = enclosingFunction(lines, line - 1)
      if (SYNC_CALL.test(fn.body)) continue
      const key = `${rel}::${fn.name}`
      if (SYNC_ALLOWLIST.has(key)) { usedAllow.add(key); continue }
      problems.push(`${rel}:${line} 在 ${fn.name}() 里改了 remaining_qty 但同函数内没有 `
        + 'syncStockFromContainers()：事实源变了却没刷 inventory_stock.quantity 缓存，'
        + '会静默漂移。请补刷新，或在守卫豁免表里写明「为什么这次改动不改变该维度的 ACTIVE 合计」')
    }
  }

  // 反空转 + 防僵化
  assert.ok(remainingWrites >= 8,
    `只扫到 ${remainingWrites} 处 remaining_qty 写入，判定口径可能已失效`)
  assert.ok(qtyWrites >= 5,
    `只扫到 ${qtyWrites} 处 inventory_stock 写入，判定口径可能已失效`)
  const staleAllow = [...SYNC_ALLOWLIST.keys()].filter((k) => !usedAllow.has(k))
  assert.deepEqual(staleAllow, [],
    `这些豁免已不再命中（代码已改或已删除），必须从清单里删掉：${staleAllow.join(' | ')}`)

  console.log(`扫描 ${files.length} 个后端文件：inventory_stock 写入 ${qtyWrites} 处、`
    + `remaining_qty 写入 ${remainingWrites} 处（豁免 ${usedAllow.size} 处）`)

  if (problems.length) {
    console.error('\n库存缓存写入入口违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log('✓ 库存缓存只由引擎入口写入，且每次改事实源都刷了缓存（或已豁免并写明理由）')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  库存缓存写入契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
