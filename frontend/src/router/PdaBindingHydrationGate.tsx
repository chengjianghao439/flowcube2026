import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { initDeviceBinding } from '@/lib/pdaDeviceBinding'

/** ERP 直达 PDA 路由时也必须先水合设备缓存；独立 PDA 启动已水合时这里直接复用。 */
export default function PdaBindingHydrationGate() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let active = true
    void initDeviceBinding().then(ok => { if (active) setStatus(ok ? 'ready' : 'failed') })
    return () => { active = false }
  }, [])
  if (status === 'loading') return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在加载设备信息…</div>
  if (status === 'failed') return <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-sm">
    <p>设备信息加载失败，请重新绑定设备。</p>
    <button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => setStatus('ready')}>继续重新绑定</button>
  </div>
  return <Outlet />
}
