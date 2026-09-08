import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Eye, EyeOff, ArrowRight, ClipboardList, PackageCheck, ReceiptText, LoaderCircle, LockKeyhole, CircleAlert } from 'lucide-react'
import { useLogin } from '@/hooks/useAuth'
import SystemBrand from '@/components/shared/SystemBrand'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { loadSavedLoginForm } from '@/lib/loginCredentials'
import './login.css'

export default function LoginPage() {
  const location = useLocation()
  // 落地页能力卡片 → 未登录被 ErpProtectedRoute 拦截后带 state.from；登录成功后回到该页
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
  const { mutate: login, isPending, error } = useLogin(from || '/dashboard')

  const [username, setUsername] = useState(() => loadSavedLoginForm().username)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isPending || !username.trim() || !password.trim()) return

    // API 根地址由构建期 VITE_ERP_PRODUCTION_ORIGIN、启动时 bootstrap、本机已存配置决定，无需在登录页填写
    applyErpApiBaseFromStorage()
    login({ username, password })
  }

  return (
    <main className="erp-login">
      <aside className="erp-login-story" aria-labelledby="login-story-title">
        <div className="erp-login-brand">
          <SystemBrand boxClassName="size-11 rounded-xl" />
          <span>极序 <b>Flow</b></span>
        </div>

        <div className="erp-login-story-content">
          <p className="erp-login-story-label">仓储与经营协同</p>
          <h2 id="login-story-title">业务有序，<br /><span>经营有数。</span></h2>
          <p className="erp-login-story-description">
            从一张订单开始，<br />让货物、进度与账款清晰衔接。
          </p>

          <div className="erp-login-flow" role="group" aria-label="订单、仓储与账款协同">
            <div><ClipboardList aria-hidden="true" /><span>订单</span><small>采购与销售</small></div>
            <ArrowRight className="erp-login-flow-arrow" aria-hidden="true" />
            <div><PackageCheck aria-hidden="true" /><span>仓储</span><small>入库与出库</small></div>
            <ArrowRight className="erp-login-flow-arrow" aria-hidden="true" />
            <div><ReceiptText aria-hidden="true" /><span>账款</span><small>对账与核销</small></div>
          </div>
        </div>

        <p className="erp-login-story-footer">每一步业务，都有据可查。</p>
      </aside>

      <section className="erp-login-workspace" aria-labelledby="login-title">
        <div className="erp-login-mobile-brand">
          <SystemBrand boxClassName="size-10 rounded-xl" />
          <span>极序 <b>Flow</b></span>
        </div>
        <div className="erp-login-panel">
          <header className="erp-login-heading">
            <h1 id="login-title">登录工作区</h1>
            <p>欢迎回来，继续处理今天的业务。</p>
          </header>

          <form
            className="erp-login-form"
            onSubmit={handleSubmit}
            noValidate
            aria-busy={isPending}
            aria-describedby={error ? 'login-error' : undefined}
          >
            {error && (
              <div id="login-error" role="alert" className="erp-login-error">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                <p>{error.message || '登录失败，请核对账号与密码'}</p>
              </div>
            )}
            <div className="erp-login-field">
              <label htmlFor="username">登录账号</label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={isPending}
                placeholder="输入企业账号"
                className="erp-login-input"
              />
            </div>
            <div className="erp-login-field">
              <label htmlFor="password">登录密码</label>
              <div className="erp-login-password">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isPending}
                  placeholder="输入密码"
                  className="erp-login-input pr-14"
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  aria-controls="password"
                  disabled={isPending}
                  onClick={() => setShowPassword(v => !v)}
                  className="erp-login-password-toggle"
                >
                  {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="erp-login-submit" disabled={isPending || !username.trim() || !password.trim()}>
              {isPending ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              {isPending ? '登录中…' : '登录工作区'}
              {!isPending && <ArrowRight aria-hidden="true" />}
            </Button>
            <p className="erp-login-remember"><LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />仅在本机记住账号，不保存密码。</p>
          </form>

          <div className="erp-login-help">
            <p>需要登录帮助？</p>
            <span>忘记密码或尚未开通账号，请联系企业管理员。</span>
          </div>
        </div>
        <p className="erp-login-workspace-footer">极序 Flow · 企业工作台</p>
      </section>
    </main>
  )
}
