import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getNotificationsApi, type NotificationItem } from '@/api/notifications'
import { getNotificationCategoryLabel, getReminderNotifications } from '@/lib/notifications'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

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
  const isActiveTab = useActiveWorkspaceTab()

  const notificationsQ = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => getNotificationsApi(),
    enabled: isActiveTab,
    refetchInterval: isActiveTab ? 60_000 : false,
  })

  const notificationItems = notificationsQ.data?.items ?? []
  const reminderItems = useMemo(() => getReminderNotifications(notificationItems), [notificationItems])
  const topReminder = reminderItems[0] ?? null

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="提醒中心"
        description="财务提醒与系统级事项汇总，避免与岗位工作台的业务待办重复。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openPath('/reports/role-workbench', '岗位工作台')}>打开岗位工作台</Button>
            <Button variant="outline" onClick={() => openPath('/payments', '应付/应收账款')}>打开账款中心</Button>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs text-muted-foreground">待提醒总数</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{reminderItems.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">财务与系统级提醒</p>
        </div>
      </div>

      <div>
        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">提醒事项</h2>
              <p className="text-muted-body">财务与系统级提醒，业务待办请到岗位工作台处理。</p>
            </div>
            <Badge variant="outline">{reminderItems.length} 项</Badge>
          </div>
          <div className="space-y-2">
            {reminderItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
                暂无待提醒事项
              </div>
            ) : (
              reminderItems.map((item: NotificationItem, index) => (
                <button
                  key={`${item.path}-${index}`}
                  type="button"
                  onClick={() => openPath(item.path, item.text)}
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
