import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { sortingBinHandoffPath } from '@/pages/sorting-bins/handoff'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import type { SaleOrder } from '@/types/sale'

const awaitingBin = (task: NonNullable<SaleOrder['tasks']>[number]) =>
  [2, 3].includes(task.status) && task.sortingBinId == null
  && !task.cancelRequestedAt && !task.adjustmentRequestedAt

export function FulfillmentProgressCard({ order, targetTaskId }: { order: SaleOrder; targetTaskId?: number }) {
  const navigate = useNavigate()
  const target = useRef<HTMLDivElement>(null)
  const tasks = order.tasks ?? []
  const reverseActive = (task: NonNullable<SaleOrder['tasks']>[number]) => task.status >= 2 && task.status < 7 && !!(task.cancelRequestedAt || task.adjustmentRequestedAt)
  const targetTask = tasks.find(task => task.taskId === targetTaskId && reverseActive(task))
  useEffect(() => { if (targetTaskId && targetTask) target.current?.scrollIntoView?.({ block: 'nearest' }) }, [targetTaskId, targetTask])
  const reverseNotice = <>
    {targetTaskId && !targetTask && <p role="status" className="text-sm text-muted-foreground">已重新读取，原任务已不在本单待处理范围内；可能已完成、已解除等待或不属于本单，请查看最新任务。</p>}
    {tasks.filter(reverseActive).map(task => <div key={task.taskId} ref={task.taskId === targetTaskId ? target : undefined} data-reverse-task={task.taskId} data-handoff-target={task.taskId === targetTaskId ? 'true' : 'false'} className="rounded-md border border-warning/35 bg-warning/[0.07] px-3 py-2 text-sm">
      <p className="font-medium">{task.warehouseName || `仓库#${task.warehouseId}`} · {task.taskNo}</p>
      {task.cancelRequestedAt && <p>等待实物归还：仓库需在 PDA → 拣货退回 核对任务 {task.taskNo} 并逐项扫码，完成后刷新。</p>}
      {task.adjustmentRequestedAt && <p>等待改单确认：仓库需在 PDA → 改单确认 核对任务 {task.taskNo} 并逐项扫码，完成后刷新。</p>}
      <p className="mt-1 text-xs text-muted-foreground">本页只查看交接进度；事项处理记录不能代替仓库实物确认。</p>
    </div>)}
  </>
  const { can } = usePermission()
  const binHandoff = (task: NonNullable<SaleOrder['tasks']>[number]) => {
    const path = sortingBinHandoffPath(task.taskId, task.warehouseId)
    return can(PERMISSIONS.WAREHOUSE_TASK_ASSIGN) && path
      ? <Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => navigate(path)}>去分配分拣格</Button>
      : <span>，请联系主管在分拣格管理页处理</span>
  }
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
  if (tasks.length > 1) {
    const wtTone = (s: number): StatusTone => s === 7 ? 'success' : s === 8 ? 'danger' : 'active'
    return (
      <div className="space-y-3">
        {reverseNotice}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">仓库任务进度</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              共 {tasks.length} 个仓库任务，各任务独立推进作业。
            </p>
          </div>
        </div>
        <div className="divide-y rounded-lg border px-3">
          {tasks.map(t => (
            <div key={t.taskId} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{t.warehouseName || `仓库#${t.warehouseId}`}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t.taskNo}</span>
              </div>
              <div className="text-right">
                <SoftStatusLabel label={t.statusName || `阶段 ${t.status}`} tone={wtTone(t.status)} />
                {awaitingBin(t) && <p className="mt-1 text-xs text-warning-ink">待分配分拣格{binHandoff(t)}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!order.taskNo) return reverseNotice

  return (
    <div className="space-y-4">
      {reverseNotice}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">作业进度</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">仓库任务：{order.taskNo}</p>
        </div>
        {isCancelled ? (
          <SoftStatusLabel label="已取消" tone="danger" />
        ) : isPicking ? (
          <SoftStatusLabel label={order.warehouseTaskStatusName || `阶段 ${current}`} tone={current === 7 ? 'success' : 'active'} />
        ) : null}
      </div>

      {tasks[0] && awaitingBin(tasks[0]) && (
        <p className="rounded-md border border-warning/35 bg-warning/[0.07] px-3 py-2 text-sm text-foreground">
          待分配分拣格{binHandoff(tasks[0])}；分配完成后刷新任务。
        </p>
      )}

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
