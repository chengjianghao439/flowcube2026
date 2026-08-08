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
import { PdaEmptyCard } from '@/components/pda/PdaEmptyState'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getDeviceCredential, getDeviceSession } from '@/lib/pdaDeviceBinding'

// ── 作业入口（带权限过滤）────────────────────────────────────────────────────
const ALL_OPS: { icon: string; label: string; path: string; perm: PdaPerm }[] = [
  { icon: '📥', label: '收货订单', path: '/pda/inbound',  perm: PERMISSIONS.INBOUND_ORDER_VIEW },
  { icon: '🔬', label: '来料质检', path: '/pda/inbound-qa', perm: PERMISSIONS.INBOUND_RECEIVE_EXECUTE },
  { icon: '🗑️', label: '拒收处置', path: '/pda/qa-dispose', perm: PERMISSIONS.INBOUND_QA_DISPOSE },
  { icon: '📤', label: '扫码上架', path: '/pda/putaway',  perm: PERMISSIONS.INBOUND_PUTAWAY_EXECUTE },
  { icon: '🗂️', label: '拣货任务', path: '/pda/picking',  perm: PERMISSIONS.WAREHOUSE_TASK_PICK },
  { icon: '🔀', label: '订单分拣', path: '/pda/sort',      perm: PERMISSIONS.SORTING_BIN_MANAGE },
  { icon: '✅', label: '复核任务', path: '/pda/check',     perm: PERMISSIONS.WAREHOUSE_TASK_CHECK },
  { icon: '📦', label: '打包作业', path: '/pda/pack',      perm: PERMISSIONS.WAREHOUSE_TASK_PACK },
  { icon: '✂️', label: '容器拆分', path: '/pda/split',     perm: PERMISSIONS.INVENTORY_CONTAINER_SPLIT },
  { icon: '🚚', label: '出库确认', path: '/pda/ship',      perm: PERMISSIONS.WAREHOUSE_TASK_SHIP },
  { icon: '🔁', label: '调拨执行', path: '/pda/transfer',  perm: PERMISSIONS.TRANSFER_ORDER_VIEW },
  { icon: '↩️', label: '销售退货', path: '/pda/sale-return', perm: PERMISSIONS.RETURN_ORDER_VIEW },
  { icon: '🧯', label: '取消清理', path: '/pda/cancel-return', perm: PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN_VIEW },
  { icon: '✏️', label: '改单确认', path: '/pda/adjustments', perm: PERMISSIONS.WAREHOUSE_TASK_ADJUST_VIEW },
]

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function PdaWorkbench() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const logout   = useAuthStore(s => s.logout)
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const { roleLabel, roleIcon, roleColor, can, permissionsMissing } = usePdaRole()

  // 绑定状态在渲染时读一次即可：绑定/解绑都会离开本页再回来，回来时组件重新挂载
  const deviceCredential = getDeviceCredential()
  const deviceBound = !!deviceCredential
  const deviceCode = deviceCredential?.deviceCode ?? ''
  const sessionReady = !!getDeviceSession()

  const allowedOps = ALL_OPS.filter(op => can(op.perm))

  return (
    <div className="min-h-screen bg-background">
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
            {formatDisplayDateTime(new Date())}
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4">
        {/* 设备绑定状态。设备会话是硬性要求，未绑定的机器点任何作业都会被拒，
            所以这块必须显眼且常驻——否则员工只会看到一堆点不动的按钮，
            却找不到「哪里能绑定」。 */}
        {!deviceBound ? (
          <button
            type="button"
            onClick={() => navigate('/pda/bind')}
            className="mb-4 w-full rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 text-left active:scale-95 transition-all"
          >
            <div className="flex items-center gap-2 text-base font-semibold text-destructive">
              <span className="text-xl">📱</span>本机尚未绑定设备
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              未绑定的机器无法执行任何作业。点这里扫管理员提供的绑定二维码。
            </p>
          </button>
        ) : !sessionReady ? (
          <button
            type="button"
            onClick={() => navigate('/pda/bind')}
            className="mb-4 w-full rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-left active:scale-95 transition-all"
          >
            <p className="text-sm font-medium text-amber-600">设备凭证需要刷新</p>
            <p className="mt-0.5 text-xs text-muted-foreground">重新登录即可自动恢复；若仍不行，点这里检查绑定状态。</p>
          </button>
        ) : null}

        <div>
          <p className="text-xs text-muted-foreground mb-3">{roleIcon} {roleLabel} 可用作业（{allowedOps.length} 项）</p>
          {permissionsMissing ? (
            <PdaEmptyCard
              icon="🔐"
              title="权限未加载，PDA 已切到受限模式"
              description="未获取到权限信息，PDA 部分功能不可用。请重新登录；若仍异常，请联系管理员。"
              actionText="重新登录"
              onAction={() => { logout(); navigate('/pda/login') }}
            />
          ) : allowedOps.length === 0 ? (
            <PdaEmptyCard
              icon="⛔"
              title="当前账号没有可用 PDA 作业权限"
              description="当前账号没有收货、拣货、分拣、复核、打包、出库等操作权限。请联系管理员分配权限。"
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
          {/* 已绑定时入口收到底部：日常不打扰，换机/解绑时还找得到 */}
          {deviceBound && (
            <button
              type="button"
              onClick={() => navigate('/pda/bind')}
              className="mt-4 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-muted-foreground active:scale-95 transition-all"
            >
              📱 设备绑定：{deviceCode}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
