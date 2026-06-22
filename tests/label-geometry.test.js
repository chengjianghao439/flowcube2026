#!/usr/bin/env node
'use strict'

/**
 * 标签统一几何层单元测试（纯函数，无需 DB）。
 *   node tests/label-geometry.test.js            正常跑：手写语义断言 + 快照回归
 *   UPDATE=1 node tests/label-geometry.test.js   重新生成快照 fixture
 *
 * 快照 tests/fixtures/label-geometry-cases.json 是「单一事实源」：
 * 前端镜像 frontend/src/lib/labelGeometry.ts 在 P2 接入时须对同一组 input 产出同一 expected，
 * 以此锁定预览 / 真机 ZPL 两端几何一致。
 */

const path = require('path')
const fs = require('fs')
const assert = require('assert')

const { resolveLayout, normalizeLabelLayout, PT_TO_MM } = require(
  path.resolve(__dirname, '../backend/src/modules/print-jobs/labelGeometry'),
)

const FIXTURE = path.resolve(__dirname, 'fixtures/label-geometry-cases.json')

// ── 输入样例（仅 input；expected 由实现生成并存入 fixture）─────────────────────
const CASES = [
  {
    name: '旧结构迁移：fontSize(pt)→mm、剔除 divider、默认不显前缀',
    paperSize: 'thermal75',
    data: { rack_barcode: 'H000001', rack_code: 'A-01-02' },
    layout: {
      elements: [
        { id: 'bc', type: 'barcode', fieldKey: 'rack_barcode', label: '货架条码', x: 2, y: 2, width: 71, height: 12, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
        { id: 'rc', type: 'text', fieldKey: 'rack_code', label: '货架编码', x: 2, y: 16, width: 71, height: 6, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: false },
        { id: 'div', type: 'divider', fieldKey: '', label: '', x: 2, y: 24, width: 71, height: 4, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false },
      ],
    },
  },
  {
    name: 'v2：showLabel 拼接、title 取值兜底 label、空值跳过、条码清洗、canvas 显式',
    paperSize: 'thermal80',
    data: { qty: 12, code: 'ABC^123\n', doc_title: '' },
    layout: {
      canvasWidthMm: 60,
      canvasHeightMm: 40,
      elements: [
        { id: 't', type: 'title', fieldKey: 'doc_title', label: '出库单', showLabel: false, x: 0, y: 0, width: 60, height: 8, fontHeightMm: 5, textAlign: 'center' },
        { id: 'q', type: 'text', fieldKey: 'qty', label: '数量', showLabel: true, x: 2, y: 10, width: 30, height: 6, fontHeightMm: 3, textAlign: 'left' },
        { id: 'empty', type: 'text', fieldKey: 'missing', label: '缺', showLabel: false, x: 2, y: 18, width: 30, height: 6, fontHeightMm: 3, textAlign: 'left' },
        { id: 'bc', type: 'barcode', fieldKey: 'code', label: '', showLabel: false, x: 2, y: 24, width: 56, height: 10, fontHeightMm: 3, textAlign: 'left' },
      ],
    },
  },
  {
    name: '排序按 y 再 x（乱序输入）',
    paperSize: 'thermal80',
    data: { a: 'A', b: 'B', c: 'C' },
    layout: {
      elements: [
        { id: 'c', type: 'text', fieldKey: 'c', label: '', showLabel: false, x: 5, y: 20, width: 20, height: 6, fontHeightMm: 3, textAlign: 'left' },
        { id: 'a', type: 'text', fieldKey: 'a', label: '', showLabel: false, x: 9, y: 5, width: 20, height: 6, fontHeightMm: 3, textAlign: 'left' },
        { id: 'b', type: 'text', fieldKey: 'b', label: '', showLabel: false, x: 1, y: 5, width: 20, height: 6, fontHeightMm: 3, textAlign: 'left' },
      ],
    },
  },
  {
    name: 'format=zpl 裸模板：不归几何层，primitives 为空',
    paperSize: 'thermal80',
    data: {},
    layout: { format: 'zpl', body: '^XA^FO0,0^FDx^FS^XZ' },
  },
]

const results = []
let failures = 0
function check(desc, fn) {
  try {
    fn()
    results.push(`  ✓ ${desc}`)
  } catch (e) {
    failures += 1
    results.push(`  ✗ ${desc}\n      ${e.message}`)
  }
}

// ── 手写语义断言（锁正确性，不依赖快照）────────────────────────────────────────
const r0 = resolveLayout(CASES[0].layout, CASES[0].data, CASES[0].paperSize)
check('剔除 divider，仅保留 barcode + text', () => {
  assert.strictEqual(r0.primitives.length, 2)
  assert.strictEqual(r0.primitives[0].kind, 'barcode')
  assert.strictEqual(r0.primitives[1].kind, 'text')
})
check('无 canvasWidthMm 时按 thermal75 推断宽 75mm、高默认 50mm', () => {
  assert.strictEqual(r0.widthMm, 75)
  assert.strictEqual(r0.heightMm, 50)
})
check('barcode 图元键集精确（无 fontHeightMm/align/text）', () => {
  assert.deepStrictEqual(Object.keys(r0.primitives[0]).sort(), ['heightMm', 'kind', 'value', 'widthMm', 'xMm', 'yMm'])
})
check('text 图元键集精确（含 fontHeightMm/align/text）', () => {
  assert.deepStrictEqual(Object.keys(r0.primitives[1]).sort(), ['align', 'fontHeightMm', 'heightMm', 'kind', 'text', 'widthMm', 'xMm', 'yMm'])
})
check('旧 fontSize(pt) 迁移为 mm（9pt → 9×PT_TO_MM，保留两位）', () => {
  const expectMm = Math.round(9 * PT_TO_MM * 100) / 100
  assert.strictEqual(r0.primitives[1].fontHeightMm, expectMm)
})
check('默认不显 label 前缀（旧结构无 showLabel → 只输出值）', () => {
  assert.strictEqual(r0.primitives[1].text, 'A-01-02')
})

const r1 = resolveLayout(CASES[1].layout, CASES[1].data, CASES[1].paperSize)
check('showLabel=true 拼 "label：value"', () => {
  const q = r1.primitives.find(p => p.text && p.text.startsWith('数量'))
  assert.strictEqual(q.text, '数量：12')
})
check('title 字段值为空 → 兜底用 label', () => {
  const t = r1.primitives.find(p => p.text === '出库单')
  assert.ok(t, 'title 应输出 label 作为标题')
})
check('空值 text 元素被跳过', () => {
  assert.ok(!r1.primitives.some(p => p.text === '缺' || (p.text && p.text.includes('缺'))))
})
check('barcode 清洗 ^ ~ 换行', () => {
  const bc = r1.primitives.find(p => p.kind === 'barcode')
  assert.strictEqual(bc.value, 'ABC123')
})
check('canvasWidthMm/HeightMm 显式值生效', () => {
  assert.strictEqual(r1.widthMm, 60)
  assert.strictEqual(r1.heightMm, 40)
})

const r2 = resolveLayout(CASES[2].layout, CASES[2].data, CASES[2].paperSize)
check('排序按 y 升序、同 y 按 x 升序', () => {
  assert.deepStrictEqual(r2.primitives.map(p => p.text), ['B', 'A', 'C'])
})

const r3 = resolveLayout(CASES[3].layout, CASES[3].data, CASES[3].paperSize)
check('format=zpl → primitives 空、normalize 返回 null', () => {
  assert.strictEqual(normalizeLabelLayout(CASES[3].layout, 'thermal80'), null)
  assert.deepStrictEqual(r3.primitives, [])
})

// ── 快照回归（锁跨端一致；UPDATE=1 重新生成）──────────────────────────────────
const snapshot = CASES.map(c => ({
  name: c.name,
  input: { layout: c.layout, data: c.data, paperSize: c.paperSize },
  expected: resolveLayout(c.layout, c.data, c.paperSize),
}))

if (process.env.UPDATE) {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
  fs.writeFileSync(FIXTURE, JSON.stringify(snapshot, null, 2) + '\n')
  results.push('  ✓ 快照已更新（UPDATE=1）')
} else {
  check('快照与 fixture 一致', () => {
    assert.ok(fs.existsSync(FIXTURE), 'fixture 缺失，先跑 UPDATE=1 生成')
    const saved = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    assert.deepStrictEqual(snapshot, saved)
  })
}

console.log('标签几何层测试：')
console.log(results.join('\n'))
if (failures > 0) {
  console.error(`\n${failures} 个断言失败`)
  process.exit(1)
}
console.log(`\n全部通过（${results.length} 项）`)
