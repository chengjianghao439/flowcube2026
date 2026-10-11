import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { INBOUND_STATUS_LABEL, type InboundTask } from '@/types/inbound-tasks'
import { inboundExceptionReason } from './inboundException'

export function InboundTaskStatus({ task, onView }: { task: InboundTask; onView: () => void }) {
  const tone = task.receiptStatus?.key === 'audited'
    ? 'success'
    : task.receiptStatus?.key === 'exception'
      ? 'danger'
      : task.receiptStatus?.key === 'draft' ? 'draft' : 'active'
  const reason = inboundExceptionReason(task.exceptionFlags)
  return (
    <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
      <SoftStatusLabel label={task.receiptStatus?.label ?? INBOUND_STATUS_LABEL[task.status]} tone={tone} />
      {reason && <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-warning-ink hover:bg-warning/10 hover:text-warning-ink" aria-label={`${reason}；查看详情`} title={`${reason}；查看详情`} onClick={onView}>
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>}
    </div>
  )
}
