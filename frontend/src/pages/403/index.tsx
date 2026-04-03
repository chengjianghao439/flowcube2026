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

        <h1 className="mb-2 text-4xl font-bold text-foreground">403</h1>
        <h2 className="mb-3 text-lg font-semibold text-foreground">无访问权限</h2>
        <p className="mb-8 text-sm text-muted-foreground">
          您没有权限访问此页面。<br />
          如需开通权限，请联系系统管理员。
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
