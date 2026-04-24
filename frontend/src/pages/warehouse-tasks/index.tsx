import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, List, ScanBarcode } from 'lucide-react'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { TaskStatCards } from './components/TaskStatCards'
import { KanbanBoard } from './components/KanbanBoard'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getOutboundClosureCopy } from '@/lib/outboundClosure'
import { readPositiveIntParam, readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
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
  const closureCopy = getOutboundClosureCopy(task)

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
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">当前闭环阶段：{closureCopy.stageLabel}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{closureCopy.description}</p>
                </div>
                <div className="rounded-xl border border-border bg-white px-4 py-3 text-right">
                  <p className="text-helper">下一步动作</p>
                  <p className="mt-1 font-semibold text-foreground">{closureCopy.nextAction}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 text-sm">
              <div><span className="text-muted-foreground">任务编号：</span><span className="text-doc-code-strong">{task.taskNo}</span></div>
              <div><span className="text-muted-foreground">关联销售单：</span><span className="text-doc-code">{task.saleOrderNo}</span></div>
              <div><span className="text-muted-foreground">客户：</span>{task.customerName}</div>
              <div><span className="text-muted-foreground">仓库：</span>{task.warehouseName}</div>
              <div><span className="text-muted-foreground">创建时间：</span>{formatDisplayDateTime(task.createdAt)}</div>
              {task.shippedAt && <div><span className="text-muted-foreground">出库时间：</span>{formatDisplayDateTime(task.shippedAt)}</div>}
            </div>

            {(task.packageSummary || task.printSummary) && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div>
                    <p className="font-medium text-foreground">装箱进度</p>
                    <p className="text-xs text-muted-foreground">统一查看当前任务的打包完成度。</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">箱子总数：</span>{task.packageSummary?.totalPackages ?? 0}</div>
                    <div><span className="text-muted-foreground">已完成：</span>{task.packageSummary?.donePackages ?? 0}</div>
                    <div><span className="text-muted-foreground">未完成：</span>{task.packageSummary?.openPackages ?? 0}</div>
                    <div><span className="text-muted-foreground">装箱总件：</span>{task.packageSummary?.totalItems ?? 0}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => nav('/pda/pack')}>
                      打开 PDA 打包
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div>
                    <p className="font-medium text-foreground">打印闭环</p>
                    <p className="text-xs text-muted-foreground">优先收口箱贴失败、超时和待确认任务，再继续现场出库。</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">已打印：</span>{task.printSummary?.successCount ?? 0}</div>
                    <div><span className="text-muted-foreground">打印失败：</span>{task.printSummary?.failedCount ?? 0}</div>
                    <div><span className="text-muted-foreground">超时待确认：</span>{task.printSummary?.timeoutCount ?? 0}</div>
                    <div><span className="text-muted-foreground">打印中：</span>{task.printSummary?.processingCount ?? 0}</div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {task.printSummary?.recentPrinter ? `最近打印机：${task.printSummary.recentPrinter}。` : ''}
                    {task.printSummary?.recentError ? ` 最近异常：${task.printSummary.recentError}。` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => nav(`/settings/barcode-print-query?category=outbound&keyword=${encodeURIComponent(task.taskNo)}`)}>
                      打开出库补打
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => nav(`/settings/barcode-print-query?category=logistics&keyword=${encodeURIComponent(task.taskNo)}`)}>
                      打开物流补打
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => nav('/pda/ship')}>
                      打开 PDA 出库
                    </Button>
                  </div>
                </div>
              </div>
            )}

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
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const isActiveTab = useActiveWorkspaceTab()
  const page = readPositiveIntParam(searchParams, 'page', 1)
  const keyword = readStringParam(searchParams, 'keyword')
  const statusFilter = readStringParam(searchParams, 'status')
  const view = searchParams.get('view') === 'list' ? 'list' : 'kanban'
  const taskId = Number(searchParams.get('taskId') || '')
  const selectedId = Number.isInteger(taskId) && taskId > 0 ? taskId : null
  const detailOpen = selectedId != null
  const [search, setSearch] = useState(keyword)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })

  useEffect(() => {
    setSearch(keyword)
  }, [keyword])

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-tasks', view, page, keyword, statusFilter],
    queryFn: () => getTasksApi({ page, pageSize: view === 'kanban' ? 200 : 20, keyword, status: statusFilter ? +statusFilter : undefined }),
    enabled: isActiveTab,
    refetchInterval: isActiveTab ? 15_000 : false,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['warehouse-task-detail', selectedId],
    queryFn: () => getTaskByIdApi(selectedId!),
    enabled: !!selectedId && detailOpen,
  })

  const openDetail = (id: number) => updateParams({ taskId: id })
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
    { key: 'taskNo', title: '任务编号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'saleOrderNo', title: '销售单', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'customerName', title: '客户' },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'status', title: '状态', width: 110, render: v => <StatusBadge type="task" status={v as number} /> },
    { key: 'createdAt', title: '创建时间', width: 120, render: v => formatDisplayDateTime(v) },
    { key: 'id', title: '操作', width: 160, render: (_, r) => (
      <TableActionsMenu
        primaryLabel="详情"
        onPrimaryClick={() => openDetail(r.id)}
        items={
          ![4, 5].includes(r.status)
            ? [{
                label: '取消',
                destructive: true,
                onClick: () => openConfirm('取消任务', `确认取消任务 ${r.taskNo}？`, () => { closeConfirm(); cancel.mutate(r.id) }),
                disabled: cancel.isPending,
              }]
            : []
        }
      />
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="仓库任务"
        description="管理销售出库任务，从备货到发货的完整生命周期"
        actions={
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
            <button onClick={() => updateParams({ view: 'kanban' })} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <LayoutGrid className="h-3.5 w-3.5" /> 看板
            </button>
            <button onClick={() => updateParams({ view: 'list' })} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <List className="h-3.5 w-3.5" /> 列表
            </button>
          </div>
        }
      />

      <TaskStatCards />

      <div className="flex flex-wrap gap-2">
        <Input placeholder="搜索任务编号/客户/销售单" value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') updateParams({ keyword: search, page: 1 }) }}
          className="w-64" />
        <Select value={statusFilter || '__all__'} onValueChange={v => updateParams({ status: v === '__all__' ? null : v, page: 1 })}>
          <SelectTrigger className="h-10 w-40">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {WT_STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value || '__all__'} value={o.value || '__all__'}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => updateParams({ keyword: search, page: 1 })}>搜索</Button>
        {(keyword || statusFilter) && <Button variant="ghost" onClick={() => {
          setSearch('')
          updateParams({ keyword: null, status: null, page: 1 })
        }}>清除</Button>}
      </div>

      {view === 'kanban'
        ? <KanbanBoard tasks={data?.list ?? []} onDetail={openDetail} />
        : <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} pagination={data?.pagination} onPageChange={(nextPage) => updateParams({ page: nextPage })} rowKey="id" onRowDoubleClick={r => openDetail(r.id)} />
      }

      <TaskDetailDialog
        open={detailOpen}
        onClose={() => updateParams({ taskId: null })}
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
