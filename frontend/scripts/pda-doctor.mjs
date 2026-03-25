#!/usr/bin/env node
/**
 * 打印套壳将要加载的地址，并给出自检步骤（不修改任何文件）。
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function resolveUrl() {
  const fromEnv = process.env.PDA_SERVER_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const candidates = [
    join(process.cwd(), '.pda-server-url'),
    join(process.cwd(), 'frontend', '.pda-server-url'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'))
    if (line) return line.replace(/\/$/, '')
  }
  return 'http://10.0.2.2:5173'
}

const base = resolveUrl()
const pdaLogin = `${base}/pda/login`

console.log('')
console.log('── FlowCube PDA 地址自检 ──')
console.log('')
console.log('套壳将加载（与 capacitor server.url 一致）：')
console.log('  ', `${base}/pda`)
console.log('')
console.log('请先用手机浏览器打开（能打开说明网络通）：')
console.log('  ', pdaLogin)
console.log('')
console.log('若浏览器也打不开，依次检查：')
console.log('  1. 电脑已执行：cd frontend && npm run dev（终端里应看到 Network: http://192.168.x.x:5173/）')
console.log('  2. 手机与电脑同一 Wi‑Fi（不要用访客网络 / 隔离 AP）')
console.log('  3. 电脑防火墙允许 5173 入站（macOS：系统设置 → 网络 → 防火墙）')
console.log('  4. 在 frontend 目录执行：npm run pda:sync，再用 Android Studio 重新 Run 到手机')
console.log('  5. 仍不对：手动指定 IP 再 sync')
console.log('       PDA_SERVER_URL=http://你的电脑IP:5173 npm run pda:sync')
console.log('')
