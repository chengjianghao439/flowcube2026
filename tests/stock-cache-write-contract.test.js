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

const { parse, visit, owner, functionName, callName, literals, filesUnder } = require('./helpers/contractSource')

// 只读取赋值左值。引号内的文字、表达式内的逗号及 SQL 注释均不参与分列。
function assignments(sql) {
  if (!/inventory_(?:stock|containers)/i.test(sql)) return []
  const tokens = (sql.match(/'(?:\\[\s\S]|''|[^'\\])*'|"(?:\\[\s\S]|""|[^"\\])*"|\x60(?:\x60\x60|[^\x60])*\x60|\/\*[\s\S]*?\*\/|--[ \t][^\n]*|#[^\n]*|[\w$]+|[^\s]/g) || [])
    .filter(t => !t.startsWith('/*') && !t.startsWith('--') && !t.startsWith('#'))
    .map(t => t.startsWith('\x60') ? t.slice(1, -1).replaceAll('\x60\x60', '\x60').toLowerCase() : t.toLowerCase())
  let table, start
  if (tokens[0] === 'update') {
    table = tokens[1]
    start = tokens.indexOf('set')
  } else if (tokens[0] === 'insert' && tokens[1] === 'into') {
    table = tokens[2]
    start = tokens.findIndex((t, i) => t === 'update' && tokens.slice(i - 3, i).join(' ') === 'on duplicate key')
  }
  if (!['inventory_stock', 'inventory_containers'].includes(table) || start == null || start < 0) return []
  const fields = []
  let atStart = true, depth = 0
  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (depth === 0 && ['where', 'order', 'limit', ';'].includes(token)) break
    if (atStart) {
      const pos = tokens[i + 1] === '.' ? i + 2 : i
      if (tokens[pos + 1] === '=' && ['quantity', 'reserved', 'remaining_qty'].includes(tokens[pos])) {
        fields.push({ table, field: tokens[pos] })
      }
      atStart = false
    }
    if (token === '(') depth++
    if (token === ')') depth--
    if (token === ',' && !depth) atStart = true
  }
  return fields
}

function stockWrites(source) {
  const writes = []
  if (!/inventory_(?:stock|containers)/i.test(source)) return writes
  const tree = parse(source)
  const synced = new Set()
  visit(tree, node => {
    if (callName(node) === 'syncStockFromContainers') synced.add(owner(node))
    const sql = literals(node)
    if (!sql) return
    for (const point of assignments(sql)) {
      writes.push({ ...point, fn: owner(node), line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1 })
    }
  })
  return writes.map(({ table, field, fn, line }) => ({ table, field, name: functionName(fn), sync: synced.has(fn), line }))
}

function main() {
  const files = filesUnder(SRC, name => name.endsWith('.js'))
  assert.ok(files.length > 200, `后端源码文件数异常（${files.length}），目录结构可能变了`)

  const problems = []
  const usedAllow = new Set()
  let qtyWrites = 0
  let remainingWrites = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    for (const point of stockWrites(fs.readFileSync(file, 'utf8'))) {
      const { table, field, line, name, sync } = point
      if (table === 'inventory_stock') {
        qtyWrites++
        const allowed = field === 'quantity' ? QUANTITY_WRITERS : RESERVED_WRITERS
        if (!allowed.has(rel) || (field === 'quantity' && name !== 'syncStockFromContainers')) {
          problems.push(rel + ':' + line + ' ' + name + ' 直接写库存缓存 ' + field)
        }
      } else if (field === 'remaining_qty') {
        remainingWrites++
        if (sync) continue
        const key = rel + '::' + name
        if (SYNC_ALLOWLIST.has(key)) usedAllow.add(key)
        else problems.push(rel + ':' + line + ' 在 ' + name + ' 写 remaining_qty 后缺少维度同步')
      }
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

module.exports = { stockWrites }
if (require.main === module) main()
