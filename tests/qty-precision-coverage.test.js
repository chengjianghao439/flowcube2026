#!/usr/bin/env node
'use strict'

/**
 * 商品数量精度开关的**接入覆盖**契约（迁移 254 的 `product_items.allow_decimal_qty`）。
 *
 * 为什么需要这层守卫：开关本身只有一个布尔字段，真正的工作量在于「谁按小数填数量」
 * 这件事散落在十几个模块里。任何一处新增入口没接上，用户就能从那个入口绕开开关——
 * 这不是假设：本轮接入时就出现过「销售接好了，调拨和盘点仍然收小数」。
 *
 * 守卫只做机械断言，不解析语义：
 *   1. 录入类模块必须走 `foldEntryItems()`（它内部统一调 assertQtyPrecision），
 *      并且**不得**退回手写的 `foldEntryItem()` 逐条循环——那会静默丢掉校验；
 *   2. 其余直接写数量的入口文件必须 require 了 `qtyPrecision`；
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

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 录入类模块：必须经 foldEntryItems 折算（顺带获得数量精度校验） */
const VIA_FOLD_ENTRY = [
  'backend/src/modules/sale/sale.service.js',
  'backend/src/modules/purchase/purchase.service.js',
  'backend/src/modules/returns/returns-sale.service.js',
  'backend/src/modules/returns/returns-purchase.service.js',
]

/** 直接写数量的入口：必须显式引用 qtyPrecision */
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
]

/** 明确可以不收数量精度约束的文件（逐条写理由，失效即失败）。目前没有豁免。 */
const ALLOWLIST = new Map()

test('录入类模块必须经 foldEntryItems，不得退回手写逐条折算', () => {
  for (const rel of VIA_FOLD_ENTRY) {
    const src = read(rel)
    assert.ok(
      src.includes('foldEntryItems('),
      `${rel} 没有调用 foldEntryItems()——录入类模块必须走统一折算入口，否则数量精度校验会被绕过`,
    )
    // 单数 foldEntryItem( 是手写循环的标志；批量版含该子串，故用词边界排除
    const single = src.match(/\bfoldEntryItem\s*\(/g) || []
    assert.equal(
      single.length, 0,
      `${rel} 里仍有手写的 foldEntryItem() 逐条折算（${single.length} 处）——它会跳过数量精度校验，改用 foldEntryItems()`,
    )
  }
})

test('直接写数量的入口必须引用 qtyPrecision', () => {
  for (const rel of DIRECT) {
    const src = read(rel)
    assert.ok(
      /require\(['"][^'"]*qtyPrecision['"]\)/.test(src),
      `${rel} 会写数量却没有引用 utils/qtyPrecision——「只能整数」的商品可以从这里按小数写进去`,
    )
  }
})

test('foldEntryItems 自身必须调用 assertQtyPrecision', () => {
  const src = read('backend/src/utils/unitConversion.js')
  const start = src.indexOf('async function foldEntryItems(')
  assert.ok(start > 0, 'unitConversion.js 里找不到 foldEntryItems')
  const body = src.slice(start, start + 900)
  assert.match(body, /assertQtyPrecision\(/, 'foldEntryItems 不再调用 assertQtyPrecision，录入类模块的校验会集体失效')
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
