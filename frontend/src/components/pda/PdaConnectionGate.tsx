/**
 * 独立 APK：使用单一 API origin 规则（API_BASE_URL runtime override，否则回退到构建期默认）探测 /api/health。
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { checkPdaApiHealth, isPdaViteLiveHost } from '@/lib/pdaRuntime'
import { Button } from '@/components/ui/button'

function initialGatePhase(): 'checking' | 'ok' | 'fail' {
  if (typeof window === 'undefined') return 'ok'
  if (!Capacitor.isNativePlatform() || isPdaViteLiveHost()) return 'ok'
  return 'checking'
}

export default function PdaConnectionGate({ children }: { children: React.ReactNode }) {
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
        <p className="text-base font-medium text-destructive">无法连接服务器</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          请确认 PDA 与服务器网络互通，后端已启动。应用会优先使用已保存的 API_BASE_URL；未保存时回退到安装包内置默认地址。
        </p>
        <Button type="button" onClick={() => window.location.reload()}>
          重试连接
        </Button>
      </div>
    )
  }

  return <>{children}</>
}
