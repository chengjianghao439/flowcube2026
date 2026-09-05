/**
 * Electron 打包：已配置 API 根地址时启动先探测 /api/health；
 * 失败则阻断进入业务页，引导至登录页修改地址（登录页始终可访问）。
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { checkErpApiHealth, getStoredApiOrigin } from '@/lib/apiOrigin'
import { isElectronRuntime } from '@/lib/platform'
import { Button } from '@/components/ui/button'

type Phase = 'ok' | 'checking' | 'fail'

function initialPhase(): Phase {
  if (!isElectronRuntime() || import.meta.env.DEV) return 'ok'
  return getStoredApiOrigin() ? 'checking' : 'fail'
}

export default function ErpDesktopConnectionGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [tick, setTick] = useState(0)
  const origin = getStoredApiOrigin()

  useEffect(() => {
    if (!isElectronRuntime() || import.meta.env.DEV) return
    let cancelled = false
    void (async () => {
      if (!origin) {
        if (!cancelled) setPhase('fail')
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
    // 只在服务器地址变化或用户点重试时重新探测；不要用 location.pathname，
    // 否则每次内部路由切换（如切换页签）都会把 children 换成 loading 遮罩，
    // 导致 KeepAliveOutlet 及其下所有页签被真实卸载重建，编辑中的表单丢失。
  }, [origin, tick])

  if (!isElectronRuntime() || import.meta.env.DEV) return <>{children}</>

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

  if (phase === 'fail' && !onLogin) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col items-center justify-center gap-5 bg-background px-8 text-center">
        <p className="text-xl font-semibold text-foreground">
          {origin ? '无法连接服务器，请检查地址与网络' : '安装包未配置服务器地址'}
        </p>
        {origin ? (
          <p className="max-w-md break-all font-mono text-xs text-muted-foreground">
            正在连接：<span className="text-foreground">{origin}</span>
          </p>
        ) : null}
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          {origin
            ? '请确认后端已启动、服务器网络可达；若长期无法连接，请联系管理员。'
            : '当前安装包未注入服务器地址，请联系管理员重新构建安装包（注入生产 API 地址）。'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="default" onClick={() => navigate('/login', { replace: true })}>
            前往登录页
          </Button>
          {origin ? (
            <Button type="button" variant="outline" onClick={() => setTick((t) => t + 1)}>
              重试
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
