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

const { generateZplFromElements, MM_TO_DOT, sanitizeZplValue, applyZplTemplate } = require(
  path.resolve(__dirname, '../backend/src/modules/print-jobs/labelZpl'),
)
const builtInLabels = require('../backend/src/modules/print-jobs/print-jobs.template')

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

// ── 条码参数：码制 + HRI ─────────────────────────────────────────────────────
check('Code128 默认 HRI=Y → ^BCN,h,Y,N,N', () => {
  const z = generateZplFromElements(
    { elements: [{ id: 'bc', type: 'barcode', fieldKey: 'c', label: '', x: 0, y: 0, width: 40, height: 10, fontSize: 10, fontWeight: 'normal', textAlign: 'left', border: false }] },
    { c: 'ABC' }, 'thermal80',
  )
  assert.ok(/\^BCN,\d+,Y,N,N\^FDABC\^FS/.test(z), z)
})
check('EAN13 + HRI=false → ^BEN,h,N,N', () => {
  const z = generateZplFromElements(
    { elements: [{ id: 'bc', type: 'barcode', fieldKey: 'ean', label: '', barcodeSymbology: 'ean13', barcodeHRI: false, x: 2, y: 2, width: 50, height: 14, fontHeightMm: 3, textAlign: 'left' }] },
    { ean: '6901234567892' }, 'thermal80',
  )
  assert.ok(/\^BEN,\d+,N,N\^FD6901234567892\^FS/.test(z), z)
})

check('纸高进入 ^LL：默认 50mm、自定义 75mm，坐标和纸宽不变', () => {
  const vars = { rack_barcode: 'H000001', rack_code: 'A-01-02' }
  const custom = generateZplFromElements({ ...layout, canvasHeightMm: 75 }, vars, 'thermal75')
  assert.ok(zpl.includes(`^PW${dot(75)}^LL${dot(50)}`), zpl)
  assert.ok(custom.includes(`^PW${dot(75)}^LL${dot(75)}`), custom)
  assert.strictEqual(custom.replace(/\^LL\d+/, ''), zpl.replace(/\^LL\d+/, ''))
})

function assertNoControls(value) {
  assert.ok(![...value].some(char => {
    const code = char.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  }), '输出不应含 C0/C1 控制字符')
}

check('字段清洗移除 ^、~ 以及全部 C0/C1 控制字符，保留中文和字面量符号', () => {
  const controls = Array.from({ length: 65 }, (_, index) => String.fromCharCode(index < 32 ? index : index + 95)).join('')
  const result = sanitizeZplValue(`中文 $& $' $$ {{other}} ^~${controls}尾`)
  assertNoControls(result)
  assert.ok(!/[\^~]/.test(result), result)
  assert.ok(result.startsWith("中文 $& $' $$ {{other}} "), result)
})

check('自定义模板一次替换：美元替换符与插入值中的占位符保持字面量', () => {
  const body = '^XA~SD10^FD{{first}}|{{second}}|{{missing}}^FS^XZ'
  const first = "$& $' $$ $` {{second}}"
  assert.strictEqual(
    applyZplTemplate(body, { first, second: '已替换' }),
    `^XA~SD10^FD${first}|已替换|{{missing}}^FS^XZ`,
  )
})

check('自定义模板支持重复占位符、空白和含正则符号字段，正文指令保留', () => {
  assert.strictEqual(
    applyZplTemplate('^XA~SD10^FD{{ a.b }}|{{a.b}}|{{zero}}|{{nil}}^FS^XZ', { 'a.b': '^XZ~JA', zero: 0, nil: null }),
    '^XA~SD10^FDXZ JA|XZ JA|0|^FS^XZ',
  )
})

check('画布文本与条码字段均清理控制字符，不能增加 ZPL 指令', () => {
  const generated = generateZplFromElements(layout, { rack_barcode: 'H\u0000\u001b\u007f\u0085', rack_code: 'A^XZ~JA\u0000\u001b' }, 'thermal75')
  assertNoControls(generated)
  assert.ok(!generated.includes('~'), generated)
  assert.strictEqual((generated.match(/\^XZ/g) || []).length, 1)
})

const builtInCases = [
  ['buildContainerLabelZpl', { container_code: 'C001', product_name: '商品', qty: 12 }],
  ['buildPlasticBoxLabelZpl', { container_code: 'B001', product_name: '商品' }],
  ['buildRackLabelZpl', { rack_barcode: 'H001', rack_code: 'A01', zone: '一区', name: '货架' }],
  ['buildLocationLabelZpl', { location_barcode: 'R001', location_code: 'A01', zone: '一区', name: '库位' }],
  ['buildPackageLabelZpl', { box_code: 'P001', task_no: 'WT001', customer_name: '客户', carrier_name: '快递', freight_type_name: '寄付', piece_count: 1, item_list: '商品', summary: '摘要' }],
  ['buildProductLabelZpl', { product_code: 'SP001', product_name: '商品', spec: '规格', unit: '件', price: 12 }],
]

check('画布 Code128 保留普通首尾空格与原有模块宽度', () => {
  const generated = generateZplFromElements(
    { elements: [{ type: 'barcode', fieldKey: 'code', x: 0, y: 0, width: 40, height: 10 }] },
    { code: ' ABC ' }, 'thermal80',
  )
  assert.ok(generated.includes(`^BY3^BCN,${dot(10)},Y,N,N^FD ABC ^FS`), generated)
})

for (const [builderName, values] of builtInCases) {
  check(`内置标签 ${builderName} 的条码保留普通首尾空格`, () => {
    const barcodeKey = Object.keys(values)[0]
    const generated = builtInLabels[builderName]({ ...values, [barcodeKey]: ' ABC ' })
    assert.ok(generated.includes('^FD ABC ^FS'), generated)
  })
  for (const key of Object.keys(values)) {
    check(`内置标签 ${builderName}.${key} 不能注入指令或控制字符`, () => {
      const builder = builtInLabels[builderName]
      const baseline = builder(values)
      const generated = builder({ ...values, [key]: '^XZ~JA\u0000\u001b\u007f\u0085' })
      assertNoControls(generated)
      assert.ok(!generated.includes('~'), generated)
      assert.deepStrictEqual(generated.match(/\^[A-Z][A-Z0-9]/g), baseline.match(/\^[A-Z][A-Z0-9]/g))
    })
  }
}

console.log('标签 ZPL 生成测试：')
console.log(results.join('\n'))
if (failures > 0) { console.error(`\n${failures} 个断言失败`); process.exit(1) }
console.log(`\n全部通过（${results.length} 项）`)
