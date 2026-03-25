import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useLogin } from '@/hooks/useAuth'
import { toast } from '@/lib/toast'
import PdaScanner from '@/components/pda/PdaScanner'
import {
  PDA_API_ORIGIN_KEY,
  PDA_LABEL_PRINTER_ID_KEY,
  isPdaViteLiveHost,
  normalizePdaApiOrigin,
  tryParseScannedServerUrl,
} from '@/lib/pdaRuntime'

export default function PdaLoginPage() {
  const { mutate: login, isPending, error } = useLogin('/pda')

  const showApiConfig = Capacitor.isNativePlatform() && !isPdaViteLiveHost()

  const [apiOrigin, setApiOrigin] = useState('')
  const [labelPrinterId, setLabelPrinterId] = useState('')
  const [scanServerMode, setScanServerMode] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    setApiOrigin(localStorage.getItem(PDA_API_ORIGIN_KEY) ?? '')
    setLabelPrinterId(localStorage.getItem(PDA_LABEL_PRINTER_ID_KEY) ?? '')
  }, [])

  function applyScannedServerUrl(code: string) {
    const url = tryParseScannedServerUrl(code)
    if (!url) {
      toast.error('未识别为服务器地址，请扫含 http:// 或 https:// 的二维码')
      return
    }
    localStorage.setItem(PDA_API_ORIGIN_KEY, url)
    setApiOrigin(url)
    setScanServerMode(false)
    toast.success('已保存服务器地址')
    window.location.reload()
  }

  function saveApiServer() {
    const o = normalizePdaApiOrigin(apiOrigin)
    if (!o) {
      window.alert('请填写后端地址，例如：http://192.168.1.10:3000（不要带 /api）')
      return
    }
    localStorage.setItem(PDA_API_ORIGIN_KEY, o)
    const pid = labelPrinterId.trim()
    if (pid && /^\d+$/.test(pid)) {
      localStorage.setItem(PDA_LABEL_PRINTER_ID_KEY, pid)
    } else if (pid) {
      window.alert('标签打印机 ID 须为数字（与 ERP 打印机管理中的 ID 一致）')
      return
    } else {
      localStorage.removeItem(PDA_LABEL_PRINTER_ID_KEY)
    }
    window.location.reload()
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    login({ username, password })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 font-display">

      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/30">
          <span className="material-symbols-outlined text-[32px]">barcode_scanner</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">FlowCube PDA</h1>
        <p className="text-sm text-slate-400">仓库作业终端</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">

        <h2 className="mb-6 text-center text-xl font-bold text-white">操作员登录</h2>

        {/* 错误提示 */}
        {error && (
          <div className="mb-5 rounded-xl border border-red-800/40 bg-red-950/40 px-4 py-3 text-sm text-red-400">
            {error.message || '登录失败，请检查账号和密码'}
          </div>
        )}

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>

          {showApiConfig && (
            <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-amber-200/90">独立 App：请配置后端 API</p>
              <p className="text-[11px] text-amber-200/60 leading-snug">
                填写运行 FlowCube 后端的电脑地址与端口（默认 3000），保存后会重新加载页面。
              </p>
              <input
                type="url"
                inputMode="url"
                placeholder="http://192.168.1.10:3000"
                value={apiOrigin}
                onChange={(e) => setApiOrigin(e.target.value)}
                className="w-full rounded-lg border border-amber-800/50 bg-slate-900/80 px-3 py-2.5 text-sm text-white placeholder:text-amber-200/30 outline-none focus:border-amber-500"
              />
              <label className="block text-[11px] font-medium text-amber-200/80" htmlFor="pda-label-printer">
                标签打印机 ID（数字，用于 <code className="text-amber-100/90">window.printLabel</code>）
              </label>
              <input
                id="pda-label-printer"
                type="text"
                inputMode="numeric"
                placeholder="例如 1（见 ERP → 打印机管理）"
                value={labelPrinterId}
                onChange={(e) => setLabelPrinterId(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-lg border border-amber-800/50 bg-slate-900/80 px-3 py-2.5 text-sm text-white placeholder:text-amber-200/30 outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => setScanServerMode((v) => !v)}
                className="w-full rounded-lg border border-amber-600/50 py-2 text-sm font-medium text-amber-100 active:scale-[0.99]"
              >
                {scanServerMode ? '取消扫码配置' : '扫码配置服务器地址'}
              </button>
              {scanServerMode && (
                <div className="rounded-lg border border-amber-800/40 bg-slate-950/50 p-2">
                  <p className="text-[10px] text-amber-200/70 mb-2 px-1">请扫包含后端根地址的二维码（内容形如 http://IP:3000）</p>
                  <PdaScanner
                    onScan={applyScannedServerUrl}
                    placeholder="等待扫描服务器二维码…"
                    allowManualEntry={false}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={saveApiServer}
                className="w-full rounded-lg bg-amber-700/90 py-2 text-sm font-semibold text-white active:scale-[0.99]"
              >
                保存并重新加载
              </button>
            </div>
          )}

          {/* 账号 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="pda-username">
              登录账号
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">
                person
              </span>
              <input
                id="pda-username"
                type="text"
                placeholder="请输入账号"
                autoComplete="username"
                autoFocus={!showApiConfig || !scanServerMode}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isPending}
                className="w-full rounded-xl border border-slate-600 bg-slate-700/60 py-3 pl-10 pr-4 text-white outline-none placeholder:text-slate-500 transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
          </div>

          {/* 密码 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="pda-password">
              登录密码
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">
                lock
              </span>
              <input
                id="pda-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending}
                className="w-full rounded-xl border border-slate-600 bg-slate-700/60 py-3 pl-10 pr-12 text-white outline-none placeholder:text-slate-500 transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
              <button
                type="button"
                tabIndex={-1}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
                onClick={() => setShowPassword((v) => !v)}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {/* 提交 */}
          <button
            type="submit"
            disabled={isPending || !username.trim() || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>登录中...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">login</span>
                <span>进入作业终端</span>
              </>
            )}
          </button>

        </form>
      </div>

      <details className="mt-6 w-full max-w-sm rounded-xl border border-slate-700/80 bg-slate-900/40 px-4 py-3 text-left">
        <summary className="cursor-pointer text-xs font-medium text-slate-400">
          套壳 App 白屏 / 换过电脑 IP？
        </summary>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          <strong className="text-slate-400">独立 APK</strong>：前端已打进安装包，只需在上方填<strong className="text-slate-400">后端</strong>
          地址；重新打包请执行 <code className="rounded bg-slate-800 px-1 text-slate-300">npm run pda:sync</code>。
          <br />
          <strong className="text-slate-400">开发热更新</strong>：在电脑执行{' '}
          <code className="rounded bg-slate-800 px-1 text-slate-300">npm run pda:sync:live</code>
          ，壳会打开局域网 Vite；IP 变更可配合 <code className="text-slate-800 px-1">.pda-server-url</code> 或{' '}
          <code className="text-slate-400">PDA_SERVER_URL=...</code>。
        </p>
      </details>

      {/* 底部提示 */}
      <p className="mt-6 text-xs text-slate-600">
        ERP 管理后台请访问{' '}
        <a href="/login" className="text-slate-500 underline hover:text-slate-400">/login</a>
      </p>
    </div>
  )
}
