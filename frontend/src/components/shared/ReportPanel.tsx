import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'
import { Button } from '@/components/ui/button'

interface ReportPanelProps {
  title: string
  description?: string
  helper?: string
  actionLabel?: string
  onAction?: () => void
  empty?: boolean
  emptyTitle?: string
  emptyDescription?: string
  children?: React.ReactNode
  className?: string
}

export function ReportPanel({
  title,
  description,
  helper,
  actionLabel,
  onAction,
  empty = false,
  emptyTitle = '暂无数据',
  emptyDescription = '当前条件下没有可展示的内容',
  children,
  className,
}: ReportPanelProps) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-card-title">{title}</p>
          {(description || helper) && (
            <p className="mt-1 text-helper">{description || helper}</p>
          )}
        </div>
        {actionLabel && onAction && (
          <Button size="sm" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>

      {empty ? (
        <EmptyState
          variant="no-data"
          compact
          title={emptyTitle}
          description={emptyDescription}
          className="py-6"
        />
      ) : (
        children
      )}
    </section>
  )
}
