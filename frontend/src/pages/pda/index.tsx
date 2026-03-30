/**
 * PDA 任务驱动工作台
 * 路由：/pda
 *
 * 设计：以「我的任务」为核心，而非功能入口宫格
 *  - 显示所有进行中的任务（按优先级排序）
 *  - 每张任务卡片直接进入对应操作页
 *  - 支持多任务并行显示 + 状态恢复
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { getMyTasksApi } from '@/api/warehouse-tasks'
import { getTasksApi } from '@/api/warehouse-tasks'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import { WT_STATUS, WT_STATUS_NAME, WT_STATUS_CLASS } from '@/constants/warehouseTaskStatus'
import type { MyTask } from '@/api/warehouse-tasks'
import type { InboundTask } from '@/types/inbound-tasks'
import { usePdaRole } from '@/hooks/usePdaRole'
import type { PdaPerm } from '@/hooks/usePdaRole'
import { usePdaOnboarding } from '@/hooks/usePdaOnboarding'

// ── 统一任务类型 ──────────────────────────────────────────────────────────────
interface UnifiedTask {
  id: string
  taskNo: string
  customerName: string
  warehouseName: string
  status: number
  statusLabel: string
  statusClass: string
  priority: number
  progressCurrent: number
  progressTotal: number
  actionLabel: string
  actionPath: string
  icon: string
  requiredPerm: PdaPerm
}

// ── 状态 → 操作路径映射 ───────────────────────────────────────────────────────
const STATUS_TO_ACTION: Record<number, { label: string; path: (id: number) => string; icon: string; perm: PdaPerm }> = {
  [WT_STATUS.PICKING]:  { label: '继续拣货', path: id => `/pda/task/${id}`,         icon: '🗂️', perm: 'pda:picking'  },
  [WT_STATUS.SORTING]:  { label: '开始分拣', path: _id => `/pda/sort`,              icon: '🔀', perm: 'pda:sorting'  },
  [WT_STATUS.CHECKING]: { label: '开始复核', path: id => `/pda/check?taskId=${id}`, icon: '✅', perm: 'pda:checking' },
  [WT_STATUS.PACKING]:  { label: '开始打包', path: _id => `/pda/pack`,              icon: '📦', perm: 'pda:packing'  },
  [WT_STATUS.SHIPPING]: { label: '确认出库', path: _id => `/pda/ship`,              icon: '🚚', perm: 'pda:shipping' },
}

const PRIORITY_DOT: Record<number, string>  = { 1: 'bg-red-500', 2: 'bg-blue-400', 3: 'bg-gray-300' }
const PRIORITY_LABEL: Record<number, string> = { 1: '紧急', 2: '普通', 3: '低' }

// ── 任务卡片 ──────────────────────────────────────────────────────────────────
function TaskCard({ task, onGo }: { task: UnifiedTask; onGo: () => void }) {
  const pct = task.progressTotal > 0
    ? Math.min(100, Math.round(task.progressCurrent / task.progressTotal * 100))
    : 0

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* 优先级色条 */}
      <div className={`h-1 w-full ${PRIORITY_DOT[task.priority]}`} />
      <div className="p-4 space-y-3">
        {/* 头部 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl shrink-0">{task.icon}</span>
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">{task.taskNo}</p>
              <p className="font-semibold text-foreground truncate">{task.customerName}</p>
              <p className="text-xs text-muted-foreground">{task.warehouseName}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${task.statusClass}`}>
              {task.statusLabel}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${PRIORITY_DOT[task.priority]}`}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          </div>
        </div>

        {/* 进度条 */}
        {task.progressTotal > 0 && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>进度</span>
              <span>{task.progressCurrent.toFixed(0)} / {task.progressTotal.toFixed(0)} ({pct}%)</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full transition-all"
                style={{ width: `${pct}%`, background: pct >= 100 ? 'hsl(var(--success))' : 'hsl(var(--primary))' }}
              />
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <button
          onClick={onGo}
          className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground active:scale-95 transition-all"
        >
          {task.actionLabel} →
        </button>
      </div>
    </div>
  )
}

