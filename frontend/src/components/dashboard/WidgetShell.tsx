import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TONE_ICON, type WidgetTone } from './tokens'

/**
 * 图表/列表类小组件的统一外框：圆角语义色图标底座 + 标题 + 可选右上角操作 + 内容区。
 * 不含编辑态逻辑（拖拽/隐藏由外层 SortableItem 统一叠加），只负责内容呈现，
 * 使各小组件保持一致的视觉密度与图标风格。
 */
export function WidgetShell({
  title, icon: Icon, tone = 'primary', action, children, className, bodyClassName, scrollBody = false,
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
}) {
  return (
    // h-full + overflow-hidden：卡片高度由网格行高决定，内容不撑破（超出的靠 scrollBody 滚动）
    <div className={cn('card-base flex h-full flex-col overflow-hidden p-4', className)}>
      <div className="mb-3 flex shrink-0 items-center gap-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="text-card-title min-w-0 flex-1 truncate">{title}</h3>
        {action}
      </div>
      <div className={cn('min-h-0 flex-1', scrollBody && 'overflow-y-auto', bodyClassName)}>{children}</div>
    </div>
  )
}
