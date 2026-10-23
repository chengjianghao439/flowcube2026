import { LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { performSessionLogout } from '@/lib/authSession'

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-8 text-center" aria-labelledby="no-access-title">
        <LockKeyhole className="mx-auto mb-6 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 id="no-access-title" className="mb-6 text-xl font-semibold leading-8 text-foreground">
          当前账号没有可用页面，请联系管理员分配权限
        </h1>
        <Button type="button" onClick={performSessionLogout}>退出登录</Button>
      </section>
    </main>
  )
}