// ── 作业入口（带权限过滤）────────────────────────────────────────────────────
const ALL_OPS: { icon: string; label: string; path: string; perm: PdaPerm }[] = [
  { icon: '📥', label: '收货订单', path: '/pda/inbound',  perm: 'pda:inbound'  },
  { icon: '📤', label: '上架作业', path: '/pda/putaway',  perm: 'pda:putaway'  },
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
  const [tab, setTab] = useState<'tasks' | 'ops'>('tasks')
  const { roleLabel, roleIcon, roleColor, can } = usePdaRole()
  const { OnboardingGate } = usePdaOnboarding()

  const { data: myTasks = [], isLoading: myLoading, refetch } = useQuery({
    queryKey: ['pda-workbench-my'],
    queryFn:  () => getMyTasksApi().then(r => r.data.data ?? []),
    refetchInterval: 30_000,
  })

  const { data: inboundRaw = [], isLoading: inboundLoading } = useQuery({
    queryKey: ['pda-workbench-inbound'],
    queryFn:  () => getInboundTasksApi({ page: 1, pageSize: 20, status: undefined })
      .then(r => (r.data.data?.list ?? []).filter((t: InboundTask) => [1, 2].includes(t.status))),
    refetchInterval: 30_000,
    enabled: can('pda:inbound'),
  })

  const isLoading = myLoading || inboundLoading

  // 按权限过滤任务
  const tasks: UnifiedTask[] = [
    ...myTasks
      .map((t: MyTask): UnifiedTask | null => {
        const action = STATUS_TO_ACTION[t.status]
        if (!action || !can(action.perm)) return null
        return {
          id: `wt-${t.id}`, taskNo: t.taskNo, customerName: t.customerName,
          warehouseName: t.warehouseName, status: t.status,
          statusLabel: WT_STATUS_NAME[t.status as keyof typeof WT_STATUS_NAME] ?? t.statusName,
          statusClass:  WT_STATUS_CLASS[t.status as keyof typeof WT_STATUS_CLASS] ?? '',
          priority: t.priority, progressCurrent: t.totalPicked, progressTotal: t.totalRequired,
          actionLabel: action.label, actionPath: action.path(t.id),
          icon: action.icon, requiredPerm: action.perm,
        }
      })
      .filter((t): t is UnifiedTask => t !== null),
    ...(can('pda:inbound') ? inboundRaw.map((t: InboundTask): UnifiedTask => ({
      id: `ib-${t.id}`, taskNo: t.taskNo,
      customerName: t.supplierName ?? '未知供应商', warehouseName: t.warehouseName ?? '',
      status: t.status, statusLabel: t.status === 1 ? '待收货' : '收货中',
      statusClass: 'bg-teal-100 text-teal-700 border-teal-200',
      priority: 2,
      progressCurrent: t.items?.reduce((s, i) => s + i.receivedQty, 0) ?? 0,
      progressTotal:   t.items?.reduce((s, i) => s + i.orderedQty,  0) ?? 0,
      actionLabel: '开始收货', actionPath: `/pda/receive/${t.id}`,
      icon: '📥', requiredPerm: 'pda:inbound',
    })) : []),
  ].sort((a, b) => a.priority - b.priority)

  const allowedOps = ALL_OPS.filter(op => can(op.perm))

  return (
    <div className="min-h-screen bg-background">
      <OnboardingGate />
      <div className="border-b border-border bg-card px-4 pt-4 pb-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-mono text-muted-foreground tracking-wider uppercase">FlowCube WMS</p>
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

      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="max-w-md mx-auto flex">
          <button onClick={() => setTab('tasks')}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === 'tasks' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'
            }`}>
            我的任务
            {tasks.length > 0 && <span className="ml-2 rounded-full bg-primary text-primary-foreground text-xs px-1.5 py-0.5">{tasks.length}</span>}
          </button>
          <button onClick={() => setTab('ops')}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === 'ops' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'
            }`}>
            作业入口
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4">
        {tab === 'tasks' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{tasks.length} 个进行中任务</p>
              <button onClick={() => refetch()} className="text-xs text-primary active:opacity-60">↻ 刷新</button>
            </div>
            {isLoading && <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}
            {!isLoading && tasks.map(task => <TaskCard key={task.id} task={task} onGo={() => navigate(task.actionPath)} />)}
            {!isLoading && tasks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-16 text-center">
                <p className="text-4xl mb-3">✨</p>
                <p className="font-semibold text-foreground">暂无待处理任务</p>
                <p className="text-sm text-muted-foreground mt-1">可前往「作业入口」领取新任务</p>
                <button onClick={() => setTab('ops')}
                  className="mt-4 rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground active:scale-95">查看作业入口</button>
              </div>
            )}
          </div>
        )}

        {tab === 'ops' && (
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
        )}
      </div>
    </div>
  )
}
