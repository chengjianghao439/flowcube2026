/**
 * PDA 工作台
 * 路由：/pda
 *
 * 入口分两级：
 * - 常用（被下达任务）：大图标卡片直点进入
 * - 更多（自主操作）：收进底部「更多功能」折叠区
 *
 * 图标统一用 lucide（不用 emoji）。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Inbox, ArrowUpFromLine, ClipboardList, Shuffle,
  ClipboardCheck, Package, Scissors, ScanSearch, Truck, ArrowLeftRight,
  Undo2, PackageX, PencilLine, Smartphone, ShieldAlert, Ban, MoreHorizontal, ChevronDown,
  Search, type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { usePdaRole } from '@/hooks/usePdaRole'
import { usePdaTodoCounts } from '@/hooks/usePdaTodoCounts'
import type { PdaPerm } from '@/hooks/usePdaRole'
import type { PdaTodoCounts } from '@/api/pda'
import { PdaEmptyCard } from '@/components/pda/PdaEmptyState'
import BrandLogo from '@/components/shared/BrandLogo'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getDeviceCredential, getDeviceSession } from '@/lib/pdaDeviceBinding'

type OpTone = 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'red' | 'indigo' | 'cyan'

const TONE_STYLES: Record<OpTone, { iconBg: string; iconColor: string }> = {
  blue:   { iconBg: 'bg-blue-50',   iconColor: 'text-blue-600' },
  green:  { iconBg: 'bg-green-50',  iconColor: 'text-green-600' },
  orange: { iconBg: 'bg-orange-50', iconColor: 'text-orange-600' },
  purple: { iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
  teal:   { iconBg: 'bg-teal-50',   iconColor: 'text-teal-600' },
  red:    { iconBg: 'bg-red-50',    iconColor: 'text-red-600' },
  indigo: { iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600' },
  cyan:   { iconBg: 'bg-cyan-50',   iconColor: 'text-cyan-600' },
}

// ── 作业入口（带权限过滤）────────────────────────────────────────────────────
// perms：可空数组。有值 = 需同时具备（canAll，与路由树 required 的 AND 语义一致）；
// 无值 = 单个 perm 判断。分拣作业实际权限是 SORTING_BIN_VIEW + WAREHOUSE_TASK_SORT。
// more: true 表示收进底部「更多功能」（自主操作类）。
interface OpEntry {
  icon: LucideIcon
  label: string
  path: string
  perm: PdaPerm
  perms?: PdaPerm[]
  tone: OpTone
  more?: boolean
}

const ALL_OPS: OpEntry[] = [
  // ── 常用（被下达任务，首页直点） ──
  { icon: Inbox,           label: '收货订单', path: '/pda/inbound',       perm: PERMISSIONS.INBOUND_ORDER_VIEW, tone: 'blue' },
  { icon: ArrowUpFromLine, label: '扫码上架', path: '/pda/putaway',       perm: PERMISSIONS.INBOUND_PUTAWAY_EXECUTE, tone: 'teal' },
  { icon: ClipboardList,   label: '拣货任务', path: '/pda/picking',       perm: PERMISSIONS.WAREHOUSE_TASK_PICK, tone: 'indigo' },
  { icon: Shuffle,         label: '订单分拣', path: '/pda/sort',          perm: PERMISSIONS.SORTING_BIN_VIEW, perms: [PERMISSIONS.SORTING_BIN_VIEW, PERMISSIONS.WAREHOUSE_TASK_SORT], tone: 'orange' },
  { icon: ClipboardCheck,  label: '复核任务', path: '/pda/check',         perm: PERMISSIONS.WAREHOUSE_TASK_CHECK, tone: 'green' },
  { icon: Package,         label: '打包作业', path: '/pda/pack',          perm: PERMISSIONS.WAREHOUSE_TASK_PACK, tone: 'blue' },
  { icon: ScanSearch,      label: '扫码盘点', path: '/pda/stockcheck',    perm: PERMISSIONS.STOCKCHECK_VIEW, tone: 'cyan' },
  { icon: Truck,           label: '出库确认', path: '/pda/ship',          perm: PERMISSIONS.WAREHOUSE_TASK_SHIP, tone: 'orange' },
  { icon: ArrowLeftRight,  label: '调拨执行', path: '/pda/transfer',      perm: PERMISSIONS.TRANSFER_ORDER_VIEW, tone: 'purple' },
  { icon: Undo2,           label: '销售退货', path: '/pda/sale-return',   perm: PERMISSIONS.RETURN_ORDER_VIEW, tone: 'teal' },
  { icon: PackageX,        label: '拣货退回', path: '/pda/cancel-return', perm: PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN_VIEW, tone: 'red' },
  { icon: PencilLine,      label: '改单确认', path: '/pda/adjustments',   perm: PERMISSIONS.WAREHOUSE_TASK_ADJUST_VIEW, tone: 'indigo' },
  // ── 更多（自主操作，收进底部折叠区） ──
  { icon: Scissors,        label: '塑料盒拆分', path: '/pda/split',        perm: PERMISSIONS.INVENTORY_CONTAINER_SPLIT, tone: 'cyan', more: true },
  { icon: Search,          label: '库存查询',   path: '/pda/inventory-query', perm: PERMISSIONS.INVENTORY_VIEW, tone: 'teal', more: true },
]

/** 作业入口 path → todo-counts 计数 key。无可数待办的作业不映射（上架/分拣/拆分等扫码执行入口） */
const OP_TODO_KEY: Partial<Record<string, keyof PdaTodoCounts>> = {
  '/pda/inbound':       'inbound',
  '/pda/picking':       'picking',
  '/pda/check':         'checking',
  '/pda/pack':          'packing',
  '/pda/stockcheck':    'stockcheck',
  '/pda/ship':          'shipping',
  '/pda/transfer':      'transfer',
  '/pda/sale-return':   'saleReturn',
  '/pda/cancel-return': 'cancelReturn',
  '/pda/adjustments':   'adjustments',
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function PdaWorkbench() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const logout   = useAuthStore(s => s.logout)
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const { roleLabel, roleColor, can, canAll, permissionsMissing } = usePdaRole()
  const [moreOpen, setMoreOpen] = useState(false)
  // 作业待办通知：按设备绑定仓库聚合各作业待办数，30s 轮询
  const { data: todoCounts } = usePdaTodoCounts()

  // 绑定状态在渲染时读一次即可：绑定/解绑都会离开本页再回来，回来时组件重新挂载
  const deviceCredential = getDeviceCredential()
  const deviceBound = !!deviceCredential
  const deviceCode = deviceCredential?.deviceCode ?? ''
  const sessionReady = !!getDeviceSession()

  const allowedOps = ALL_OPS.filter(op => op.perms ? canAll(op.perms) : can(op.perm))
  const commonOps = allowedOps.filter(op => !op.more)
  const moreOps = allowedOps.filter(op => op.more)

  // 有权限且可数的作业待办列表（供顶部汇总条展示）
  const todoItems = allowedOps
    .map(op => ({ op, key: OP_TODO_KEY[op.path] as keyof PdaTodoCounts | undefined }))
    .filter((x): x is { op: (typeof allowedOps)[number]; key: keyof PdaTodoCounts } => !!x.key)
    .map(x => ({ ...x, count: todoCounts?.[x.key] ?? 0 }))
    .filter(x => x.count > 0)
  const totalTodo = todoItems.reduce((s, i) => s + i.count, 0)

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-4 pt-4 pb-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {/* 公司 Logo（上传后替换，无 Logo 回退纯文字） */}
              <BrandLogo hideFallbackIcon imgClassName="h-4 max-w-20" alt="极序 Flow" />
              <p className="truncate text-xs font-mono text-muted-foreground tracking-wider uppercase">极序 Flow</p>
            </div>
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
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${roleColor}`}>{roleLabel}</span>
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
              <Smartphone className="h-5 w-5" />本机尚未绑定设备
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              未绑定的机器无法执行任何作业。点击此处扫描管理员提供的绑定二维码。
            </p>
          </button>
        ) : !sessionReady ? (
          <button
            type="button"
            onClick={() => navigate('/pda/bind')}
            className="mb-4 w-full rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-left active:scale-95 transition-all"
          >
            <p className="text-sm font-medium text-amber-600">设备凭证需要刷新</p>
            <p className="mt-0.5 text-xs text-muted-foreground">重新登录即可自动恢复；若仍未恢复，点击此处检查绑定状态。</p>
          </button>
        ) : null}

        {/* 作业待办汇总条：有可数待办且当前账号有权限时显示，点击直接进入对应作业 */}
        {totalTodo > 0 && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">待办任务</p>
              <span className="text-xs font-semibold text-destructive tabular-nums">{totalTodo} 项</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {todoItems.map(({ op, count }) => (
                <button
                  key={op.path}
                  type="button"
                  onClick={() => navigate(op.path)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground active:scale-95 transition-all"
                >
                  <span className="font-medium">{op.label}</span>
                  <span className="font-bold text-destructive tabular-nums">{count > 99 ? '99+' : count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground mb-3">{roleLabel} 可用作业（{allowedOps.length} 项）</p>
          {permissionsMissing ? (
            <PdaEmptyCard
              icon={<ShieldAlert className="h-12 w-12 text-amber-500" />}
              title="权限未加载，PDA 已切换至受限模式"
              description="未获取到权限信息，PDA 部分功能不可用。请重新登录；若仍异常，请联系管理员。"
              actionText="重新登录"
              onAction={() => { logout(); navigate('/pda/login') }}
            />
          ) : allowedOps.length === 0 ? (
            <PdaEmptyCard
              icon={<Ban className="h-12 w-12 text-red-500" />}
              title="当前账号没有可用 PDA 作业权限"
              description="当前账号没有收货、拣货、分拣、复核、打包、出库等操作权限。请联系管理员分配权限。"
            />
          ) : (
            <>
              {/* 常用：大图标卡片直点 */}
              <div className="grid grid-cols-3 gap-3">
                {commonOps.map(op => {
                  const Icon = op.icon
                  const tone = TONE_STYLES[op.tone]
                  const count = OP_TODO_KEY[op.path] ? todoCounts?.[OP_TODO_KEY[op.path] as keyof PdaTodoCounts] ?? 0 : 0
                  return (
                    <button key={op.path} onClick={() => navigate(op.path)}
                      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 active:scale-95 transition-all">
                      <span className={`relative flex h-12 w-12 items-center justify-center rounded-xl ${tone.iconBg}`}>
                        <Icon className={`h-6 w-6 ${tone.iconColor}`} />
                        {count > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white tabular-nums">
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </span>
                      <p className="text-sm font-medium text-foreground text-center leading-tight">{op.label}</p>
                    </button>
                  )
                })}
              </div>

              {/* 更多（自主操作）：收进折叠区 */}
              {moreOps.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setMoreOpen(v => !v)}
                    className="flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground active:scale-95 transition-all"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    更多功能
                    <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {moreOpen && (
                    <div className="mt-2 grid grid-cols-3 gap-3">
                      {moreOps.map(op => {
                        const Icon = op.icon
                        const tone = TONE_STYLES[op.tone]
                        const count = OP_TODO_KEY[op.path] ? todoCounts?.[OP_TODO_KEY[op.path] as keyof PdaTodoCounts] ?? 0 : 0
                        return (
                          <button key={op.path} onClick={() => navigate(op.path)}
                            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 active:scale-95 transition-all">
                            <span className={`relative flex h-12 w-12 items-center justify-center rounded-xl ${tone.iconBg}`}>
                              <Icon className={`h-6 w-6 ${tone.iconColor}`} />
                              {count > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white tabular-nums">
                                  {count > 99 ? '99+' : count}
                                </span>
                              )}
                            </span>
                            <p className="text-sm font-medium text-foreground text-center leading-tight">{op.label}</p>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {/* 已绑定时入口收到底部：日常不打扰，换机/解绑时还找得到 */}
          {deviceBound && (
            <button
              type="button"
              onClick={() => navigate('/pda/bind')}
              className="mt-4 flex w-full items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-muted-foreground active:scale-95 transition-all"
            >
              <Smartphone className="h-4 w-4" />
              设备绑定：{deviceCode}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
