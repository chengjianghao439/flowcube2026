const AppError = require('../../utils/AppError')

function invalid(message) { throw new AppError(message, 400, 'LABEL_RENDER_INVALID') }

// Validate before posting to the worker as well as inside it. Never allocate from unbounded input.
function validateLabelInput({ layout, data = {} } = {}) {
  if (!layout || !Array.isArray(layout.elements) || layout.elements.length > 100) invalid('标签画布须包含至多 100 个元素')
  if (layout.dpi != null && layout.dpi !== 203 && layout.dpi !== 300) invalid('标签 DPI 须为 203 或 300')
  for (const [key, min, max, name] of [['canvasWidthMm', 30, 120, '纸宽'], ['canvasHeightMm', 1, 500, '纸高']]) {
    if (layout[key] != null && (!Number.isFinite(layout[key]) || layout[key] < min || layout[key] > max)) invalid(`标签${name}须在 ${min}–${max} mm`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 100) invalid('标签内容格式不正确')
  for (const el of layout.elements) {
    if (!el || !['text', 'title', 'barcode'].includes(el.type)) invalid('标签仅支持文字、标题和条码元素')
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(el[key]) || Math.abs(el[key]) > 500 || (['width', 'height'].includes(key) && el[key] <= 0)) invalid('标签元素位置或尺寸不正确')
    }
    if (String(el.label ?? '').length > 4096 || String(el.fieldKey ?? '').length > 100) invalid('标签元素内容过长')
    const font = el.fontHeightMm ?? ((el.fontSize ?? 10) * 25.4 / 72)
    if (!Number.isFinite(font) || font <= 0 || font > 50) invalid('标签字高须大于 0 且不超过 50 mm')
  }
}
// Only send selected fields to the worker. Text already clips to its element box;
// bound long package summaries as display text, never reject a valid business operation.
function prepareLabelInput(input) {
  validateLabelInput(input)
  const data = Object.create(null)
  for (const el of input.layout.elements) {
    const value = input.data?.[el.fieldKey]
    if (value == null) continue
    if (!['string', 'number'].includes(typeof value)) invalid('标签内容只能是文字或数字')
    const text = String(value)
    if (el.type === 'barcode' && text.length > 256) invalid('条码内容过长，请缩短条码')
    data[el.fieldKey] = el.type === 'barcode' ? text : text.length > 4096 ? text.slice(0, 4095) + '…' : text
  }
  const keys = ['type', 'fieldKey', 'label', 'showLabel', 'x', 'y', 'width', 'height', 'fontHeightMm', 'fontSize', 'textAlign', 'barcodeSymbology', 'barcodeHRI']
  const layout = {
    canvasWidthMm: input.layout.canvasWidthMm, canvasHeightMm: input.layout.canvasHeightMm, dpi: input.layout.dpi,
    elements: input.layout.elements.map(el => Object.fromEntries(keys.map(key => [key, el[key]]))),
  }
  return { layout, data, paperSize: typeof input.paperSize === 'string' ? input.paperSize.slice(0, 20) : undefined, preview: input.preview !== false }
}
module.exports = { validateLabelInput, prepareLabelInput, invalid }
