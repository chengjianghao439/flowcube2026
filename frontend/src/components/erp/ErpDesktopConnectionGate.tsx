/**
 * Electron 打包（VITE_ELECTRON）：已配置 API 根地址时启动先探测 /api/health；
 * 失败则阻断进入业务页，引导至登录页修改地址（登录页始终可访问）。
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { checkErpApiHealth, getStoredApiOrigin } from '@/lib/apiOrigin'
import { Button } from '@/components/ui/button'

type Phase = 'ok' | 'checking' | 'fail'

function initialPhase(): Phase {
  if (import.meta.env.VITE_ELECTRON !== '1') return 'ok'
  return getStoredApiOrigin() ? 'checking' : 'ok'
}

export default function ErpDesktopConnectionGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (import.meta.env.VITE_ELECTRON !== '1') return
    let cancelled = false
    void (async () => {
      const origin = getStoredApiOrigin()
      if (!origin) {
        if (!cancelled) setPhase('ok')
        return
      }
      if (!cancelled) setPhase('checking')
      const ok = await checkErpApiHealth()
      if (cancelled) return
      setPhase(ok ? 'ok' : 'fail')
    })()
    return () => {
      cancelled = true
    }
  }, [location.pathname, tick])

  if (import.meta.env.VITE_ELECTRON !== '1') return <>{children}</>

  const origin = getStoredApiOrigin()
  const onLogin = location.pathname === '/login'

  if (origin && phase === 'checking' && !onLogin) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <svg className="h-8 w-8 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-muted-foreground">正在连接服务器…</p>
      </div>
    )
  }

  if (origin && phase === 'fail' && !onLogin) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-base font-medium text-destructive">无法连接服务器，请检查地址与网络</p>
        <p className="max-w-md text-xs text-muted-foreground">
          当前保存的 API 地址无法访问 /api/health。请确认后端已启动，且 CORS 允许桌面端（Origin 为 null）。可在任意界面按{' '}
          <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">Shift</kbd>+
          <kbd className="rounded border px-1">S</kbd> 修改 API 根地址。
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="default" onClick={() => navigate('/login', { replace: true })}>
            前往登录页
          </Button>
          <Button type="button" variant="outline" onClick={() => setTick((t) => t + 1)}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
