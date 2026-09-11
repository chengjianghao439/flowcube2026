/** Canonical label rendering: the PNG and ^GFA are derived from the same 1-bit pixels. */
const path = require('node:path')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const JsBarcode = require('jsbarcode')
const { resolveLayout } = require('./labelGeometry')
const { prepareLabelInput, invalid } = require('./labelRasterValidation')
const FONT = 'Flowcube Label CJK'
let fontLoaded = false
function loadFont() {
  if (fontLoaded) return
  const font = GlobalFonts.registerFromPath(path.join(__dirname, '../../../assets/fonts/NotoSansCJKsc-Regular.otf'), FONT)
  if (!font) throw new Error('标签中文字体加载失败')
  fontLoaded = true
}

function drawText(ctx, value, x, y, w, h, size, align = 'left') {
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  ctx.font = `${size}px "${FONT}"`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = align
  const measure = ctx.measureText('国Ag')
  const ascent = Math.ceil(measure.actualBoundingBoxAscent)
  const lineHeight = Math.max(size, ascent + Math.ceil(measure.actualBoundingBoxDescent))
  const anchor = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x
  let baseline = y + ascent
  let line = ''
  const flush = () => { ctx.fillText(line, anchor, baseline); baseline += lineHeight; line = '' }
  for (const char of value.replace(/\r\n?/g, '\n')) {
    if (baseline - ascent >= y + h) break
    if (char === '\n') { flush(); continue }
    if (line && ctx.measureText(line + char).width > w) flush()
    line += char
  }
  if (line && baseline - ascent < y + h) ctx.fillText(line, anchor, baseline)
  ctx.restore()
}

function drawBarcode(ctx, p, x, y, w, h, dot) {
  const encoded = {}
  try { JsBarcode(encoded, p.value, { format: p.symbology === 'ean13' ? 'EAN13' : 'CODE128', displayValue: true, margin: 0 }) } catch {
    invalid('条码内容不符合所选码制，请检查内容或切换码制')
  }
  const bits = encoded.encodings.map(e => e.data).join('')
  // EAN-13 requires at least 11 modules left / 7 right; use 11 both sides.
  const quiet = p.symbology === 'ean13' ? 11 : 10
  const moduleWidth = Math.floor(w / (bits.length + quiet * 2))
  if (moduleWidth < 1) invalid('条码宽度不足，请加宽条码元素或缩短内容')
  const size = Math.max(8, Math.round(2.5 * dot))
  const textHeight = p.hri ? Math.ceil(size * 1.25) + Math.round(0.5 * dot) : 0
  const barHeight = h - textHeight
  if (barHeight < Math.round(2 * dot)) invalid('条码高度不足，请加高条码元素或关闭可读文字')
  const left = x + Math.floor((w - bits.length * moduleWidth) / 2)
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#000'
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') ctx.fillRect(left + i * moduleWidth, y, moduleWidth, barHeight)
  if (p.hri) {
    const hri = p.symbology === 'ean13' ? encoded.encodings.map(e => e.text).join('') : p.value
    ctx.font = `${size}px "${FONT}"`
    if (ctx.measureText(hri).width > w) invalid('条码可读文字超出宽度，请加宽条码元素或关闭可读文字')
    drawText(ctx, hri, x, y + barHeight + Math.round(0.5 * dot), w, textHeight, size, 'center')
  }
}

function renderLabel(input) {
  input = prepareLabelInput(input)
  loadFont()
  const { layout, data = {}, paperSize = 'thermal75', preview = true } = input
  const dpi = layout.dpi ?? 203, dot = dpi / 25.4
  const { widthMm, heightMm, primitives } = resolveLayout(layout, data, paperSize)
  const widthDots = Math.round(widthMm * dot), heightDots = Math.round(heightMm * dot)
  const canvas = createCanvas(widthDots, heightDots), ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, widthDots, heightDots); ctx.fillStyle = '#000'
  for (const p of primitives) {
    const x = Math.round(p.xMm * dot), y = Math.round(p.yMm * dot)
    const w = Math.round(p.widthMm * dot), h = Math.round(p.heightMm * dot)
    if (p.kind === 'barcode') {
      if (x < 0 || y < 0 || x + w > widthDots || y + h > heightDots) invalid('条码超出纸张边界，请调整位置或尺寸')
      drawBarcode(ctx, p, x, y, w, h, dot)
    } else {
      drawText(ctx, p.text, x, y, w, h, Math.max(1, Math.round(p.fontHeightMm * dot)), p.align)
    }
  }
  const pixels = ctx.getImageData(0, 0, widthDots, heightDots)
  const stride = Math.ceil(widthDots / 8), bytes = Buffer.alloc(stride * heightDots)
  for (let y = 0; y < heightDots; y++) for (let x = 0; x < widthDots; x++) {
    const i = (y * widthDots + x) * 4
    const black = pixels.data[i] < 128
    if (black) bytes[y * stride + (x >> 3)] |= 128 >> (x % 8)
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = black ? 0 : 255
    pixels.data[i + 3] = 255
  }
  // Plain ASCII ^GF works with existing RAW consumers, no resident font or downloaded objects.
  const rowsPerField = Math.floor(99999 / stride)
  const fields = []
  for (let y = 0; y < heightDots; y += rowsPerField) {
    const chunk = bytes.subarray(y * stride, Math.min(y + rowsPerField, heightDots) * stride)
    fields.push(`^FO0,${y}^GFA,${chunk.length},${chunk.length},${stride},${chunk.toString('hex').toUpperCase()}^FS`)
  }
  const zpl = `^XA^LH0,0^PW${widthDots}^LL${heightDots}${fields.join('')}^XZ`
  let imageDataUrl
  if (preview) { ctx.putImageData(pixels, 0, 0); imageDataUrl = canvas.toDataURL('image/png') }
  return { widthMm, heightMm, widthDots, heightDots, dpi, zpl, imageDataUrl }
}
module.exports = { renderLabel }
