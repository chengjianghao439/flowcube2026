/**
 * Electron：主进程在用户确认退出后 dispatch CustomEvent，此处放行一次 beforeunload，
 * 避免与 useDirtyGuard 的二次系统离开提示叠加。
 */
import { useEffect } from 'react'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'
import { setAllowUnloadOnce } from '@/lib/electronUnloadGate'

export function DesktopQuitUnloadBridge() {
  useEffect(() => {
    if (!IS_ELECTRON_DESKTOP) return
    const h = () => setAllowUnloadOnce()
    window.addEventListener('flowcube-quit-confirmed', h)
    return () => window.removeEventListener('flowcube-quit-confirmed', h)
  }, [])
  return null
}
