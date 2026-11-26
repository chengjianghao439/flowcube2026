#!/usr/bin/env node
'use strict'

/**
 * 只读路径 N+1 契约测试（纯静态，无需 DB）。
 *
 * 背景（2026-09-19）：`assertTaskPickScanClosure` / `assertTaskCheckScanClosure`
 * （出库前置校验，每次推进都跑）在 `for (const row of items)` 里对 `scan_logs`
 * 各做一次 `WHERE item_id=?` 聚合；`resolveReceiptParty` 则对每张对账单、每条账款
 * 各查一次。改前是 N 次往返，改后各一次 `GROUP BY` / `IN (?)`。
 *
 * 为什么不能靠"看起来不快"来判断：这类循环单次都很快，只有在明细多时才显形，
 * 而且**语义完全正确**——测试、lint、类型检查都不会红。所以必须机械守住。
 *
 * 判定口径（刻意保守，宁可漏报也不要误报阻塞改动）：
 *   一个循环体内出现 `await <x>.query/execute(`，**且**该循环所在函数的上下文窗口里
 *   既没有任何写语句（INSERT/UPDATE/DELETE/REPLACE）也没有 `FOR UPDATE` 行锁，
 *   才算"只读路径上的逐行查询"。
 *
 * 为什么这样划界：事务内按固定顺序逐行 `FOR UPDATE` 加锁是**刻意的设计**（防死锁），
 * 批量改写会破坏锁顺序；逐行导入/取号重试/分页 offset/按维度分组也都是正当形态。
 * 这些都在下面的白名单里逐条写明理由——白名单必须被命中，否则测试失败，防止清单僵化。
 *
 * 运行：node tests/query-loop-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'backend/src')

/** 白名单：`文件相对路径::循环头（trim 后）` → 理由。必须被命中。 */
const ALLOWLIST = new Map([
  ['backend/src/engine/containerEngine.js::for (let offset = 0; offset < dimensions.length; offset += 500) {',
    '每次读一批 500 个独立维度'],
  ['backend/src/modules/search/search.service.js::const pages = await Promise.all(entities.map(async (ent) => {',
    '按固定 ENTITIES 登记表及可见分类查询，每类仅一条查询，与命中行数无关'],
  ['backend/src/modules/stockcheck/stockcheck.cycle.js::for (const wh of warehouses) {',
    '每仓独立重算 ABC、创建盘点任务并记录失败，允许其余仓库继续调度'],
  ['backend/src/modules/customers/customers.service.js::for (const sql of checks) {',
    '固定的多条引用校验 SQL（每条查一张表），不是按行遍历'],
  ['backend/src/modules/products/products.service.js::for (const [, sql] of checks) {',
    '同上：固定校验清单'],
  ['backend/src/modules/products/products.quantity-policy.js::for (const [label, sql] of CHECKS) {',
    '商品更新事务内，单一商品的固定 21 项依赖存在性校验；各 SQL 按商品 ID 限定并 LIMIT 1，不按业务行数查询'],
  ['backend/src/modules/suppliers/suppliers.service.js::for (const sql of checks) {',
    '同上：固定校验清单'],
  ['backend/src/modules/warehouses/warehouses.service.js::for (const sql of checks) {',
    '同上：固定校验清单'],
  ['backend/src/modules/inventory/inventory.procurement.js::for (let offset = 0; ; offset += 500) {',
    '按 offset 分批扫描全表，批次之间不重叠，不是逐行单查'],
  ['backend/src/modules/pda-devices/pda-devices.service.js::for (let attempt = 0; attempt < 20; attempt += 1) {',
    '设备码/密钥撞号重试，命中即退出，不是按行遍历'],
  ['backend/src/modules/printers/printers.service.js::while (true) {',
    '同上：取号撞号重试'],
  ['backend/src/modules/inventory/inventory.service.js::for (const [sourceType, ids] of byType) {',
    '按维度分组后每组一次查询——这正是 N+1 的修法本身'],
  ['backend/src/modules/document-activity/document-activity.service.js::for (let start = 0; start < ids.length; start += 100) {',
    '每次最多 100 个任务 ID 的有界批次，单次批量查询而非逐任务查询'],
])

/** 判定一个函数上下文窗口是否包含写操作或行锁。 */
const WRITE_RE = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b|\bFOR\s+UPDATE\b/i
const { ts, parse, visit, literals, callName } = require('./helpers/contractSource')

function collectFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectFiles(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 返回 [{ line, loopText }]，即"只读路径上的逐行查询"位置。 */
function findReadOnlyLoopQueries(source) {
  if (!/\.(?:query|execute)\s*\(/.test(source)) return []
  const tree = parse(source)
  const lines = source.split('\n')
  const hits = new Map()
  const writes = new Set()
  const callbacks = new Set(['map', 'forEach', 'flatMap'])
  visit(tree, node => {
    if (!['query', 'execute'].includes(callName(node))) return
    const sql = node.arguments[0] && literals(node.arguments[0])
    let loop
    let scope = tree
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isIterationStatement(parent, true)) loop ??= parent
      if (ts.isFunctionLike(parent)) {
        if (callbacks.has(callName(parent.parent))) loop ??= parent.parent
        scope = parent
        break
      }
    }
    if (sql && WRITE_RE.test(sql)) writes.add(scope)
    if (loop) {
      const { line } = tree.getLineAndCharacterOfPosition(loop.getStart())
      hits.set(loop, { line: line + 1, loopText: lines[line].trim(), scope })
    }
  })
  return [...hits.values()].filter(hit => !writes.has(hit.scope))
    .map(({ line, loopText }) => ({ line, loopText }))
}

function main() {
  const files = collectFiles(SRC)
  assert.ok(files.length > 200, `后端源码文件数异常（${files.length}），目录结构可能变了`)

  const used = new Set()
  const problems = []
  let scanned = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const hits = findReadOnlyLoopQueries(fs.readFileSync(file, 'utf8'))
    scanned += hits.length
    for (const hit of hits) {
      const key = `${rel}::${hit.loopText}`
      if (ALLOWLIST.has(key)) { used.add(key); continue }
      problems.push(`${rel}:${hit.line} 只读路径上逐行查询（${hit.loopText}）`
        + '：请改为一次 GROUP BY / IN (?) 批量读取，或在测试白名单里写明正当理由')
    }
  }

  const stale = [...ALLOWLIST.keys()].filter((k) => !used.has(k))
  assert.deepEqual(stale, [],
    `这些白名单条目已不再命中（代码已批量改写或删除），必须从清单里删掉：${stale.join(' | ')}`)

  console.log(`扫描后端源码 ${files.length} 个文件，只读路径逐行查询 ${scanned} 处（全部在白名单内）`)

  if (problems.length) {
    console.error('\n只读路径 N+1 违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log('✓ 未发现新增的只读路径逐行查询')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  只读路径 N+1 契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

module.exports = { findReadOnlyLoopQueries, ALLOWLIST }
if (require.main === module) main()
