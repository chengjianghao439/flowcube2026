#!/usr/bin/env node
// 读取实际 Windows PE 资源，避免配置正确但发布程序仍使用 Electron 默认图标。
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { NtExecutable, NtExecutableResource, Data } = require(require.resolve('resedit', { paths: [path.join(__dirname, '../desktop')] }))

const exePath = process.argv[2]
if (!exePath) throw new Error('用法: node scripts/verify-desktop-icon.cjs <应用.exe>')
const bytes = fs.readFileSync(exePath)
const executable = NtExecutable.from(bytes)
const resources = NtExecutableResource.from(executable)
const source = Data.IconFile.from(fs.readFileSync(path.join(__dirname, '../desktop/build/icon.ico')))
const digest = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex')
const embedded = new Set(resources.entries.filter(entry => entry.type === 3).map(entry => digest(entry.bin)))
for (const icon of source.icons) {
  const iconBytes = icon.data.isRaw() ? icon.data.bin : icon.data.generate()
  if (!embedded.has(digest(iconBytes))) throw new Error('实际程序缺少新品牌图标图层')
}
if (!source.icons.length) throw new Error('源 ICO 无图标')
console.log(`已验证 ${path.basename(exePath)} 内嵌 ${source.icons.length} 个新品牌图标图层，摘要全部匹配。`)
