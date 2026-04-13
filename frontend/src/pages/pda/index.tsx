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

// ── 作业入口（带权限过滤）────────────────────────────────────────────────────
const ALL_OPS: { icon: string; label: string; path: string; perm: PdaPerm }[] = [
  { icon: '📥', label: '收货订单', path: '/pda/inbound',  perm: 'pda:inbound'  },
  { icon: '📤', label: '扫码上架', path: '/pda/putaway',  perm: 'pda:putaway'  },
  { icon: '🗂️', label: '拣货任务', path: '/pda/picking',  perm: 'pda:picking'  },
  { icon: '🔀', label: '订单分拣', path: '/pda/sort',      perm: 'pda:sorting'  },
  { icon: '✅', label: '复核任务', path: '/pda/check',     perm: 'pda:checking' },
  { icon: '📦', label: '打包作业', path: '/pda/pack',      perm: 'pda:packing'  },
  { icon: '✂️', label: '容器拆分', path: '/pda/split',     perm: 'pda:split'    },
  { icon: '🚚', label: '出库确认', path: '/pda/ship',      perm: 'pda:shipping' },
]

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function PdaWorkbench() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const { roleLabel, roleIcon, roleColor, can } = usePdaRole()
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
        <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">现场闭环入口</p>
              <p className="mt-1 text-base font-semibold text-foreground">PDA 工作台负责把收货、拣货、分拣、复核、打包、出库按主链顺序串起来</p>
              <p className="mt-1 text-sm text-muted-foreground">进入具体作业前先判断当前卡在哪个阶段。遇到优先级冲突回岗位工作台，遇到打印或流程异常回异常工作台。</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <div className="rounded-xl border border-border bg-background px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">推荐顺序</p>
              <p className="mt-1 text-sm text-foreground">收货与上架完成后，再推进拣货、分拣、复核、打包和出库；不要跳过中间状态直接做后续动作。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('/reports/role-workbench')}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground active:scale-95"
              >
                岗位工作台
              </button>
              <button
                type="button"
                onClick={() => navigate('/reports/exception-workbench')}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground active:scale-95"
              >
                异常工作台
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings/barcode-print-query?category=logistics&status=failed')}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground active:scale-95"
              >
                物流补打
              </button>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-3">{roleIcon} {roleLabel} 可用作业（{allowedOps.length} 项）</p>
          <div className="grid grid-cols-2 gap-3">
            {allowedOps.map(op => (
              <button key={op.path} onClick={() => navigate(op.path)}
                className="flex flex-col items-start rounded-2xl border border-border bg-card p-4 text-left active:scale-95 transition-all">
                <span className="text-3xl mb-3">{op.icon}</span>
                <p className="text-base font-medium text-foreground">{op.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
