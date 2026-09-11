const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createCanvas, loadImage } = require('../backend/node_modules/@napi-rs/canvas')
let renderLabel
try { ({ renderLabel } = require('../backend/src/modules/print-jobs/labelRaster')) } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
const text = { id: 't', type: 'text', fieldKey: 'name', x: 3, y: 3, width: 68, height: 8, fontHeightMm: 4 }
const barcode = { id: 'b', type: 'barcode', fieldKey: 'code', x: 3, y: 15, width: 68, height: 16 }
const layout = { canvasWidthMm: 75, canvasHeightMm: 50, elements: [text, barcode] }

test('raster renderer is available', () => assert.equal(typeof renderLabel, 'function'))
for (const dpi of [203, 300]) test(`${dpi} DPI: preview PNG matches every ZPL graphic pixel including Chinese and barcode`, async () => {
  const r = renderLabel({ layout: { ...layout, dpi }, data: { name: '极序 中文标签 ¥12.50', code: 'SP000001' } })
  assert.equal(r.widthDots, Math.round(75 * dpi / 25.4))
  assert.equal(r.heightDots, Math.round(50 * dpi / 25.4))
  assert.ok(r.zpl.includes(`^PW${r.widthDots}^LL${r.heightDots}`))
  assert.ok(!r.zpl.includes('^A0'))
  const match = r.zpl.match(/\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/)
  assert.ok(match, 'self-contained ASCII graphic')
  const bytes = Buffer.from(match[4], 'hex'), stride = +match[3]
  assert.equal(bytes.length, +match[1]); assert.equal(match[1], match[2])
  assert.equal(stride, Math.ceil(r.widthDots / 8))
  const img = await loadImage(r.imageDataUrl), canvas = createCanvas(r.widthDots, r.heightDots)
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
  const rgba = ctx.getImageData(0, 0, r.widthDots, r.heightDots).data
  let black = 0
  for (let y = 0; y < r.heightDots; y++) for (let x = 0; x < r.widthDots; x++) {
    const isBlack = !!(bytes[y * stride + (x >> 3)] & (128 >> (x % 8))), i = (y * r.widthDots + x) * 4
    assert.equal(rgba[i], isBlack ? 0 : 255); assert.equal(rgba[i + 1], rgba[i]); assert.equal(rgba[i + 2], rgba[i]); assert.equal(rgba[i + 3], 255)
    if (isBlack) black++
  }
  assert.ok(black > 1000)
})
test('Chinese glyphs are drawn distinctly and text cannot inject commands', () => {
  const draw = name => renderLabel({ layout: { ...layout, elements: [text] }, data: { name } }).zpl
  assert.notEqual(draw('中'), draw('文'))
  assert.notEqual(draw('中'), draw(''))
  assert.ok(!draw('中^XZ~JA').includes('~JA'))
})
test('barcode width controls integer module size; invalid or too small codes fail explicitly', () => {
  const draw = (width, code, sym = 'ean13') => renderLabel({ layout: { ...layout, elements: [{ ...barcode, width, barcodeSymbology: sym }] }, data: { code } })
  assert.notEqual(draw(35, '6901234567892').zpl, draw(68, '6901234567892').zpl)
  assert.throws(() => draw(68, '6901234567893'), /条码/)
  assert.throws(() => draw(5, '6901234567892'), /宽度/)
  assert.throws(() => draw(68, '中文', 'code128'), /条码/)
})
test('reject unsupported dpi, excessive dimensions/elements/text and off-paper barcode', () => {
  const draw = (patch, data = {}) => renderLabel({ layout: { ...layout, ...patch }, data })
  assert.throws(() => draw({ dpi: 600 }), /DPI/)
  assert.throws(() => draw({ canvasHeightMm: 501 }), /纸高/)
  assert.throws(() => draw({ elements: Array(101).fill(text) }), /元素/)
  assert.throws(() => draw({ elements: [{ ...barcode, x: 74 }] }, { code: '1234' }), /纸张/)
})
test('large 300 DPI label splits graphic fields at the ZPL 99999-byte limit', () => {
  const r = renderLabel({ layout: { ...layout, dpi: 300, canvasWidthMm: 120, canvasHeightMm: 500, elements: [{ ...text, y: 480 }] }, data: { name: '标签底部' } })
  const fields = [...r.zpl.matchAll(/\^FO0,(\d+)\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/g)]
  assert.ok(fields.length > 1)
  let rows = 0
  for (const f of fields) {
    assert.equal(+f[1], rows); assert.ok(+f[2] <= 99999); assert.equal(f[2], f[3])
    assert.equal(f[5].length / 2, +f[2]); rows += +f[2] / +f[4]
  }
  assert.equal(rows, r.heightDots)
})
for (const dpi of [203, 300]) for (const [sym, code] of [['code128', 'SP000001'], ['code128', '123456789012'], ['code128', ' A B '], ['ean13', '6901234567892']]) {
  test(`${dpi} DPI ${sym} decodes with independent ZXing scanner: ${code}`, async () => {
    const { MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = require('../backend/node_modules/@zxing/library')
    const r = renderLabel({ layout: { ...layout, dpi, elements: [{ ...barcode, barcodeSymbology: sym }] }, data: { code } })
    const img = await loadImage(r.imageDataUrl), c = createCanvas(r.widthDots, r.heightDots), ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const rgba = ctx.getImageData(0, 0, r.widthDots, r.heightDots).data
    const gray = new Uint8ClampedArray(r.widthDots * r.heightDots)
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]
    const decoded = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray, r.widthDots, r.heightDots))))
    assert.equal(decoded.getText(), code)
  })
}
test('worker output is identical, rejects invalid input, and remains usable after a render error', async () => {
  const { renderLabelAsync } = require('../backend/src/modules/print-jobs/labelRasterService')
  const input = { layout, data: { name: '中文', code: '1234' } }
  assert.deepEqual(await renderLabelAsync(input), renderLabel(input))
  await assert.rejects(renderLabelAsync({ ...input, data: { code: '中文' } }), /条码/)
  assert.deepEqual(await renderLabelAsync(input), renderLabel(input))
})

test('large package summaries only affect referenced text and are bounded without blocking package completion', () => {
  const name = '测试商品'.repeat(2000)
  const simple = { ...layout, elements: [barcode] }
  assert.equal(renderLabel({ layout: simple, data: { code: 'BOX001', item_list: name } }).zpl,
    renderLabel({ layout: simple, data: { code: 'BOX001' } }).zpl)
  assert.ok(renderLabel({ layout, data: { code: 'BOX001', name } }).imageDataUrl)
})
test('worker queue is bounded and strips non-rendering metadata before crossing threads', async () => {
  const { renderLabelAsync } = require('../backend/src/modules/print-jobs/labelRasterService')
  const { prepareLabelInput } = require('../backend/src/modules/print-jobs/labelRasterValidation')
  const input = { layout: { ...layout, ignored: 'x'.repeat(20000) }, data: { code: '1234' } }
  assert.ok(JSON.stringify(prepareLabelInput(input)).length < 20000)
  const tasks = Array.from({ length: 17 }, () => renderLabelAsync(input))
  const results = await Promise.allSettled(tasks)
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  assert.equal(results.at(-1).reason.code, 'LABEL_RENDER_BUSY')
})
