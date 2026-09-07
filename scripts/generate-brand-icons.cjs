#!/usr/bin/env node
/** 从已确认 PNG 导出平台资源。需要 sharp（可由 NODE_PATH 提供），不在应用运行时执行。 */
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const root = path.resolve(__dirname, '..')
const blue = '#0b339a'
const source = path.join(root, 'docs/branding/flow-icon-approved.png')

async function save(relative, data) {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, data)
}

async function main() {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  // 蓝白图稿的白色标记提取为透明前景，消除 JPG/生成稿底色的微小噪点。
  const rgba = Buffer.alloc(info.width * info.height * 4)
  for (let i = 0; i < info.width * info.height; i++) {
    const light = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2])
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((light - 24) * 255 / 218)))
  }
  const mark = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  async function icon(size, shape = 'square') {
    const foreground = await sharp(mark).resize(size, size).png().toBuffer()
    let output = await sharp({ create: { width: size, height: size, channels: 4, background: blue } })
      .composite([{ input: foreground }]).png().toBuffer()
    if (shape !== 'square') {
      const geometry = shape === 'circle'
        ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>`
        : `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="white"/>`
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${geometry}</svg>`)
      output = await sharp(output).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
    }
    return output
  }
  for (const size of [16, 32, 180, 192, 512]) await save(`frontend/public/icons/icon-${size}.png`, await icon(size))
  await save('frontend/src/assets/brand/flow-icon.png', await icon(512))
  await save('desktop/build/icon.png', await icon(512, 'rounded'))
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const entries = await Promise.all(sizes.map(size => icon(size, 'rounded')))
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  entries.forEach((data, i) => {
    const p = 6 + i * 16
    header[p] = header[p + 1] = sizes[i] === 256 ? 0 : sizes[i]
    header.writeUInt16LE(1, p + 4)
    header.writeUInt16LE(32, p + 6)
    header.writeUInt32LE(data.length, p + 8)
    header.writeUInt32LE(offset, p + 12)
    offset += data.length
  })
  const ico = Buffer.concat([header, ...entries])
  await save('desktop/build/icon.ico', ico)
  await save('frontend/public/favicon.ico', ico)
  const icnsParts = []
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const png = await icon(size, 'rounded')
    const part = Buffer.alloc(8)
    part.write(type)
    part.writeUInt32BE(png.length + 8, 4)
    icnsParts.push(part, png)
  }
  const icnsHeader = Buffer.alloc(8)
  icnsHeader.write('icns')
  icnsHeader.writeUInt32BE(8 + icnsParts.reduce((n, b) => n + b.length, 0), 4)
  await save('desktop/build/icon.icns', Buffer.concat([icnsHeader, ...icnsParts]))
  const res = 'frontend/android/app/src/main/res'
  for (const [density, size, canvas] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
    await save(`${res}/mipmap-${density}/ic_launcher.png`, await icon(size, 'rounded'))
    await save(`${res}/mipmap-${density}/ic_launcher_round.png`, await icon(size, 'circle'))
    // 108dp 图层中将完整画布缩至 66%，白色标记全部落在中心 66dp 安全圆内。
    const inner = Math.round(canvas * 0.66)
    const inset = Math.floor((canvas - inner) / 2)
    const foreground = await sharp(mark).resize(inner, inner).png().toBuffer()
    await save(`${res}/mipmap-${density}/ic_launcher_foreground.png`, await sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00000000' } })
      .composite([{ input: foreground, left: inset, top: inset }]).png().toBuffer())
  }
  // 保留现有启动屏尺寸与方向，仅替换中心品牌标记。
  for (const dir of await fs.readdir(path.join(root, res))) {
    if (!dir.startsWith('drawable')) continue
    const file = `${res}/${dir}/splash.png`
    try { await fs.access(path.join(root, file)) } catch { continue }
    const { width, height } = await sharp(path.join(root, file)).metadata()
    const size = Math.round(Math.min(width, height) * 0.25)
    await save(file, await sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
      .composite([{ input: await icon(size, 'rounded'), gravity: 'centre' }]).png().toBuffer())
  }
  console.log('已生成网页、Electron、Android 图标与启动屏。')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
