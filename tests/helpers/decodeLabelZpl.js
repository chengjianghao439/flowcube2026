const assert = require('node:assert/strict')
const { MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType } = require('../../backend/node_modules/@zxing/library')

// Decode the queued graphic itself; do not rerender its expected business data.
function decodeLabelZpl(zpl) {
  const dimensions = zpl.match(/\^PW(\d+)\^LL(\d+)/)
  assert.ok(dimensions, 'queued label has paper dimensions')
  const width = +dimensions[1], height = +dimensions[2]
  const pixels = new Uint8ClampedArray(width * height).fill(255)
  const fields = [...zpl.matchAll(/\^FO0,(\d+)\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/g)]
  assert.ok(fields.length, 'queued label contains self-contained graphics')
  let nextRow = 0
  for (const field of fields) {
    const y0 = +field[1], stride = +field[4], bytes = Buffer.from(field[5], 'hex')
    assert.equal(y0, nextRow)
    assert.equal(bytes.length, +field[2])
    assert.equal(field[2], field[3])
    assert.equal(stride, Math.ceil(width / 8))
    const rows = bytes.length / stride
    assert.ok(Number.isInteger(rows) && y0 + rows <= height)
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      if (bytes[y * stride + (x >> 3)] & (128 >> (x % 8))) pixels[(y0 + y) * width + x] = 0
    }
    nextRow += rows
  }
  assert.equal(nextRow, height)
  const reader = new MultiFormatReader()
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))),
    new Map([[DecodeHintType.TRY_HARDER, true]])).getText()
}
module.exports = { decodeLabelZpl }
