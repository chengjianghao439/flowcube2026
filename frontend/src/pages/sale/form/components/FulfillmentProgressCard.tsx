import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import type { SaleOrder } from '@/types/sale'

export function FulfillmentProgressCard({ order }: { order: SaleOrder }) {
  const steps = [
    { status: 2, label: '拣货中' },
    { status: 3, label: '待分拣' },
    { status: 4, label: '待复核' },
    { status: 5, label: '待打包' },
    { status: 6, label: '待出库' },
    { status: 7, label: '已出库' },
  ]
  const current = order.warehouseTaskStatus ?? 0
  const currentIdx = steps.findIndex(s => s.status === current)
  const isCancelled = current === 8
  const isPicking = current >= 2

  // 分仓：一个订单有多个仓库任务时，改为逐仓列出各任务的仓库/状态（各仓进度可能不同），
  // 而不是只展示单个任务的步骤条。单仓订单（tasks<=1）走下面的原单任务展示。
  const tasks = order.tasks ?? []
  if (tasks.length > 1) {
    const wtTone = (s: number): StatusTone => s === 7 ? 'success' : s === 8 ? 'danger' : 'active'
    return (
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">分仓履约进度</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              该订单从 {tasks.length} 个仓库分别发货，已发 {order.shippedTotalQty ?? 0}/{order.orderedTotalQty ?? 0}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.taskId} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{t.warehouseName || `仓库#${t.warehouseId}`}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t.taskNo}</span>
              </div>
              <SoftStatusLabel label={t.statusName || `阶段 ${t.status}`} tone={wtTone(t.status)} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!order.taskNo) return null

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">作业进度</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">仓库任务：{order.taskNo}</p>
        </div>
        {isCancelled ? (
          <SoftStatusLabel label="已取消" tone="danger" />
        ) : isPicking ? (
          <SoftStatusLabel label={order.warehouseTaskStatusName || `阶段 ${current}`} tone="active" />
        ) : null}
      </div>

      {isPicking && !isCancelled && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {steps.map((step, idx) => {
            const isDone = idx < currentIdx
            const isCurrent = idx === currentIdx
            return (
              <div key={step.status} className="flex items-center gap-1 flex-1 last:flex-none">
                <div className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-medium ${
                  isDone ? 'border-primary/15 bg-primary/10 text-primary'
                    : isCurrent ? 'border-warning/35 bg-warning/[0.07] text-foreground'
                    : 'border-transparent bg-muted/30 text-muted-foreground'
                }`}>
                  <span>{isDone ? '✓' : isCurrent ? '●' : '○'}</span>
                  <span>{step.label}</span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`h-px flex-1 min-w-[8px] ${isDone ? 'bg-primary/30' : 'bg-border'}`} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
