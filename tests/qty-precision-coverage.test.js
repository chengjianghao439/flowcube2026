#!/usr/bin/env node
'use strict'

/**
 * 商品数量精度开关的**接入覆盖**契约（迁移 254 的 `product_items.allow_decimal_qty`）。
 *
 * 为什么需要这层守卫：开关本身只有一个布尔字段，真正的工作量在于「谁按小数填数量」
 * 这件事散落在十几个模块里。任何一处新增入口没接上，用户就能从那个入口绕开开关——
 * 这不是假设：本轮接入时就出现过「销售接好了，调拨和盘点仍然收小数」。
 *
 * 守卫按 TypeScript AST 检查实际调用，不把导入、注释或字符串当执行：
 *   1. 录入类模块必须走 `foldEntryItems()`（它内部统一调 assertQtyPrecision），
 *      并且**不得**退回手写的 `foldEntryItem()` 逐条循环——那会静默丢掉校验；
 *   2. 其余直接写数量的业务入口必须有实际 `assertQtyPrecision` / `assertQtyPrecisionWith` 调用；
 *   3. `foldEntryItems` 自身必须真的调用 assertQtyPrecision（防止有人把校验挪走）。
 *
 * 新增一个会写数量的模块时，要么接上校验，要么把它加进 ALLOWLIST 并写清为什么
 * 它可以不受数量精度约束（例如只写打印任务、只写审计日志）。
 *
 * 反向验证：删掉 transfer.service.js 里的 assertQtyPrecision 调用、或把
 * `foldEntryItems(conn, items)` 改回手写循环，本守卫都必须失败。
 *
 * 运行：node --test tests/qty-precision-coverage.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('../frontend/node_modules/typescript')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 录入类模块：必须经 foldEntryItems 折算（顺带获得数量精度校验） */
const VIA_FOLD_ENTRY = [
  'backend/src/modules/sale/sale.service.js',
  'backend/src/modules/purchase/purchase.service.js',
  'backend/src/modules/returns/returns-sale.service.js',
  'backend/src/modules/returns/returns-purchase.service.js',
]

/** 直接写数量的模块：具体入口见 DIRECT_ENTRY_POINTS */
const DIRECT = [
  'backend/src/utils/unitConversion.js',
  'backend/src/modules/sale/sale.service.js',
  'backend/src/modules/transfer/transfer.service.js',
  'backend/src/modules/purchase-requisitions/purchase-requisitions.service.js',
  'backend/src/modules/stockcheck/stockcheck.service.js',
  'backend/src/modules/inventory/inventory.service.js',
  'backend/src/engine/containerEngine.js',
  'backend/src/modules/disposal/disposal.service.js',
  'backend/src/modules/inbound-tasks/inbound-tasks.command.js',
  'backend/src/modules/packages/packages.service.js',
  'backend/src/modules/return-tasks/return-tasks.service.js',
  'backend/src/modules/scan-logs/scan-logs.service.js',
]

/** 明确可以不收数量精度约束的文件（逐条写理由，失效即失败）。目前没有豁免。 */
const ALLOWLIST = new Map()

test('录入类模块必须经 foldEntryItems，不得退回手写逐条折算', () => {
  for (const rel of VIA_FOLD_ENTRY) {
    const src = read(rel)
    assert.ok(
      callsInSource(src, rel).some(call => call.name === 'foldEntryItems'),
      `${rel} 没有调用 foldEntryItems()——录入类模块必须走统一折算入口，否则数量精度校验会被绕过`,
    )
    // 只统计真正的调用，注释和字符串中的旧写法不计。
    const single = callsInSource(src, rel).filter(call => call.name === 'foldEntryItem')
    assert.equal(
      single.length, 0,
      `${rel} 里仍有手写的 foldEntryItem() 逐条折算（${single.length} 处）——它会跳过数量精度校验，改用 foldEntryItems()`,
    )
  }
})

