import { WT_STATUS, WT_KANBAN_COLUMNS, WT_STATUS_TERMINAL } from '@/constants/warehouseTaskStatus'
import type { WtStatus } from '@/constants/warehouseTaskStatus'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { cancelTaskApi, PRIORITY_LABEL } from '@/api/warehouse-tasks'
import type { WarehouseTask, TaskStatus } from '@/api/warehouse-tasks'

const COLUMNS = WT_KANBAN_COLUMNS

const PRIORITY_BAR: Record<number, string> = {
  1: 'bg-destructive',
  2: 'bg-primary',
  3: 'bg-border',
}

interface KanbanBoardProps {
  tasks: WarehouseTask[]
  onDetail: (id: number) => void
}

export function KanbanBoard({ tasks, onDetail }: KanbanBoardProps) {
  const qc = useQueryClient()
  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description: string; onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  function openConfirm(title: string, description: string, onConfirm: () => void) {
    setConfirmState({ open: true, title, description, onConfirm })
  }
  function closeConfirm() { setConfirmState(s => ({ ...s, open: false })) }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['warehouse-tasks'] })
    qc.invalidateQueries({ queryKey: ['warehouse-tasks-stats'] })
  }

  const cancel = useMutation({
    mutationFn: cancelTaskApi,
    onSuccess: () => { refresh(); closeConfirm(); toast.success('任务已取消') },
    onError:   () => closeConfirm(),
  })

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.status)
          return (
            <div key={col.status} className="flex w-64 shrink-0 flex-col gap-2">
              {/* 列标题 */}
              <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${col.accentClass}`}>
                <span className="text-sm font-medium">{col.label}</span>
                <span className="rounded-full bg-background/60 px-2 py-0.5 text-xs font-semibold tabular-nums">
                  {colTasks.length}
                </span>
              </div>

              {/* 任务卡片 */}
              <div className="flex flex-col gap-2">
                {colTasks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    暂无任务
                  </div>
                )}
                {colTasks.map(task => (
                  <div
                    key={task.id}
                    className="card-base flex overflow-hidden transition-shadow hover:shadow-md"
                  >
                    {/* 优先级色条 */}
                    <div className={`w-1 shrink-0 rounded-l-2xl ${PRIORITY_BAR[task.priority] || 'bg-border'}`} />

                    <div className="flex flex-1 flex-col gap-2 p-3">
                      {/* 头部：任务号 + 优先级标签 */}
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-mono text-xs font-semibold text-foreground leading-tight">
                          {task.taskNo}
                        </span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          task.priority === 1
                            ? 'bg-destructive/10 text-destructive'
                            : task.priority === 2
                            ? 'bg-primary/10 text-primary'
                            : 'bg-secondary text-muted-foreground'
                        }`}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                      </div>

                      {/* 客户 & 销售单 */}
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-foreground truncate">{task.customerName}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{task.saleOrderNo}</p>
                      </div>

                      {/* 状态 badge */}
                      <StatusBadge type="task" status={task.status} />

                      {/* 操作按钮 — 仅详情和取消，执行操作由 PDA 驱动 */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => onDetail(task.id)}
                        >
                          详情
                        </Button>
                        {!WT_STATUS_TERMINAL.includes(task.status as WtStatus) && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive"
                            disabled={cancel.isPending}
                            onClick={() => openConfirm(
                              '取消任务',
                              `确认取消任务 ${task.taskNo}？`,
                              () => cancel.mutate(task.id),
                            )}>
                            取消
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant="destructive"
        confirmText="确认取消"
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />
    </>
  )
}
