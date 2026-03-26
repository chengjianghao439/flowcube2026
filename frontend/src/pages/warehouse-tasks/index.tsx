import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, List, ScanBarcode } from 'lucide-react'
import { useInvalidate } from '@/hooks/useInvalidate'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { TaskStatCards } from './components/TaskStatCards'
import { KanbanBoard } from './components/KanbanBoard'
import {
  getTasksApi, getTaskByIdApi, cancelTaskApi, updateTaskPriorityApi,
  PRIORITY_LABEL, PRIORITY_COLOR,
} from '@/api/warehouse-tasks'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import type { TableColumn } from '@/types'

/* ─── TaskDetailDialog ───────────────────────────────────────────────────── */

interface DetailProps {
  open: boolean
  onClose: () => void
  task: WarehouseTask | null
  loading: boolean
  onAction: () => void
}

function TaskDetailDialog({ open, onClose, task, loading, onAction }: DetailProps) {
  const nav = useNavigate()
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const cancel = useMutation({
    mutationFn: () => cancelTaskApi(task!.id),
    onSuccess: () => { onAction(); onClose(); toast.success('任务已取消') },
  })

  if (!task && !loading) return null

  const totalRequired = task?.items?.reduce((s, i) => s + i.requiredQty, 0) ?? 0
  const totalPicked   = task?.items?.reduce((s, i) => s + i.pickedQty, 0) ?? 0
  const pickProgress  = totalRequired > 0 ? Math.round((totalPicked / totalRequired) * 100) : 0

  return (
    <>
    <ConfirmDialog
      open={cancelConfirm}
      title="取消任务"
      description="确认取消此仓库任务？"
      variant="destructive"
      confirmText="确认取消"
      onConfirm={() => { setCancelConfirm(false); cancel.mutate() }}
      onCancel={() => setCancelConfirm(false)}
    />
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            仓库任务详情
            {task && <StatusBadge type="task" status={task.status} />}
            {task && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority]}`}>
                {PRIORITY_LABEL[task.priority]}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>}

        {task && !loading && (
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 text-sm">
              <div><span className="text-muted-foreground">任务编号：</span><span className="font-mono font-semibold">{task.taskNo}</span></div>
              <div><span className="text-muted-foreground">关联销售单：</span><span className="font-mono">{task.saleOrderNo}</span></div>
              <div><span className="text-muted-foreground">客户：</span>{task.customerName}</div>
              <div><span className="text-muted-foreground">仓库：</span>{task.warehouseName}</div>
              <div><span className="text-muted-foreground">创建时间：</span>{task.createdAt?.slice(0, 16)}</div>
              {task.shippedAt && <div><span className="text-muted-foreground">出库时间：</span>{task.shippedAt?.slice(0, 16)}</div>}
            </div>

            {task.status === 2 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>备货进度</span>
                  <span>{totalPicked.toFixed(0)} / {totalRequired.toFixed(0)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pickProgress}%` }} />
                </div>
                <p className="text-right text-xs text-muted-foreground">{pickProgress}%</p>
              </div>
            )}

            <div>
              <Label className="text-base font-semibold">商品明细</Label>
              <div className="mt-2 overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">商品</th>
                      <th className="w-16 px-3 py-2 text-left font-medium">单位</th>
                      <th className="w-24 px-3 py-2 text-right font-medium">需备货</th>
                      <th className="w-28 px-3 py-2 text-right font-medium">已备货</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.items?.map(item => (
                      <tr key={item.id} className="border-t">
                        <td className="px-4 py-2">
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">{item.productCode}</p>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.unit}</td>
                        <td className="px-3 py-2 text-right font-semibold">{item.requiredQty}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={item.pickedQty >= item.requiredQty ? 'font-semibold text-success' : 'text-muted-foreground'}>
                            {item.pickedQty}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {/* PDA 提示 — 执行操作只能由 PDA 驱动 */}
              {[2, 3].includes(task.status) && (
                <div className="flex w-full items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 mb-1">
                  <ScanBarcode className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                  <div className="text-xs text-blue-300 flex-1">
                    <p className="font-medium">任务执行由 PDA 驱动</p>
                    <p className="mt-0.5 text-blue-400/80">
                      {task.status === 2 && '仓库人员正在 PDA 扫码拣货中，请等待完成'}
                      {task.status === 3 && '仓库人员需在 PDA 上确认扫码后执行出库'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                    onClick={() => nav('/pda')}>
                    前往 PDA
                  </Button>
                </div>
              )}
              {![4, 5].includes(task.status) && (
                <Button variant="outline" className="text-destructive border-destructive/30"
                  onClick={() => setCancelConfirm(true)} disabled={cancel.isPending}>
                  取消任务
                </Button>
              )}
              <Button variant="outline" onClick={onClose} className="ml-auto">关闭</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}

/* ─── WarehouseTasksPage ─────────────────────────────────────────────────── */

import { WT_STATUS_OPTIONS } from '@/constants/warehouseTaskStatus'

export default function WarehouseTasksPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-tasks', page, keyword, statusFilter],
    queryFn: () => getTasksApi({ page, pageSize: view === 'kanban' ? 200 : 20, keyword, status: statusFilter ? +statusFilter : undefined }).then(r => r.data.data!),
    refetchInterval: 15_000,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['warehouse-task-detail', selectedId],
    queryFn: () => getTaskByIdApi(selectedId!).then(r => r.data.data!),
    enabled: !!selectedId && detailOpen,
  })

  const openDetail = (id: number) => { setSelectedId(id); setDetailOpen(true) }
  const openConfirm = (title: string, description: string, onConfirm: () => void) => setConfirmState({ open: true, title, description, onConfirm })
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['warehouse-tasks'] })
    qc.invalidateQueries({ queryKey: ['warehouse-tasks-stats'] })
    qc.invalidateQueries({ queryKey: ['warehouse-task-detail', selectedId] })
  }
  const mutOpts = (msg: string) => ({ onSuccess: () => { refresh(); toast.success(msg) } })
  const cancel       = useMutation({ mutationFn: (id: number) => cancelTaskApi(id),   ...mutOpts('任务已取消') })
  const setPriority  = useMutation({ mutationFn: ({ id, p }: { id: number; p: number }) => updateTaskPriorityApi(id, p), onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks'] }) })

  const columns: TableColumn<WarehouseTask>[] = [
    { key: 'priority', title: '优先级', width: 100, render: (v, r) => {
      const pri = v as 1 | 2 | 3
      return (
        <Select value={String(v)} onValueChange={val => setPriority.mutate({ id: r.id, p: +val })}>
          <SelectTrigger
            className={cn(
              'h-7 w-[4.5rem] cursor-pointer rounded-full border-0 px-2 py-0.5 text-xs font-medium shadow-none [&>svg]:h-3 [&>svg]:w-3',
              PRIORITY_COLOR[pri],
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">紧急</SelectItem>
            <SelectItem value="2">普通</SelectItem>
            <SelectItem value="3">低</SelectItem>
          </SelectContent>
        </Select>
      )
    }},
    { key: 'taskNo', title: '任务编号', width: 160 },
    { key: 'saleOrderNo', title: '销售单', width: 160, render: v => <span className="font-mono text-xs">{String(v)}</span> },
    { key: 'customerName', title: '客户' },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'status', title: '状态', width: 110, render: v => <StatusBadge type="task" status={v as number} /> },
    { key: 'createdAt', title: '创建时间', width: 120, render: v => String(v).slice(0, 16) },
    { key: 'id', title: '操作', width: 160, render: (_, r) => (
      <div className="flex gap-1 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => openDetail(r.id)}>详情</Button>
        {![4,5].includes(r.status) && <Button size="sm" variant="ghost" className="text-destructive" disabled={cancel.isPending} onClick={() => openConfirm('取消任务', `确认取消任务 ${r.taskNo}？`, () => { closeConfirm(); cancel.mutate(r.id) })}>取消</Button>}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="仓库任务"
        description="管理销售出库任务，从备货到发货的完整生命周期"
        actions={
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
            <button onClick={() => setView('kanban')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <LayoutGrid className="h-3.5 w-3.5" /> 看板
            </button>
            <button onClick={() => setView('list')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <List className="h-3.5 w-3.5" /> 列表
            </button>
          </div>
        }
      />

      <TaskStatCards />

      <div className="flex flex-wrap gap-2">
        <Input placeholder="搜索任务编号/客户/销售单" value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
          className="w-64" />
        <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="h-10 w-40">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {WT_STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value || '__all__'} value={o.value || '__all__'}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
        {(keyword || statusFilter) && <Button variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter(''); setPage(1) }}>清除</Button>}
      </div>

      {view === 'kanban'
        ? <KanbanBoard tasks={data?.list ?? []} onDetail={openDetail} />
        : <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} rowKey="id" onRowDoubleClick={r => openDetail(r.id)} />
      }

      <TaskDetailDialog
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedId(null) }}
        task={detail ?? null}
        loading={detailLoading}
        onAction={refresh}
      />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />
    </div>
  )
}
