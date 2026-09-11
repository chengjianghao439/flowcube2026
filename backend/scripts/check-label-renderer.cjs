// Build-time check: native canvas binary, bundled CJK font and barcode encoder must all load.
const assert = require('node:assert/strict')
const { renderLabel } = require('../src/modules/print-jobs/labelRaster')
const { defaultLabelLayout } = require('../src/modules/print-jobs/labelRasterDefaults')
for (const dpi of [203, 300]) {
  const result = renderLabel({ layout: { ...defaultLabelLayout(8), dpi }, data: { product_code: 'SP000001', product_name: '极序 中文标签' } })
  assert.ok(result.zpl.includes('^GFA,'))
  assert.ok(result.imageDataUrl.startsWith('data:image/png;base64,'))
  assert.equal(result.widthDots, Math.round(75 * dpi / 25.4))
}
console.log('Label renderer: CJK font, barcode and PNG/ZPL available at 203/300 DPI')
