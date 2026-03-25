/**
 * 独立 APK：已配置 flowcube:pdaApiOrigin 时启动拉取 /api/health，失败则阻断并提示。
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { checkPdaApiHealth, isPdaViteLiveHost } from '@/lib/pdaRuntime'
import { Button } from '@/components/ui/button'

function initialGatePhase(): 'checking' | 'ok' | 'fail' {
  if (typeof window === 'undefined') return 'ok'
  if (!Capacitor.isNativePlatform() || isPdaViteLiveHost()) return 'ok'
  return 'checking'
}

export default function PdaConnectionGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [phase, setPhase] = useState<'checking' | 'ok' | 'fail'>(initialGatePhase)

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || isPdaViteLiveHost()) return
    let cancelled = false
    ;(async () => {
      const ok = await checkPdaApiHealth()
      if (cancelled) return
      setPhase(ok ? 'ok' : 'fail')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (phase === 'checking') {
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

  const onLoginConfig = location.pathname.startsWith('/pda/login')

  if (phase === 'fail' && !onLoginConfig) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-base font-medium text-destructive">无法连接服务器，请检查地址</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          请确认手机与服务器网络互通，后端已启动，且登录页填写的地址正确（含端口，如 :3000）。
        </p>
        <Button type="button" onClick={() => navigate('/pda/login', { replace: true })}>
          前往配置
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
