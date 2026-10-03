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
 *   3. 单条包装入口必须返回 helper 的折算结果；helper 必须在转换/取整前分别校验
 *      原量和未取整换算量，两个批量入口必须各自校验折算后数量。
 *
 * 新增一个会写数量的模块时，要么接上校验，要么把它加进 ALLOWLIST 并写清为什么
 * 它可以不受数量精度约束（例如只写打印任务、只写审计日志）。
 *
 * 反向验证：删掉 transfer.service.js 里的 assertQtyPrecision 调用、或把
 * `foldEntryItems(conn, items)` 改回手写循环，本守卫都必须失败；单条委派、helper
 * 的任一尺度校验、任一批量入口的商品精度校验被移除，也必须分别失败。
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
  ['backend/src/utils/unitConversion.js', ['foldEntryItems', 'foldEntryItemsBatch']],
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
      calls.push({ owner, name: node.expression.text, firstArg: node.arguments[0]?.getText(tree).replace(/\s/g, ''), start: node.expression.getStart(tree), end: node.expression.end, callStart: node.getStart(tree), callEnd: node.end })
    }
    ts.forEachChild(node, child => visit(child, owner))
  }
  visit(tree)
  return calls
}

function assertDirectCoverage(rel, src) {
  if (rel === 'backend/src/utils/unitConversion.js') return assertUnitConversionCoverage(src, rel)
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

function assertUnitConversionCoverage(src, rel) {
  const tree = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true)
  const text = node => node?.getText(tree).replace(/\s/g, '')
  const callIs = (node, name, args) => node && ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === name
    && args.every((arg, index) => text(node.arguments[index]) === arg)
  const functionBody = name => {
    const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(fn?.body, `${rel} 的 ${name} 缺少数量精度校验入口`)
    return fn.body.statements
  }
  const returnedCall = (statements, name, args) => statements.some(node =>
    ts.isReturnStatement(node) && callIs(node.expression, name, args))
  const variable = (statements, name) => statements.flatMap(node =>
    ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find(node => text(node.name) === name)

  // 只认包装函数直接返回的真实调用，别处存在同名 helper 不代表该入口受保护。
  const single = functionBody('foldEntryItem')
  assert.ok(returnedCall(single, 'foldEntryItemWithRate', ['item', 'rate']),
    `${rel} 的 foldEntryItem 缺少数量精度校验委派返回`)

  const helper = functionBody('foldEntryItemWithRate')
  const guardPosition = arg => helper.findIndex(node => ts.isExpressionStatement(node)
    && callIs(node.expression, 'assertQtyScale', [arg]))
  const raw = guardPosition('item.quantity')
  const converted = guardPosition('entryQty*rate')
  const entryQty = variable(helper, 'entryQty')
  const quantity = variable(helper, 'quantity')
  assert.ok(raw >= 0 && entryQty && helper[raw].end < entryQty.getStart(tree),
    `${rel} 的 helper 缺少原量转换前的数量精度校验`)
  assert.ok(converted >= 0 && quantity && helper[converted].end < quantity.getStart(tree)
    && callIs(quantity.initializer, 'roundQty', ['entryQty*rate']),
  `${rel} 的 helper 缺少换算结果取整前的数量精度校验`)

  for (const name of DIRECT_ENTRY_POINTS.get(rel)) {
    const statements = functionBody(name)
    const out = variable(statements, 'out')
    assert.ok(out, `${rel} 的 ${name} 缺少数量精度校验结果集合`)
    if (name === 'foldEntryItemsBatch') {
      const map = out.initializer
      const callback = map && ts.isCallExpression(map) && text(map.expression) === 'items.map'
        ? map.arguments[0] : null
      assert.ok(callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)
        && returnedCall(callback.body.statements, 'foldEntryItemWithRate', ['item', 'rate']),
      `${rel} 的 ${name} 缺少数量精度校验 helper 委派`)
    } else {
      assert.ok(statements.some(node => ts.isForOfStatement(node) && text(node.expression) === 'items'
        && ts.isExpressionStatement(node.statement) && ts.isCallExpression(node.statement.expression)
        && text(node.statement.expression.expression) === 'out.push'
        && node.statement.expression.arguments[0] && ts.isAwaitExpression(node.statement.expression.arguments[0])
        && callIs(node.statement.expression.arguments[0].expression, 'foldEntryItem', ['conn', 'item'])),
      `${rel} 的 ${name} 缺少数量精度校验单条委派`)
    }
    // 保护必须在本入口的执行体中 await，且检查 out 的基本单位数量后才返回 out。
    const precision = statements.find(node => ts.isExpressionStatement(node)
      && ts.isAwaitExpression(node.expression)
      && callIs(node.expression.expression, 'assertQtyPrecision', ['conn']))
    const map = precision?.expression.expression.arguments[1]
    const callback = map && ts.isCallExpression(map) && text(map.expression) === 'out.map'
      ? map.arguments[0] : null
    const row = callback && ts.isArrowFunction(callback) && ts.isParenthesizedExpression(callback.body)
      ? callback.body.expression : null
    const parameter = callback?.parameters?.[0]?.name
    const checksQty = row && ts.isObjectLiteralExpression(row) && ['productId', 'qty'].every(key =>
      row.properties.some(prop => ts.isPropertyAssignment(prop) && text(prop.name) === key
        && text(prop.initializer) === `${text(parameter)}.${key === 'qty' ? 'quantity' : 'productId'}`))
    const returned = statements.find(node => ts.isReturnStatement(node) && text(node.expression) === 'out')
    assert.ok(checksQty && returned && out.end < precision.getStart(tree) && precision.end < returned.getStart(tree),
      `${rel} 的 ${name} 缺少返回前的实际数量精度校验调用`)
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

test('折算委派链和两个批量入口必须各自覆盖数量精度', () => {
  const rel = 'backend/src/utils/unitConversion.js'
  assertDirectCoverage(rel, read(rel))
})

test('反向验证：委派、两处尺度校验和各批量精度校验缺一不可', () => {
  const rel = 'backend/src/utils/unitConversion.js'
  const source = read(rel)
  const targets = [
    ['foldEntryItem', 'foldEntryItemWithRate', 'item'],
    ['foldEntryItemWithRate', 'assertQtyScale', 'item.quantity'],
    ['foldEntryItemWithRate', 'assertQtyScale', 'entryQty*rate'],
    ['foldEntryItems', 'assertQtyPrecision', 'conn'],
    ['foldEntryItemsBatch', 'assertQtyPrecision', 'conn'],
    ['foldEntryItems', 'foldEntryItem', 'conn'],
    ['foldEntryItemsBatch', 'foldEntryItemWithRate', 'item'],
  ]
  for (const [owner, name, firstArg] of targets) {
    const call = callsInSource(source, rel).find(call => call.owner === owner && call.name === name && call.firstArg === firstArg)
    assert.ok(call, `${owner}/${name}/${firstArg} 反向验证不能空转`)
    for (const mode of ['rename', 'remove', 'comment']) {
      const start = mode === 'remove' ? call.callStart : call.start
      const end = mode === 'remove' ? call.callEnd : call.end
      const replacement = mode === 'remove' ? 'undefined'
        : mode === 'comment' ? `/* ${name} */ removedValidation` : 'removedValidation'
      const mutated = source.slice(0, start) + replacement + source.slice(end)
      assert.equal(ts.createSourceFile(rel, mutated, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0)
      assert.throws(() => assertDirectCoverage(rel, mutated), /数量精度校验/,
        `${owner}/${name}/${firstArg} 被 ${mode} 后守卫仍放行`)
    }
  }
})

test('真实折算入口拒绝原量、未取整换算量和整数商品的小数结果', async () => {
  const { foldEntryItem, foldEntryItems, foldEntryItemsBatch } = require('../backend/src/utils/unitConversion')
  const conn = { query: async sql => {
    if (sql.includes('FROM product_units')) return [[{ product_id: 1, unit_name: '箱', conversion_rate: 0.5 }]]
    assert.match(sql, /FROM product_items/)
    return [[{ id: 1, name: '整数商品', allow_decimal_qty: 0 }]]
  } }
  const item = { productId: 1, unit: '件', quantity: 1, unitPrice: 1.2345 }
  for (const fold of [foldEntryItem, foldEntryItems, foldEntryItemsBatch]) {
    const input = row => fold === foldEntryItem ? row : [row]
    await assert.rejects(() => fold(conn, input({ ...item, quantity: 1.005 })), { code: 'QTY_DECIMALS_EXCEEDED' })
    await assert.rejects(() => fold(conn, input({ ...item, quantity: 0.01, entryUnit: '箱' })), { code: 'QTY_DECIMALS_EXCEEDED' })
    const result = await fold(conn, input(item))
    assert.equal((fold === foldEntryItem ? result : result[0]).unitPrice, 1.2345)
    if (fold !== foldEntryItem) {
      await assert.rejects(() => fold(conn, input({ ...item, entryUnit: '箱' })), { code: 'QTY_INTEGER_REQUIRED' })
    }
  }
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
