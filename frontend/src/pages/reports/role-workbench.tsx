import { DailyWork } from '@/components/shared/DailyWork'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import type { RoleWorkbenchData, WorkbenchCard } from '@/api/reports'
import { getNotificationsApi, type NotificationItem } from '@/api/notifications'
import { getNotificationCategoryLabel, getReminderNotifications } from '@/lib/notifications'
import { useRoleWorkbench } from '@/hooks/useDashboard'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { usePermission } from '@/hooks/usePermission'
import { canOpenWorkbenchPath } from '@/lib/workbench'

type Open = (path: string, title: string) => void
type JobSection = RoleWorkbenchData['sections'][number]
type ReadState = {
  data: unknown
  dataUpdatedAt: number
  error: unknown
  isError: boolean
  isFetching: boolean
  isPaused: boolean
  refetch: () => Promise<unknown>
}

const cardUnits: Record<string, string> = {
  'warehouse-pending-receive': '张收货订单',
  'warehouse-putaway': '张库存条码',
  'warehouse-print': '条打印任务',
  'sale-pending-ship': '张销售单',
  'sale-below-cost': '张销售单',
}
const cardFrame = 'rounded-lg border border-border bg-card'

function ReadFeedback({ title, query }: { title: string; query: ReadState }) {
  const retry = () => { void query.refetch() }
  if (query.isPaused) {
    return <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
      网络暂不可用，恢复后继续读取{title}。{query.data ? '当前显示上次读取的内容。' : ''}
    </p>
  }
  if (query.isError && !query.data) {
    return <QueryErrorState error={query.error} onRetry={retry} title={title + '加载失败'} compact />
  }
  if (query.isError) {
    const updatedAt = new Date(query.dataUpdatedAt).toISOString()
    return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-warning-ink">
      <p>{title}刷新失败，当前显示上次读取的内容。上次更新 <time dateTime={updatedAt}>{formatDisplayDateTime(updatedAt)}</time>。</p>
      <Button type="button" size="sm" variant="outline" aria-label={'重试' + title} onClick={retry} disabled={query.isFetching}>重试</Button>
    </div>
  }
  if (query.isFetching) {
    return <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
      {query.data ? '正在更新' : '正在加载'}{title}…
    </p>
  }
  return null
}

function Count({ card }: { card: WorkbenchCard }) {
  return <SoftStatusLabel tone="draft" className="shrink-0 whitespace-nowrap tabular-nums" label={`${card.count} ${cardUnits[card.key] ?? '项待办'}`} />
}

