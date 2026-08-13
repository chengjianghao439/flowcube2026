import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, Ban } from 'lucide-react'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaEmptyState from '@/components/pda/PdaEmptyState'
import { usePdaRole, type PdaPerm } from '@/hooks/usePdaRole'

interface PdaRoutePermissionProps {
  title: string
  required: PdaPerm[]
  mode?: 'all' | 'any'
  backTo?: string
  children: ReactNode
}

export default function PdaRoutePermission({
  title,
  required,
  mode = 'all',
  backTo = '/pda',
  children,
}: PdaRoutePermissionProps) {
  const navigate = useNavigate()
  const { permissionsMissing, canAll, canAny } = usePdaRole()

  if (permissionsMissing) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title={title} onBack={() => navigate(backTo)} />
        <PdaEmptyState
          icon={<ShieldAlert className="h-12 w-12 text-amber-500" />}
          title="PDA 权限未加载"
          description="当前账号没有收到可用权限信息，系统已切换为受限模式。请重新登录；若问题仍然存在，请联系管理员检查账号权限。"
          actionText="返回工作台"
          onAction={() => navigate('/pda')}
        />
      </div>
    )
  }

  const allowed = mode === 'all' ? canAll(required) : canAny(required)
  if (!allowed) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title={title} onBack={() => navigate(backTo)} />
        <PdaEmptyState
          icon={<Ban className="h-12 w-12 text-red-500" />}
          title="当前账号无权访问"
          description="当前账号缺少本页面所需权限，请联系管理员分配。页面入口是否显示与实际权限校验无关。"
          actionText="返回工作台"
          onAction={() => navigate('/pda')}
        />
      </div>
    )
  }

  return <>{children}</>
}
