import { FulfillmentTodos } from '@/components/shared/FulfillmentTodos'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import type { WorkbenchCard } from '@/api/reports'
import { getNotificationsApi, type NotificationItem } from '@/api/notifications'
import { getNotificationCategoryLabel, getReminderNotifications } from '@/lib/notifications'
import { useRoleWorkbench } from '@/hooks/useDashboard'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatDisplayDateTime } from '@/lib/dateTime'

function getReminderTone(item: NotificationItem) {
  if (item.type === 'danger') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (item.type === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

function SectionList({ cards, onOpen }: { cards: WorkbenchCard[]; onOpen: (path: string, title: string) => void }) {
  return (
    <div className="space-y-3">
      {cards.map(card => (
        <div key={card.key} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{card.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{card.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge variant="outline" className="rounded-full border-border/60 bg-background px-2">{card.count}</Badge>
              <Button size="sm" variant="outline" onClick={() => onOpen(card.path, card.title)}>{card.actionLabel}</Button>
            </div>
          </div>
          {card.items.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
              {card.items.map((item, index) => (
                <button
                  // 一张收货单可有多条打印失败记录；只读预览按返回行区分，不能按单据 ID 合并。
                  key={`${card.key}-${item.id}-${index}`}
                  type="button"
                  onClick={() => onOpen(item.path, item.title)}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                        {item.badge && <Badge variant="outline" className="h-5 rounded-full px-2 text-xs">{item.badge}</Badge>}
                      </div>
                      {item.subtitle && <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{item.subtitle}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.hint || (item.createdAt ? formatDisplayDateTime(item.createdAt) : '待处理')}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** 财务与系统级提醒（原独立「审批与提醒」页的内容，并入工作台底部） */
function ReminderBlock({ items, onOpen }: { items: NotificationItem[]; onOpen: (path: string, title: string) => void }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-card-title">财务与系统提醒</h2>
          <p className="text-muted-body">财务与系统级事项汇总，业务待办见上方岗位分组。</p>
        </div>
        <Badge variant="outline">{items.length} 项</Badge>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
            暂无待提醒事项
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={`${item.path}-${index}`}
              type="button"
              onClick={() => onOpen(item.path, item.text)}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-colors hover:opacity-90 ${getReminderTone(item)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-base">{item.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.text}</p>
                    <p className="mt-1 text-xs opacity-80">{getNotificationCategoryLabel(item.category)}提醒</p>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 border-current/20 bg-background">
                  P{item.priority ?? 9}
                </Badge>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

export default function RoleWorkbenchPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const isActiveTab = useActiveWorkspaceTab()

  const workbenchQ = useRoleWorkbench()

  const notificationsQ = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => getNotificationsApi(),
    enabled: isActiveTab,
    refetchInterval: isActiveTab ? 60_000 : false,
  })

  // 必须 useMemo：`?? []` 每次渲染都是新数组引用，下面 reminderItems 的过滤会每次重跑
  const notificationItems = useMemo(() => notificationsQ.data?.items ?? [], [notificationsQ.data])
  const reminderItems = useMemo(() => getReminderNotifications(notificationItems), [notificationItems])

  const { data, isLoading, isError, error, refetch } = workbenchQ
  const sections = [...(data?.sections ?? [])].sort((a, b) => a.priorityRank - b.priorityRank)

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="待办中心"
        description="按岗位分组展示待办事项，优先处理最紧急的事项；财务与系统级提醒统一在页面底部汇总。"
        actions={<Button onClick={() => { void refetch(); void notificationsQ.refetch() }}>立即刷新</Button>}
      />

      <FulfillmentTodos />

      {isLoading && (
        <div className="grid gap-4">
          <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
          <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
        </div>
      )}

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="待办中心加载失败"
          compact
        />
      )}

      {!isLoading && !isError && sections.length > 0 && sections.map(section => (
        <section key={section.key} className="space-y-3">
          <div>
            <h2 className="text-section-title">{section.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
          </div>
          <SectionList
            cards={section.cards.slice().sort((a, b) => a.priorityRank - b.priorityRank)}
            onOpen={openPath}
          />
        </section>
      ))}

      {!isLoading && !isError && !sections.length && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
          暂无待办事项
        </div>
      )}

      <ReminderBlock items={reminderItems} onOpen={openPath} />
    </div>
  )
}
