#!/usr/bin/env node
/**
 * 在 cap sync 前写入 frontend/.pda-server-url，供 capacitor.config.ts 读取。
 * 自动选取本机局域网 IPv4 + Vite 默认端口 5173，避免电脑换 IP 后手改地址。
 *
 * 跳过：已设置 PDA_SERVER_URL，或 SKIP_PDA_LAN_DETECT=1
 * 若已存在 .pda-server-url：默认不再覆盖（避免自动脚本选错网卡把你手改的正确 IP 改坏）。
 * 需要按当前网卡重新探测：PDA_REFRESH_LAN=1 npm run pda:sync
 */
import { existsSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { networkInterfaces } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendRoot = join(__dirname, '..')
const outFile = join(frontendRoot, '.pda-server-url')

if (process.env.PDA_SERVER_URL?.trim()) {
  console.log('[pda-lan] 已设置 PDA_SERVER_URL，跳过自动写入')
  process.exit(0)
}
if (process.env.SKIP_PDA_LAN_DETECT === '1') {
  console.log('[pda-lan] SKIP_PDA_LAN_DETECT=1，跳过自动写入')
  process.exit(0)
}

if (existsSync(outFile) && process.env.PDA_REFRESH_LAN !== '1') {
  console.log('[pda-lan] 已存在 .pda-server-url，保留内容（重写请删文件或设 PDA_REFRESH_LAN=1）')
  process.exit(0)
}

function collectExternalIPv4() {
  const list = []
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      const fam = net.family
      if (fam !== 'IPv4' && fam !== 4) continue
      if (net.internal) continue
      list.push({ name, address: net.address })
    }
  }
  return list
}

function scoreIp(ip) {
  if (ip.startsWith('169.254.')) return -100 // 链路本地，优先排除
  if (ip.startsWith('192.168.')) return 100
  if (ip.startsWith('10.')) return 80
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 40 // 可能是内网也可能是 Docker
  return 20
}

/** 优先常见无线/以太网接口名，再按网段打分 */
function pickLanAddress(candidates) {
  if (candidates.length === 0) return null
  const preferName = (n) => {
    const x = n.toLowerCase()
    if (x.includes('wi-fi') || x.includes('wlan') || x.includes('wlp')) return 3
    if (x.includes('en0') || x.includes('en1') || x === 'eth0') return 2
    if (x.includes('ethernet') || x.includes('以太网')) return 2
    return 0
  }
  return candidates
    .map((c) => ({
      ...c,
      s: scoreIp(c.address) * 10 + preferName(c.name),
    }))
    .sort((a, b) => b.s - a.s)[0]?.address ?? null
}

const port = process.env.PDA_VITE_PORT?.trim() || '5173'
let candidates = []
try {
  candidates = collectExternalIPv4()
} catch (e) {
  console.warn('[pda-lan] 读取网卡失败，跳过自动写入:', (e && e.message) || e)
  process.exit(0)
}

const ip = pickLanAddress(candidates)

if (!ip) {
  console.warn('[pda-lan] 未检测到可用局域网 IPv4，保留现有 .pda-server-url 或使用 10.0.2.2（模拟器）')
  console.warn('[pda-lan] 可手动设置 PDA_SERVER_URL 或在本机创建 frontend/.pda-server-url')
  process.exit(0)
}

const url = `http://${ip}:${port}`
writeFileSync(outFile, `${url}\n`, 'utf8')
console.log(`[pda-lan] 已写入 ${outFile}`)
console.log(`[pda-lan] ${url}（执行 cap sync 后套壳将加载此地址）`)
