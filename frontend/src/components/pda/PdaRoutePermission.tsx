import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, Ban, Smartphone } from 'lucide-react'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaEmptyState from '@/components/pda/PdaEmptyState'
import { usePdaRole, type PdaPerm } from '@/hooks/usePdaRole'
import { getDeviceCredential } from '@/lib/pdaDeviceBinding'

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

  // 设备未绑定：后端 pdaSessionRequired 强制校验，一切作业接口都会 403 PDA_SESSION_REQUIRED。
  // 与其等请求发出后弹全局错误 toast（用户看到「显示错误」），不如在路由层直接拦截成
  // 受限模式引导页——未绑定的机器点任何作业都进不来，不发请求、不弹错误。
  // 与工作台（pages/pda/index.tsx）的「当前 PDA 未绑定设备」卡同语义，入口与页面双层闭环。
  if (!getDeviceCredential()) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title={title} onBack={() => navigate(backTo)} />
        <PdaEmptyState
          icon={<Smartphone className="h-12 w-12 text-amber-500" />}
          title="当前 PDA 未绑定设备"
          description="系统已切换为受限模式。未绑定的机器无法执行任何作业，请先到「设备绑定」页面扫码绑定管理员生成的绑定码。"
          actionText="去绑定设备"
          onAction={() => navigate('/pda/bind')}
        />
      </div>
    )
  }

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