// 按业务入口指定最低覆盖，不钉死调用总数，新增合法校验不会让守卫误报。
const DIRECT_ENTRY_POINTS = new Map([
  ['backend/src/utils/unitConversion.js', ['foldEntryItems', { name: 'foldEntryItem', guard: 'assertQtyScale' }]],
  ['backend/src/modules/sale/sale.service.js', ['reserveStock', 'ship', 'releaseStock']],
  ['backend/src/modules/transfer/transfer.service.js', ['create', 'update']],
  ['backend/src/modules/purchase-requisitions/purchase-requisitions.service.js', ['replaceItems', 'convert']],
  ['backend/src/modules/stockcheck/stockcheck.service.js', ['saveItemContainerScans', 'updateItems']],
  ['backend/src/modules/inventory/inventory.service.js', ['changeStock']],
  ['backend/src/engine/containerEngine.js', ['splitContainer',
    ...['createContainer', 'deductFromContainers', 'deductFromTaskLockedContainers', 'splitTaskLockedContainerForReturn']
      .map(name => ({ name, guard: 'assertQtyScale' })),
  ]],
  ['backend/src/modules/disposal/disposal.service.js', ['create', 'update']],
  ['backend/src/modules/inbound-tasks/inbound-tasks.command.js', ['receive', 'createManualTask']],
  ['backend/src/modules/packages/packages.service.js', ['addItem', 'removeItem']],
  ['backend/src/modules/return-tasks/return-tasks.service.js', ['receive', 'check']],
  ['backend/src/modules/scan-logs/scan-logs.service.js', ['createScanLog']],
])

function callsInSource(src, rel) {
  const tree = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
  const calls = []
  function visit(node, owner = null) {
    if (ts.isFunctionLike(node) && node.name) owner = node.name.getText(tree)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.push({ owner, name: node.expression.text, start: node.expression.getStart(tree), end: node.expression.end, callStart: node.getStart(tree), callEnd: node.end })
    }
    ts.forEachChild(node, child => visit(child, owner))
  }
  visit(tree)
  return calls
}

function assertDirectCoverage(rel, src) {
  const calls = callsInSource(src, rel)
  const owners = DIRECT_ENTRY_POINTS.get(rel)
  assert.ok(owners?.length, `${rel} 未登记数量精度校验入口，不能空转`)
  for (const entry of owners) {
    const owner = typeof entry === 'string' ? entry : entry.name
    const matchesGuard = name => typeof entry === 'string' ? /^assertQtyPrecision(?:With)?$/.test(name) : name === entry.guard
    assert.ok(calls.some(call => call.owner === owner && matchesGuard(call.name)),
      `${rel} 的 ${owner} 缺少实际数量精度校验调用`)
  }
}

test('直接写数量的入口必须调用 qtyPrecision', () => {
  for (const rel of DIRECT) assertDirectCoverage(rel, read(rel))
})

test('反向验证：删除或改名调拨任一入口的校验，保留导入和其他入口也必须失败', () => {
  const rel = 'backend/src/modules/transfer/transfer.service.js'
  const source = read(rel)
  for (const owner of DIRECT_ENTRY_POINTS.get(rel)) {
    const calls = callsInSource(source, rel)
      .filter(call => call.owner === owner && /^assertQtyPrecision(?:With)?$/.test(call.name))
      .sort((a, b) => b.start - a.start)
    assert.ok(calls.length > 0, `${owner} 没有真实校验调用，反向验证不能空转`)
    for (const mode of ['rename', 'remove', 'comment']) {
      let mutated = source
      // 移除该入口的全部校验，允许未来同一入口增加多次合法校验而无需修改计数。
      for (const call of calls) {
        const start = mode === 'remove' ? call.callStart : call.start
        const end = mode === 'remove' ? call.callEnd : call.end
        const replacement = mode === 'remove' ? 'undefined'
          : mode === 'comment' ? '/* assertQtyPrecision(conn, items) */ removedValidation' : 'removedValidation'
        mutated = mutated.slice(0, start) + replacement + mutated.slice(end)
      }
      assert.throws(() => assertDirectCoverage(rel, mutated), /数量精度校验/, `${owner} 的校验被移除后守卫仍放行`)
    }
  }
})

test('foldEntryItems 自身必须调用 assertQtyPrecision', () => {
  const rel = 'backend/src/utils/unitConversion.js'
  assertDirectCoverage(rel, read(rel))
})

test('豁免清单不会僵化：每条豁免都指向真实存在的路径', () => {
  for (const [p] of ALLOWLIST) {
    const full = path.join(ROOT, p)
    assert.ok(fs.existsSync(full), `ALLOWLIST 里的 ${p} 已不存在，必须删掉这条豁免`)
  }
})

test('迁移文件存在且默认值为 1（存量商品行为零变化）', () => {
  const rel = 'backend/src/database/254_product_allow_decimal_qty.sql'
  const sql = read(rel)
  assert.match(sql, /allow_decimal_qty/, `${rel} 必须定义 allow_decimal_qty`)
  assert.match(sql, /TINYINT NOT NULL DEFAULT 1/, '默认值必须是 1（允许小数），否则存量商品会突然不能按小数下单')
  assert.match(sql, /information_schema\.COLUMNS/, '迁移必须幂等：先查 information_schema 再决定是否 ALTER')
})
