import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { getRoleWorkbenchApi } from '@/api/reports'
import { getNotificationsApi, type NotificationItem } from '@/api/notifications'
import { getNotificationCategoryLabel, getReminderNotifications } from '@/lib/notifications'

function SummaryCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone: 'blue' | 'amber' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'amber'
    ? 'border-amber-200 bg-amber-50'
    : tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'rose'
        ? 'border-rose-200 bg-rose-50'
        : 'border-blue-200 bg-blue-50'
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function PriorityBanner({
  title,
  description,
  count,
  sectionTitle,
  badge,
  actionLabel,
  onOpen,
}: {
  title: string
  description: string
  count: number
  sectionTitle: string
  badge: string
  actionLabel: string
  onOpen: () => void
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-100 text-slate-700">
              {badge}
            </Badge>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">当前最优先处理</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <p className="mt-2 text-xs text-muted-foreground">来源：{sectionTitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">待处理数</p>
            <p className="text-3xl font-bold tabular-nums text-slate-700">{count}</p>
          </div>
          <Button variant="outline" onClick={onOpen}>{actionLabel}</Button>
        </div>
      </div>
    </section>
  )
}

function getReminderTone(item: NotificationItem) {
  if (item.type === 'danger') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (item.type === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

export default function ApprovalsPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)

  const notificationsQ = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => getNotificationsApi().then(r => r.data.data!),
    refetchInterval: 60_000,
  })

  const workbenchQ = useQuery({
    queryKey: ['approvals-workbench'],
    queryFn: () => getRoleWorkbenchApi().then(r => r.data.data!),
    refetchInterval: 60_000,
  })

  const notificationsError = notificationsQ.isError && !notificationsQ.data
  const workbenchError = workbenchQ.isError && !workbenchQ.data
  const notificationItems = notificationsQ.data?.items ?? []
  const reminderItems = useMemo(() => getReminderNotifications(notificationItems), [notificationItems])
  const managementCards = useMemo(() => {
    const section = workbenchQ.data?.sections.find(item => item.key === 'management')
    return section?.cards ?? []
  }, [workbenchQ.data])
  const topReminder = reminderItems[0] ?? null
  const topApprovalCard = managementCards[0] ?? null

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="审批与提醒基础版"
        description="先把收货审核、异常任务和系统提醒统一聚合，避免分散在多个入口。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openPath('/reports/role-workbench', '岗位工作台')}>打开岗位工作台</Button>
            <Button variant="outline" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>打开异常工作台</Button>
            <Button variant="outline" onClick={() => openPath('/payments', '应付/应收账款')}>打开账款中心</Button>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="待提醒总数" value={reminderItems.length ?? 0} hint="仅保留财务与系统提醒" tone="blue" />
        <SummaryCard label="待审核收货单" value={managementCards.find(card => card.key === 'management-audit')?.count ?? 0} hint="需要管理审核的收货单" tone="emerald" />
        <SummaryCard label="异常任务" value={managementCards.find(card => card.key === 'management-anomaly-task')?.count ?? 0} hint="销售/仓库高风险巡检项" tone="amber" />
        <SummaryCard label="库存异常" value={managementCards.find(card => card.key === 'management-stock')?.count ?? 0} hint="负库存与可用库存风险" tone="rose" />
      </div>

      <FocusModePanel
        badge="入口分工"
        title="审批与提醒只保留财务与系统级事项"
        description="操作型待办留给岗位工作台，审批与提醒页专注管理角色需要快速扫一轮的风险、账款和系统提醒。"
        summary={`当前提醒 ${reminderItems.length} 条，审批待办 ${managementCards.reduce((sum, card) => sum + card.count, 0)} 项`}
        steps={[
          '先处理财务与系统提醒',
          '再看管理审批待办',
          '操作型事项回到岗位工作台',
        ]}
        actions={[
          { label: '打开岗位工作台', onClick: () => openPath('/reports/role-workbench', '岗位工作台') },
          { label: '打开异常工作台', onClick: () => openPath('/reports/exception-workbench', '异常工作台') },
          { label: '打开账款中心', onClick: () => openPath('/payments', '应付/应收账款') },
        ]}
      />

      {topReminder ? (
        <PriorityBanner
          title={topReminder.text}
          description="审批与提醒页顶部优先展示财务与系统级事项，避免与岗位工作台的操作型待办重复。"
          count={reminderItems.length}
          sectionTitle={`${getNotificationCategoryLabel(topReminder.category)}提醒`}
          badge={topReminder.icon}
          actionLabel="打开提醒"
          onOpen={() => openPath(topReminder.path, topReminder.text)}
        />
      ) : topApprovalCard ? (
        <PriorityBanner
          title={topApprovalCard.title}
          description={topApprovalCard.description}
          count={topApprovalCard.count}
          sectionTitle="管理审批待办"
          badge={topApprovalCard.priorityLabel}
          actionLabel={topApprovalCard.actionLabel}
          onOpen={() => openPath(topApprovalCard.path, topApprovalCard.title)}
        />
      ) : null}

      {(notificationsError || workbenchError) && (
        <QueryErrorState
          error={notificationsQ.error || workbenchQ.error}
          onRetry={() => {
            void notificationsQ.refetch()
            void workbenchQ.refetch()
          }}
          title="审批与提醒加载失败"
          description="部分待办或提醒暂时无法加载，请点击重试或稍后再试"
          compact
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">审批待办</h2>
              <p className="text-muted-body">目前先聚焦收货审核与高风险经营问题。</p>
            </div>
            <Badge variant="outline">{managementCards.reduce((sum, card) => sum + card.count, 0)} 项</Badge>
          </div>
          <div className="space-y-3">
            {managementCards.map(card => (
              <button
                key={card.key}
                type="button"
                onClick={() => openPath(card.path, card.title)}
                className="w-full rounded-xl border border-border/70 bg-white/80 px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{card.title}</p>
                      <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] leading-4">{card.count}</Badge>
                      <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] leading-4">{card.priorityLabel}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{card.actionLabel}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">提醒事项</h2>
              <p className="text-muted-body">仅展示财务和系统级提醒，避免与岗位工作台重复。</p>
            </div>
            <Badge variant="outline">{reminderItems.length} 项</Badge>
          </div>
          <div className="space-y-2">
            {reminderItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
                暂无待提醒事项
              </div>
            ) : (
              reminderItems.map((item: NotificationItem, index) => (
                <button
                  key={`${item.path}-${index}`}
                  type="button"
                  onClick={() => openPath(item.path, item.text)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors hover:opacity-90 ${getReminderTone(item)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 shrink-0 text-base">{item.icon}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.text}</p>
                        <p className="mt-1 text-xs opacity-80">{getNotificationCategoryLabel(item.category)}提醒</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 border-current/20 bg-white/70">
                      P{item.priority ?? 9}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
