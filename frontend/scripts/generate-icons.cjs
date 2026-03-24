/**
 * 生成 PWA 图标（纯 Node.js，无外部依赖）
 * 生成两种尺寸：192x192 / 512x512
 * FlowCube 品牌色：#002FA7 (RGB 0, 47, 167)
 */
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ── CRC32 ────────────────────────────────────────────────────────────────────
function makeCRC32() {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return buf => {
    let crc = 0xFFFFFFFF
    for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
}
const crc32 = makeCRC32()

// ── PNG chunk builder ────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const typeArr = Buffer.from(type, 'ascii')
  const lenBuf  = Buffer.allocUnsafe(4)
  const crcBuf  = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(data.length, 0)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeArr, data])), 0)
  return Buffer.concat([lenBuf, typeArr, data, crcBuf])
}

// ── 生成实心色块 PNG ─────────────────────────────────────────────────────────
function generateSolidPNG(size, r, g, b) {
  // 8-byte PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR: width / height / 8-bit RGB / no filter / no interlace
  const ihdrData = Buffer.allocUnsafe(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData.writeUInt8(8,  8)   // bit depth
  ihdrData.writeUInt8(2,  9)   // color type: Truecolor RGB
  ihdrData.writeUInt8(0, 10)   // compression method
  ihdrData.writeUInt8(0, 11)   // filter method
  ihdrData.writeUInt8(0, 12)   // interlace method
  const ihdr = pngChunk('IHDR', ihdrData)

  // Raw scanlines: 1 filter byte (0=None) + size * 3 RGB bytes per row
  const rowLen  = 1 + size * 3
  const rawData = Buffer.allocUnsafe(rowLen * size)
  for (let y = 0; y < size; y++) {
    const off = y * rowLen
    rawData[off] = 0              // filter type: None
    for (let x = 0; x < size; x++) {
      rawData[off + 1 + x * 3]     = r
      rawData[off + 1 + x * 3 + 1] = g
      rawData[off + 1 + x * 3 + 2] = b
    }
  }

  const idat = pngChunk('IDAT', zlib.deflateSync(rawData))
  const iend = pngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([sig, ihdr, idat, iend])
}

// ── main ─────────────────────────────────────────────────────────────────────
const outDir = path.resolve(__dirname, '../public/icons')
fs.mkdirSync(outDir, { recursive: true })

// FlowCube brand: #002FA7
const [R, G, B] = [0, 47, 167]

const sizes = [192, 512]
for (const size of sizes) {
  const file = path.join(outDir, `icon-${size}.png`)
  fs.writeFileSync(file, generateSolidPNG(size, R, G, B))
  console.log(`✓ Generated ${file}`)
}
console.log('PWA icons ready.')
