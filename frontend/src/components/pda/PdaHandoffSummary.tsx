import type { ReactNode } from 'react'
import type { WarehouseHandoff, WarehouseConfirmation } from '@/api/warehouse-tasks'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
const time = (value: string | null | undefined) => value ? formatDisplayDateTime(value) : '未记录'
export default function PdaHandoffSummary({ handoff, confirmations = [], children }: {
  handoff?: WarehouseHandoff; confirmations?: WarehouseConfirmation[]; children?: ReactNode
}) {
  const phase = handoff?.phase || 'unknown'
  return <section aria-label="仓库交接" className="space-y-2 border-b border-border pb-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">申请人：{handoff?.requestedBy?.name || '未记录'}</p>
      <SoftStatusLabel label={{pending:'待仓库确认',completed:'已完成',unknown:'阶段未记录'}[phase]} tone={phase === 'pending' ? 'warning' : phase === 'completed' ? 'success' : 'draft'} />
    </div>
    <p className="whitespace-pre-wrap break-words leading-6"><span className="text-muted-foreground">原因：</span>{handoff?.reason || '未记录'}</p>
    <details data-handoff-confirmations>
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">交接与确认记录{confirmations.length ? `（${confirmations.length}）` : ''}</summary>
      <div className="space-y-3 pb-1 text-xs text-muted-foreground">
        <p>申请时间：{time(handoff?.requestedAt)} · 完成时间：{time(handoff?.completedAt)}</p>
        {children}
        {confirmations.length ? <ul className="space-y-2">{confirmations.map(c => <li key={c.id} className="space-y-0.5">
          <p className="whitespace-normal [overflow-wrap:anywhere] text-foreground">{c.kind === 'package_void' ? '拆箱' : '归还'} · {c.barcode || '条码未记录'}{c.qty == null ? '' : ` · ${c.qty.toFixed(2)}`}</p>
          <p>确认人：{c.confirmedBy?.name || '未记录'} · {time(c.confirmedAt)}</p>
        </li>)}</ul> : <p>暂无已记录的确认事实</p>}
      </div>
    </details>
  </section>
}
