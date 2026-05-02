import { useNavigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ForbiddenPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
            <ShieldOff className="h-8 w-8 text-warning" />
          </div>
        </div>

        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">403</p>
        <h1 className="mb-3 text-4xl font-bold text-foreground">无访问权限</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          你没有访问这个页面的权限，<br />
          请联系管理员开通。
        </p>

        <div className="flex justify-center gap-3">
          <Button onClick={() => navigate('/dashboard')}>
            回到仪表盘
          </Button>
        </div>
      </div>
    </div>
  )
}
