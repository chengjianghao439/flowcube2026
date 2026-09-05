import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TONE_ICON, type WidgetTone } from './tokens'
import { QueryErrorState } from '@/components/shared/QueryErrorState'

/**
 * 图表/列表类小组件的统一外框：圆角语义色图标底座 + 标题 + 可选右上角操作 + 内容区。
 * 不含编辑态逻辑（拖拽/隐藏由外层 SortableItem 统一叠加），只负责内容呈现，
 * 使各小组件保持一致的视觉密度与图标风格。
 */
export function WidgetShell({
  title, icon: Icon, tone = 'primary', action, children, className, bodyClassName, scrollBody = false,
  loading = false, error, onRetry,
}: {
  title: string
  icon: LucideIcon
  tone?: WidgetTone
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** 内容区超出固定卡高时可滚动（列表/编辑面板用）。图表类不用，靠 height:100% 填充 */
  scrollBody?: boolean
  loading?: boolean
  error?: unknown
  onRetry?: () => void
}) {
  return (
    // h-full + overflow-hidden：卡片高度由网格行高决定，内容不撑破（超出的靠 scrollBody 滚动）
    <div className={cn('card-base dashboard-widget flex h-full flex-col overflow-hidden p-4', className)}>
      <div className="dashboard-widget-header mb-3 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-border pb-3">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground">{title}</h3>
        {action && <div className="dashboard-widget-action flex shrink-0 items-center">{action}</div>}
      </div>
      <div className={cn('min-h-0 flex-1', scrollBody && 'overflow-y-auto', bodyClassName)}>
        {error ? (onRetry ? <QueryErrorState error={error} onRetry={onRetry} compact /> : <p role="alert" className="py-6 text-sm text-muted-foreground">数据加载失败</p>) : loading ? (
          <div role="status" aria-label={`正在加载${title}`} className="space-y-3 py-2">
            <div className="h-5 w-1/2 rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-28 rounded bg-muted/60 motion-safe:animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-muted/60 motion-safe:animate-pulse" />
          </div>
        ) : children}
      </div>
    </div>
  )
}
