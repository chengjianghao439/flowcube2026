import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronRight } from 'lucide-react'
import { getNotificationsApi } from '@/api/notifications'
import { getNotificationCategoryLabel, normalizeNotifications, type NotificationEntry } from '@/lib/notifications'

/** 按 type 映射 lucide 图标（后端 icon 字段是 emoji，前端统一改用图标） */
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  danger: AlertTriangle,
  warning: AlertCircle,
  info: Info,
}
/** 语义色：danger 红 / warning 琥珀 / info 蓝 —— 常态浅色底填充 + 同色边框 */
const TYPE_STYLE: Record<string, { icon: string; badge: string; row: string }> = {
  danger:  { icon: 'text-red-600', badge: 'bg-red-50 text-red-700 border-red-200', row: 'bg-red-50/60 border-l-2 border-red-400 hover:bg-red-50' },
  warning: { icon: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200', row: 'bg-amber-50/60 border-l-2 border-amber-400 hover:bg-amber-50' },
  info:    { icon: 'text-blue-600', badge: 'bg-blue-50 text-blue-700 border-blue-200', row: 'bg-blue-50/60 border-l-2 border-blue-400 hover:bg-blue-50' },
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotificationsApi,
    refetchInterval: 60000, // 每分钟刷新
  })

  const items = normalizeNotifications(data?.items ?? [])
  const total = items.length
  // 按优先级分组：危险（type=danger）优先展示，其次 warning，最后 info
  const sorted = [...items].sort((a, b) => {
    const rank = { danger: 0, warning: 1, info: 2 } as Record<string, number>
    return (rank[a.type] ?? 3) - (rank[b.type] ?? 3)
  })

  const renderItem = (item: NotificationEntry) => {
    const Icon = TYPE_ICON[item.type] || Info
    const style = TYPE_STYLE[item.type] || TYPE_STYLE.info
    return (
      <button
        key={item.dedupeKey}
        onClick={() => { setOpen(false); navigate(item.path) }}
        className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-3 ${style.row}`}
      >
        <Icon className={`size-4 shrink-0 mt-0.5 ${style.icon}`} />
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground leading-snug block">{item.text}</span>
          {item.category && (
            <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-none ${style.badge}`}>
              {getNotificationCategoryLabel(item.category)}
            </span>
          )}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground/50 shrink-0 mt-1" />
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="通知中心"
      >
        <Bell className="size-[18px]" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center px-1 font-bold">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[22rem] bg-white rounded-xl shadow-lg border z-50 overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">通知中心</h3>
              </div>
              {total > 0 && (
                <span className="text-xs text-muted-foreground">
                  <span className="font-semibold text-red-600">{total}</span> 条待处理
                </span>
              )}
            </div>

            {/* 内容 */}
            {sorted.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto size-8 text-emerald-500 mb-2" />
                <p className="text-sm font-medium text-foreground">暂无待处理事项</p>
                <p className="mt-0.5 text-xs text-muted-foreground">有新的逾期、库存或待办时这里会提醒你</p>
              </div>
            ) : (
              <div className="max-h-[24rem] overflow-y-auto">
                {sorted.map(renderItem)}
              </div>
            )}

            {/* 尾部 */}
            <div className="flex items-center justify-center gap-1.5 px-4 py-2 border-t text-xs text-muted-foreground">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              每分钟自动刷新
            </div>
          </div>
        </>
      )}
    </div>
  )
}
