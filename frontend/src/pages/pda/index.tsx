/**
 * PDA 工作台
 * 路由：/pda
 *
 * 当前仅保留作业入口，不再聚合展示「我的任务」。
 */
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { usePdaRole } from '@/hooks/usePdaRole'
import type { PdaPerm } from '@/hooks/usePdaRole'
import { usePdaOnboarding } from '@/hooks/usePdaOnboarding'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import { PdaEmptyCard } from '@/components/pda/PdaEmptyState'
import { PERMISSIONS } from '@/lib/permission-codes'

// ── 作业入口（带权限过滤）────────────────────────────────────────────────────
const ALL_OPS: { icon: string; label: string; path: string; perm: PdaPerm }[] = [
  { icon: '📥', label: '收货订单', path: '/pda/inbound',  perm: PERMISSIONS.INBOUND_ORDER_VIEW },
  { icon: '📤', label: '扫码上架', path: '/pda/putaway',  perm: PERMISSIONS.INBOUND_PUTAWAY_EXECUTE },
  { icon: '🗂️', label: '拣货任务', path: '/pda/picking',  perm: PERMISSIONS.WAREHOUSE_TASK_PICK },
  { icon: '🔀', label: '订单分拣', path: '/pda/sort',      perm: PERMISSIONS.SORTING_BIN_MANAGE },
  { icon: '✅', label: '复核任务', path: '/pda/check',     perm: PERMISSIONS.WAREHOUSE_TASK_CHECK },
  { icon: '📦', label: '打包作业', path: '/pda/pack',      perm: PERMISSIONS.WAREHOUSE_TASK_PACK },
  { icon: '✂️', label: '容器拆分', path: '/pda/split',     perm: PERMISSIONS.INVENTORY_CONTAINER_SPLIT },
  { icon: '🚚', label: '出库确认', path: '/pda/ship',      perm: PERMISSIONS.WAREHOUSE_TASK_SHIP },
]

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function PdaWorkbench() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const logout   = useAuthStore(s => s.logout)
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const { roleLabel, roleIcon, roleColor, can, permissionsMissing } = usePdaRole()
  const { OnboardingGate } = usePdaOnboarding()

  const allowedOps = ALL_OPS.filter(op => can(op.perm))

  return (
    <div className="min-h-screen bg-background">
      <OnboardingGate />
      <div className="border-b border-border bg-card px-4 pt-4 pb-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-mono text-muted-foreground tracking-wider uppercase">极序 Flow</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('pda:check-update'))}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground active:scale-95"
            >
              检查更新
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-foreground">{greeting}，{user?.username ?? '操作员'}</h1>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${roleColor}`}>{roleIcon} {roleLabel}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4">
        <PdaFlowPanel
          badge="现场闭环入口"
          title="PDA 工作台负责把收货、拣货、分拣、复核、打包、出库按主链顺序串起来"
          description="进入具体作业前先判断当前卡在哪个阶段。遇到优先级冲突回岗位工作台，遇到打印或流程异常回异常工作台。"
          nextAction="按主链顺序选择当前作业"
          stepText="收货与上架完成后，再推进拣货、分拣、复核、打包和出库；不要跳过中间状态直接做后续动作。"
          actions={[
            { label: '岗位工作台', onClick: () => navigate('/reports/role-workbench') },
            { label: '异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            { label: '物流补打', onClick: () => navigate('/settings/barcode-print-query?category=logistics&status=failed') },
          ]}
        />

        <div>
          <p className="text-xs text-muted-foreground mb-3">{roleIcon} {roleLabel} 可用作业（{allowedOps.length} 项）</p>
          {permissionsMissing ? (
            <PdaEmptyCard
              icon="🔐"
              title="权限未加载，PDA 已切到受限模式"
              description="当前账号没有收到后端返回的权限信息，因此不会放开任何 PDA 作业入口。请重新登录；若仍异常，请联系管理员检查账号权限。"
              actionText="重新登录"
              onAction={() => { logout(); navigate('/pda/login') }}
            />
          ) : allowedOps.length === 0 ? (
            <PdaEmptyCard
              icon="⛔"
              title="当前账号没有可用 PDA 作业权限"
              description="后端未授予收货、拣货、分拣、复核、打包、出库等 PDA 权限。请联系管理员分配真实权限。"
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {allowedOps.map(op => (
                <button key={op.path} onClick={() => navigate(op.path)}
                  className="flex flex-col items-start rounded-2xl border border-border bg-card p-4 text-left active:scale-95 transition-all">
                  <span className="text-3xl mb-3">{op.icon}</span>
                  <p className="text-base font-medium text-foreground">{op.label}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
