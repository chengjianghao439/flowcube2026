import { useState } from 'react'
import { useLogin } from '@/hooks/useAuth'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'

const IS_ELECTRON_DESKTOP = import.meta.env.VITE_ELECTRON === '1'

export default function LoginPage() {
  const { mutate: login, isPending, error } = useLogin()

  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [remember,     setRemember]     = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return

    // API 根地址由构建期 VITE_ERP_PRODUCTION_ORIGIN、启动时 bootstrap、本机已存配置决定，无需在登录页填写
    applyErpApiBaseFromStorage()
    login({ username, password })
  }

  return (
    <div className="flex min-h-screen bg-background-light font-display text-slate-900 antialiased dark:bg-background-dark dark:text-slate-100">

      {/* ── 左侧：品牌区 ─────────────────────────────────── */}
      <div className="relative hidden w-7/12 flex-col justify-between overflow-hidden border-r border-slate-200 bg-slate-50 p-12 dark:border-slate-800 dark:bg-slate-900/50 lg:flex">

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <span className="material-symbols-outlined text-[20px]">layers</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">FlowCube</h1>
          <div className="absolute -bottom-4 left-11 whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-slate-400">
            企业管理系统
          </div>
        </div>

        {/* 主文案 + 特性列表 + 预览卡片 */}
        <div className="relative z-10 max-w-xl">
          <h2 className="mb-6 text-5xl font-bold leading-[1.1] tracking-tight text-slate-900 dark:text-white">
            让企业管理更简单、更高效
          </h2>
          <ul className="mb-10 space-y-4">
            <li className="flex items-center gap-3 font-medium text-slate-600 dark:text-slate-300">
              <span className="material-symbols-outlined text-[22px] text-primary">check_circle</span>
              <span>进销存一体化管理</span>
            </li>
            <li className="flex items-center gap-3 font-medium text-slate-600 dark:text-slate-300">
              <span className="material-symbols-outlined text-[22px] text-primary">check_circle</span>
              <span>实时库存与批次追踪</span>
            </li>
            <li className="flex items-center gap-3 font-medium text-slate-600 dark:text-slate-300">
              <span className="material-symbols-outlined text-[22px] text-primary">check_circle</span>
              <span>仓库作业 PDA 条码扫描</span>
            </li>
          </ul>

          {/* 预览卡片 */}
          <div className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-xl transition-transform duration-700 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-700">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-400/20" />
                <div className="h-3 w-3 rounded-full bg-amber-400/20" />
                <div className="h-3 w-3 rounded-full bg-emerald-400/20" />
              </div>
              <div className="mx-auto h-4 w-32 rounded-full bg-slate-100 dark:bg-slate-700" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 h-32 rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                <div className="mb-2 h-4 w-1/2 rounded bg-primary/10" />
                <div className="h-20 w-full rounded bg-primary/5" />
              </div>
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                <div className="h-10 w-10 rounded-full bg-primary/10" />
                <div className="h-2 w-12 rounded bg-slate-200 dark:bg-slate-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div className="h-12" />

        {/* 背景装饰圆 */}
        <div className="absolute right-0 top-0 -mr-20 -mt-20 h-96 w-96 rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-96 w-96 rounded-full bg-primary/[0.03] blur-3xl" />
      </div>

      {/* ── 右侧：登录面板 ────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col justify-center bg-white px-8 dark:bg-background-dark sm:px-16 lg:px-24 xl:px-32">
        <div className="mx-auto w-full max-w-lg">

          {/* Mobile Logo（仅小屏显示） */}
          <div className="relative mb-12 flex items-center gap-3 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
              <span className="material-symbols-outlined text-[20px]">layers</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">FlowCube</h1>
            <div className="absolute -bottom-4 left-11 whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-slate-400">
              企业管理系统
            </div>
          </div>

          {/* 标题 */}
          <div className="mb-10">
            <h3 className="mb-2 text-3xl font-bold text-slate-900 dark:text-white">欢迎登录</h3>
            <p className="text-slate-500 dark:text-slate-400">请输入账号信息登录系统</p>
            {IS_ELECTRON_DESKTOP && (
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                服务器地址已随安装包配置；若无法连接，请按{' '}
                <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Ctrl</kbd>+
                <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Shift</kbd>+
                <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">S</kbd>{' '}
                修改。
              </p>
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              {error.message || '登录失败，请检查账号和密码'}
            </div>
          )}

          {/* 登录表单 */}
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>

            {/* 账号 */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="username">
                登录账号
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">
                  mail
                </span>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="登录账号"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isPending}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-slate-900 outline-none placeholder:text-slate-400 transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white"
                />
              </div>
            </div>

            {/* 密码 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="password">
                  登录密码
                </label>
                <a
                  className="text-sm font-semibold text-primary transition-opacity hover:opacity-80"
                  href="#"
                  onClick={(e) => e.preventDefault()}
                >
                  忘记密码？
                </a>
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">
                  lock
                </span>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="登录密码"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isPending}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-12 text-slate-900 outline-none placeholder:text-slate-400 transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {/* 记住我 */}
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <label className="text-sm text-slate-600 dark:text-slate-400" htmlFor="remember">
                30 天内保持登录状态
              </label>
            </div>

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={isPending || !username.trim() || !password.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
                  <span>登录系统</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </>
              )}
            </button>

          </form>

          {/* 底部 */}
          <div className="mt-12 text-center text-slate-500 dark:text-slate-400">
            <p>
              尚未开通系统账号？{' '}
              <a
                className="font-bold text-primary hover:underline"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                联系管理员
              </a>
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
