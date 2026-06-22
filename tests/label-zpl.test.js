#!/usr/bin/env node
'use strict'

/**
 * generateZplFromElements 纯函数测试（mm→dot 设备映射，无需 DB）。
 *   node tests/label-zpl.test.js
 *
 * 验证 ZPL 端与统一几何层一致：坐标/字高均由 resolveLayout 的 mm 图元 ×MM_TO_DOT 得来，
 * 并验证「字高 mm 与旧 fontSize(pt) 算法数学等价」「divider/table 剔除」「空→null」。
 */

const path = require('path')
const assert = require('assert')

const { generateZplFromElements, MM_TO_DOT } = require(
  path.resolve(__dirname, '../backend/src/modules/print-jobs/labelZpl'),
)

const results = []
let failures = 0
function check(desc, fn) {
  try { fn(); results.push(`  ✓ ${desc}`) }
  catch (e) { failures += 1; results.push(`  ✗ ${desc}\n      ${e.message}`) }
}

const dot = mm => Math.round(mm * MM_TO_DOT)

// ── 旧结构（type5 货架）：含 barcode/text/divider ────────────────────────────
const layout = {
  elements: [
    { id: 'bc', type: 'barcode', fieldKey: 'rack_barcode', label: '货架条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'rc', type: 'text', fieldKey: 'rack_code', label: '货架编码', x: 2, y: 16, width: 71, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
    { id: 'div', type: 'divider', fieldKey: '', label: '', x: 2, y: 24, width: 71, height: 4, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
  ],
}
const zpl = generateZplFromElements(layout, { rack_barcode: 'H000001', rack_code: 'A-01-02' }, 'thermal75')

check('ZPL 头：^XA^CI28^LH0,0^PW + 纸宽(75mm→dot)', () => {
  assert.ok(zpl.startsWith(`^XA^CI28^LH0,0^PW${dot(75)}`), zpl.slice(0, 40))
})
check('barcode 段坐标/高度/^BC 正确', () => {
  assert.ok(zpl.includes(`^FO${dot(2)},${dot(2)}^BY`), '条码 ^FO')
  assert.ok(zpl.includes(`^BCN,${dot(12)},Y,N,N^FDH000001^FS`), '条码 ^BC + 值')
})
check('text 段坐标/字高(9pt→mm→dot) 正确，默认无 label 前缀', () => {
  assert.ok(zpl.includes(`^FO${dot(2)},${dot(16)}^A0N,`), '文本 ^FO')
  assert.ok(zpl.includes('^FDA-01-02^FS'), '文本值无前缀')
  assert.ok(!zpl.includes('货架编码'), '不应出现 label 前缀')
})
check('divider 被剔除（不产出任何对应段）', () => {
  // divider 无字段值，且几何层不产出；ZPL 段数 = barcode + text = 2 个 ^FO
  assert.strictEqual((zpl.match(/\^FO/g) || []).length, 2)
})
check('以 ^XZ 结尾', () => assert.ok(zpl.endsWith('^XZ')))

// ── 字高 mm 与旧 pt 算法等价 ─────────────────────────────────────────────────
check('字高等价：fontSize=10pt 旧算法 round(10×203/72)=28 dot', () => {
  const z = generateZplFromElements(
    { elements: [{ id: 't', type: 'text', fieldKey: 'k', label: '', x: 0, y: 0, width: 40, height: 6, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false }] },
    { k: 'X' }, 'thermal80',
  )
  const oldDots = Math.round(10 * 203 / 72) // = 28
  assert.ok(z.includes(`^A0N,${oldDots},${oldDots}^`), `期望 ^A0N,${oldDots} 实得 ${z}`)
})

// ── 对齐 / showLabel / 空 ────────────────────────────────────────────────────
check('居中对齐产出 ^FB...,C；showLabel 拼前缀', () => {
  const z = generateZplFromElements(
    { canvasWidthMm: 60, elements: [{ id: 'q', type: 'text', fieldKey: 'qty', label: '数量', showLabel: true, x: 2, y: 2, width: 30, height: 6, fontHeightMm: 3, textAlign: 'center' }] },
    { qty: 12 }, 'thermal80',
  )
  assert.ok(z.includes(',C^FD数量：12^FS'), z)
})
check('空元素布局 → null', () => {
  assert.strictEqual(generateZplFromElements({ elements: [] }, {}, 'thermal80'), null)
})
check('format=zpl 裸模板 → null（不经画布几何）', () => {
  assert.strictEqual(generateZplFromElements({ format: 'zpl', body: '^XA^XZ' }, {}, 'thermal80'), null)
})

console.log('标签 ZPL 生成测试：')
console.log(results.join('\n'))
if (failures > 0) { console.error(`\n${failures} 个断言失败`); process.exit(1) }
console.log(`\n全部通过（${results.length} 项）`)
