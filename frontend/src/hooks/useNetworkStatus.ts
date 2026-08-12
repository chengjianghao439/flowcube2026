/**
 * useNetworkStatus — 网络状态监测 Hook
 *
 * 监听 online/offline 事件 + 定期心跳探测，区分：
 *  - online：有网且服务器可达
 *  - offline：无网或服务器不可达
 *  - recovering：刚恢复，正在同步中
 */
import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { getApiHealthUrl, getRelativeApiHealthUrl } from '@/lib/apiOrigin'
import { IS_CAPACITOR_PDA } from '@/lib/platform'

export type NetworkStatus = 'online' | 'offline' | 'recovering'

const HEARTBEAT_INTERVAL = 10_000  // 10 秒探一次
const HEARTBEAT_TIMEOUT  = 5_000

// 初始不直接采用 navigator.onLine（部分环境它长期为 false 而实际可达，见 startHeartbeat 注释），
// 以 online 起步，由首次心跳用真实探测在 10 秒内修正。
let globalStatus: NetworkStatus = 'online'
const listeners = new Set<(s: NetworkStatus) => void>()

function setGlobal(s: NetworkStatus) {
  if (s === globalStatus) return
  globalStatus = s
  listeners.forEach(fn => fn(s))
}

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), HEARTBEAT_TIMEOUT)
    // PDA 浏览器 dev（VITE_CAPACITOR 构建但非原生，即 Vite live 跑在浏览器）：心跳强制走相对 /api
    // （Vite 代理到本机后端），不依赖 apiClient.defaults.baseURL——baseURL 一旦被 ERP fallback
    // 改写成绝对地址，探测就会落到代理之外误报断网。真机 APK 无 Vite 代理，仍走 getApiHealthUrl。
    const url = IS_CAPACITOR_PDA && !Capacitor.isNativePlatform()
      ? getRelativeApiHealthUrl()
      : getApiHealthUrl()
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

// 全局心跳，只启动一次
let heartbeatStarted = false
function startHeartbeat() {
  if (heartbeatStarted) return
  heartbeatStarted = true
  setInterval(async () => {
    // navigator.onLine 在部分环境不可靠（浏览器 dev + 代理/VPN、开发者工具、macOS 网络切换
    // 都可能让它长期为 false 而实际后端可达）。因此 onLine=false 时不直接判离线，
    // 仍做一次真实探测：后端可达就保持 online，只有探测也失败才报 offline。
    if (!navigator.onLine) {
      const ok = await probe()
      setGlobal(ok ? 'online' : 'offline')
      return
    }
    const ok = await probe()
    if (ok && globalStatus !== 'online') setGlobal('online')
    if (!ok) setGlobal('offline')
  }, HEARTBEAT_INTERVAL)
}

window.addEventListener('online',  async () => {
  const ok = await probe()
  setGlobal(ok ? 'online' : 'offline')
})
window.addEventListener('offline', () => setGlobal('offline'))
startHeartbeat()

export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>(globalStatus)

  useEffect(() => {
    listeners.add(setStatus)
    return () => { listeners.delete(setStatus) }
  }, [])

  return status
}
