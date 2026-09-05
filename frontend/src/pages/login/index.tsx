import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { useLogin } from '@/hooks/useAuth'
import SystemBrand from '@/components/shared/SystemBrand'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { loadSavedLoginForm } from '@/lib/loginCredentials'

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
    if (!username.trim() || !password.trim()) return

    // API 根地址由构建期 VITE_ERP_PRODUCTION_ORIGIN、启动时 bootstrap、本机已存配置决定，无需在登录页填写
    applyErpApiBaseFromStorage()
    login({ username, password })
  }

  return (
    <main className="grid min-h-screen bg-background text-foreground lg:grid-cols-[1fr_1fr]">
      <aside className="hidden flex-col justify-between border-r border-border bg-muted/30 p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3"><SystemBrand boxClassName="h-10 w-10 rounded-lg" iconClassName="size-6" /><span className="text-xl font-semibold">极序 Flow</span></div>
        <div className="max-w-lg space-y-8 py-12">
          <div><p className="mb-4 text-sm text-muted-foreground">ERP · 仓储与经营协同</p><h2 className="text-4xl font-semibold leading-tight">从订单到出库，<br />每一步都有据可查。</h2></div>
          <dl className="divide-y divide-border border-y border-border">
            {[['订单与履约', '采购到货、销售占库和分批发货'], ['库存与仓储', '条码追溯、库位管理和 PDA 作业'], ['账款与经营', '应收应付、对账核销和经营报表']].map(([title, detail]) => <div key={title} className="grid grid-cols-[120px_1fr] gap-4 py-5"><dt className="font-medium">{title}</dt><dd className="text-sm leading-6 text-muted-foreground">{detail}</dd></div>)}
          </dl>
        </div>
        <p className="text-sm text-muted-foreground">使用企业分配的账号进入工作区。</p>
      </aside>
      <section className="flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><SystemBrand boxClassName="h-9 w-9 rounded-lg" iconClassName="size-5" /><span className="text-xl font-semibold">极序 Flow</span></div>
          <h1 className="text-2xl font-semibold">登录工作区</h1>
          <p className="mb-8 mt-3 text-sm leading-6 text-muted-foreground">输入账号与密码，继续处理今天的业务。</p>
          {error && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error.message || '登录失败，请核对账号与密码'}</p>}
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2"><label htmlFor="username" className="text-sm font-medium">登录账号</label><Input id="username" name="username" autoComplete="username" autoFocus value={username} onChange={e => setUsername(e.target.value)} disabled={isPending} placeholder="企业账号" className="h-11" /></div>
            <div className="space-y-2"><label htmlFor="password" className="text-sm font-medium">登录密码</label><div className="relative"><Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={isPending} placeholder="输入密码" className="h-11 pr-12" /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)} className="absolute right-1 top-1 rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div></div>
            <p className="text-sm leading-6 text-muted-foreground">忘记密码或尚未开通账号，请联系企业管理员。</p>
            <Button type="submit" className="h-11 w-full" disabled={isPending || !username.trim() || !password.trim()}>{isPending ? '登录中…' : '登录工作区'}<ArrowRight className="ml-2 size-4" /></Button>
            <p className="text-xs leading-5 text-muted-foreground">仅在本机记住账号，不保存密码。</p>
          </form>
        </div>
      </section>
    </main>
  )
}
