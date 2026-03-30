import { useState } from 'react'
import { useLogin } from '@/hooks/useAuth'
import { loadSavedLoginForm } from '@/lib/loginCredentials'

export default function PdaLoginPage() {
  const { mutate: login, isPending, error } = useLogin('/pda')

  const [username, setUsername] = useState(() => loadSavedLoginForm().username)
  const [password, setPassword] = useState(() => loadSavedLoginForm().password)
  const [rememberPassword, setRememberPassword] = useState(
    () => loadSavedLoginForm().rememberPassword,
  )
  const [showPassword, setShowPassword] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    login({ username, password, rememberPassword })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 font-display">

      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/20">
          <span className="material-symbols-outlined text-[32px]">barcode_scanner</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">极序 Flow</h1>
        <p className="text-sm text-muted-foreground">仓库作业终端</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-xl shadow-slate-200/70">

        <h2 className="mb-6 text-center text-xl font-bold text-foreground">操作员登录</h2>

        {/* 错误提示 */}
        {error && (
          <div className="mb-5 rounded-xl border border-red-800/40 bg-red-950/40 px-4 py-3 text-sm text-red-400">
            {error.message || '登录失败，请检查账号和密码'}
          </div>
        )}

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          {/* 账号 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="pda-username">
              登录账号
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-muted-foreground">
                person
              </span>
              <input
                id="pda-username"
                type="text"
                placeholder="请输入账号"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isPending}
                className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-foreground outline-none placeholder:text-muted-foreground transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
          </div>

          {/* 密码 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="pda-password">
              登录密码
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-muted-foreground">
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
                className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-12 text-foreground outline-none placeholder:text-muted-foreground transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
              <button
                type="button"
                tabIndex={-1}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="pda-remember-password"
              type="checkbox"
              checked={rememberPassword}
              onChange={(e) => setRememberPassword(e.target.checked)}
              disabled={isPending}
              className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary"
            />
            <label htmlFor="pda-remember-password" className="text-sm text-muted-foreground">
              在本机记住密码
            </label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            退出或关闭应用后需重新登录；勾选则保存密码便于下次填写。
          </p>

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
    </div>
  )
}
