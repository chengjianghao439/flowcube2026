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
  emptyDescription = '当前条件下暂无数据',
  children,
  className,
}: ReportPanelProps) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="text-card-title">{title}</h2>
          {(description || helper) && (
            <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{description || helper}</p>
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