function JobGroup({ section, onOpen }: { section: JobSection; onOpen: Open }) {
  return (
    <section aria-label={section.title} className={cardFrame}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-section-title">{section.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
      </div>
      <div className="divide-y divide-border px-4">
        {section.cards.map(card => (
          <div key={card.key} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{card.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{card.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Count card={card} />
                {!card.items.some(item => item.path === card.path) &&
                  <Button size="sm" variant="outline" onClick={() => onOpen(card.path, card.title)}>{card.actionLabel}</Button>}
              </div>
            </div>
            {card.count > card.items.length && <p className="mt-2 text-xs text-muted-foreground">当前显示 {card.items.length} 条</p>}
            {card.items.length > 0 && (
              <ul className="mt-2 divide-y divide-border/60">
                {card.items.map((item, index) => (
                  // 同一收货单的不同打印任务分别呈现。
                  <li key={`${card.key}-${item.id}-${index}`}>
                    <button
                      type="button"
                      onClick={() => onOpen(item.path, item.title)}
                      className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-words text-sm font-medium text-primary">{item.title}</span>
                          {item.badge && <SoftStatusLabel label={item.badge} tone="info" />}
                        </span>
                        {item.subtitle && <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{item.subtitle}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{item.hint || (item.createdAt ? formatDisplayDateTime(item.createdAt) : '待处理')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function ReminderBlock({ items, query, onOpen }: { items: NotificationItem[]; query: ReadState; onOpen: Open }) {
  return (
    <section aria-label="财务与系统提醒" className={cardFrame}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-section-title">财务与系统提醒</h2>
        {items.length > 0 && <SoftStatusLabel label={`${items.length} 类提醒`} tone="info" />}
      </div>
      <ReadFeedback title="财务与系统提醒" query={query} />
      {items.length === 0 && !!query.data && !query.isError && !query.isPaused && !query.isFetching &&
        <p className="px-4 py-4 text-sm text-muted-foreground">暂无待提醒事项</p>}
      {items.length > 0 && <ul className="divide-y divide-border/60 px-4">
        {items.map(item => (
          <li key={item.dedupeKey}>
            <button
              type="button"
              onClick={() => onOpen(item.path, item.text)}
              className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-2 py-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="min-w-0">
                <span className="block break-words text-sm font-medium text-primary">{item.text}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{getNotificationCategoryLabel(item.category)}提醒</span>
              </span>
              {item.type === 'danger' && <SoftStatusLabel label="优先处理" tone="danger" />}
              {item.type === 'warning' && <SoftStatusLabel label="需关注" tone="warning" />}
            </button>
          </li>
        ))}
      </ul>}
    </section>
  )
}

export default function RoleWorkbenchPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const isActiveTab = useActiveWorkspaceTab()
  const { can } = usePermission()
  const workbench = useRoleWorkbench()
  const notifications = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => getNotificationsApi(),
    enabled: isActiveTab,
    refetchInterval: isActiveTab ? 60_000 : false,
  })

  const sections = [...(workbench.data?.sections ?? [])].sort((a, b) => a.priorityRank - b.priorityRank)
  const activeSections = sections
    .map(section => ({ ...section, cards: section.cards.filter(card => card.count > 0).sort((a, b) => a.priorityRank - b.priorityRank) }))
    .filter(section => section.cards.length > 0)
  const quietCards = sections.flatMap(section =>
    section.cards.filter(card => card.count === 0).map(card => ({ card, sectionTitle: section.title })),
  )
  const reminderItems = getReminderNotifications(notifications.data?.items ?? []).filter(item => canOpenWorkbenchPath(item.path, can))
  const refreshing = workbench.isFetching || notifications.isFetching

  function openPath(path: string, title: string) {
    if (canOpenWorkbenchPath(path, can) && addTab({ key: path, title, path })) navigate(path)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="待办中心"
        description="按岗位查看待办与需要关注的事项。"
        actions={<Button type="button" disabled={!isActiveTab || refreshing} onClick={() => { void workbench.refetch(); void notifications.refetch() }}>{refreshing ? '刷新中…' : '立即刷新'}</Button>}
      />

      <div aria-label="岗位待办" className="space-y-3">
        {(workbench.isError || workbench.isPaused || workbench.isFetching) &&
          <div className={cardFrame}><ReadFeedback title="岗位待办" query={workbench} /></div>}
        {activeSections.map(section => <JobGroup key={section.key} section={section} onOpen={openPath} />)}
        {!activeSections.length && workbench.data && !workbench.isError && !workbench.isPaused && !workbench.isFetching &&
          <p className={cardFrame + ' px-4 py-4 text-sm text-muted-foreground'}>暂无岗位待办</p>}
      </div>

      <ReminderBlock items={reminderItems} query={notifications} onOpen={openPath} />

      {quietCards.length > 0 && (
        <details className={cardFrame}>
          <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">零待办类别（{quietCards.length} 类）</summary>
          <ul className="divide-y divide-border/60 border-t border-border px-4">
            {quietCards.map(({ card, sectionTitle }) => (
              <li key={card.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>{card.title}</strong><span className="ml-2 text-xs text-muted-foreground">{sectionTitle}</span></span>
                <div className="flex flex-wrap items-center gap-2"><Count card={card} /><Button size="sm" variant="outline" onClick={() => openPath(card.path, card.title)}>{card.actionLabel}</Button></div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <DailyWork />
    </div>
  )
}
