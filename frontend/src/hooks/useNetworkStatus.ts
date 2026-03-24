/**
 * useNetworkStatus — 网络状态监测 Hook
 *
 * 监听 online/offline 事件 + 定期心跳探测，区分：
 *  - online：有网且服务器可达
 *  - offline：无网或服务器不可达
 *  - recovering：刚恢复，正在同步中
 */
import { useState, useEffect, useCallback } from 'react'

export type NetworkStatus = 'online' | 'offline' | 'recovering'

const HEARTBEAT_URL    = '/api/health'
const HEARTBEAT_INTERVAL = 10_000  // 10 秒探一次
const HEARTBEAT_TIMEOUT  = 5_000

let globalStatus: NetworkStatus = navigator.onLine ? 'online' : 'offline'
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
    const res = await fetch(HEARTBEAT_URL, { signal: ctrl.signal, cache: 'no-store' })
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
    if (!navigator.onLine) { setGlobal('offline'); return }
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
