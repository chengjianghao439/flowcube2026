/**
 * 波次拣货管理页
 * 路由：/picking-waves
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getWavesApi, getWaveByIdApi, startWaveApi, finishPickingApi, finishWaveApi, cancelWaveApi,
  WAVE_STATUS_LABEL, WAVE_PRIORITY_LABEL,
  type PickingWave, type WaveStatus,
} from '@/api/picking-waves'
import DataTable from '@/components/shared/DataTable'
import { confirmAction } from '@/lib/confirm'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'

function getWaveClosureCopy(wave: PickingWave | null) {
  if (!wave) {
    return {
      stageLabel: '待选择波次',
      description: '从列表打开波次详情后，可继续查看拣货、分拣与打印闭环。',
      nextAction: '先打开具体波次',
    }
  }

  const printSummary = wave.printSummary
  if (wave.status === 5) {
    return { stageLabel: '已取消', description: '该波次已取消，当前不再进入出库闭环。', nextAction: '如需恢复，请重新建波次' }
  }
  if ((printSummary?.failedCount ?? 0) > 0 || (printSummary?.timeoutCount ?? 0) > 0) {
    return {
      stageLabel: '待补打',
      description: '出库箱贴存在失败或超时任务，建议先补打，再继续拣货 / 分拣 / 出库。',
      nextAction: '优先收口出库打印异常',
    }
  }
  if (wave.status === 1) {
    return { stageLabel: '待拣货', description: '波次已创建，等待仓库开始拣货。', nextAction: '安排仓库开始拣货' }
  }
  if (wave.status === 2) {
    return { stageLabel: '拣货中', description: '波次正在按路线推进，优先确认进度和卡点。', nextAction: '跟进拣货推进与异常容器' }
  }
  if (wave.status === 3) {
    return { stageLabel: '待分拣', description: '波次拣货已完成，等待后续分拣 / 复核 / 出库。', nextAction: '继续推进分拣与出库' }
  }
  if (wave.status === 4) {
    return { stageLabel: '已完成', description: '该波次已完成，仍可复盘打印和任务执行情况。', nextAction: '可回看打印与执行记录' }
  }
  return { stageLabel: wave.statusName, description: '当前波次可继续查看执行与打印信息。', nextAction: '检查主链处理状态' }
}

function StatBlock({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
      <p className="text-helper">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-helper">{hint}</p> : null}
    </div>
  )
}

export default function PickingWavesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [searchParams, setSearchParams] = useSearchParams()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const selectedWaveId = Number(searchParams.get('waveId') || 0) || null
  const focus = searchParams.get('focus') || ''
  const progressRef = useRef<HTMLDivElement | null>(null)
  const printClosureRef = useRef<HTMLDivElement | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['picking-waves', keyword, statusFilter, page],
    queryFn: () => getWavesApi({ keyword, status: statusFilter || undefined, page, pageSize: 20 }).then(r => r.data.data),
  })

  const { data: detail } = useQuery({
    queryKey: ['picking-wave-detail', selectedWaveId],
    queryFn: () => getWaveByIdApi(selectedWaveId!).then(r => r.data.data),
    enabled: !!selectedWaveId,
  })

  useEffect(() => {
    if (!detail || !focus) return
    const target = focus === 'print-closure' ? printClosureRef.current : progressRef.current
    if (!target) return
    window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 160)
  }, [detail, focus])

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['picking-waves'] })
    qc.invalidateQueries({ queryKey: ['picking-wave-detail'] })
  }

  const startMut = useMutation({
    mutationFn: startWaveApi,
    onSuccess: () => { toast.success('已开始拣货'); invalidate() },
    onError: () => toast.error('操作失败'),
  })
  const finishPickMut = useMutation({
    mutationFn: finishPickingApi,
    onSuccess: () => { toast.success('拣货完成'); invalidate() },
    onError: () => toast.error('操作失败'),
  })
  const finishMut = useMutation({
    mutationFn: finishWaveApi,
    onSuccess: () => { toast.success('波次已完成'); invalidate(); closeDetail() },
    onError: () => toast.error('操作失败'),
  })
  const cancelMut = useMutation({
    mutationFn: cancelWaveApi,
    onSuccess: () => { toast.success('已取消'); invalidate(); closeDetail() },
    onError: () => toast.error('取消失败'),
  })

  function openWaveDetail(wave: PickingWave, nextFocus?: string) {
    const params = new URLSearchParams(searchParams)
    params.set('waveId', String(wave.id))
    if (nextFocus) params.set('focus', nextFocus)
    else params.delete('focus')
    setSearchParams(params)
  }

  function closeDetail() {
    const params = new URLSearchParams(searchParams)
    params.delete('waveId')
    params.delete('focus')
    setSearchParams(params)
  }

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  const columns = useMemo<TableColumn<PickingWave>[]>(() => [
    {
      key: 'waveNo',
      title: '波次单号',
      width: 160,
      render: (_, row) => (
        <button type="button" className="text-left" onClick={() => openWaveDetail(row)}>
          <span className="text-doc-code">{row.waveNo}</span>
        </button>
      ),
    },
    {
      key: 'warehouseName',
      title: '仓库',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      title: '状态 / 下一步',
      width: 220,
      render: (_, row) => {
        const tone = row.status === 4 ? 'success' : row.status === 5 ? 'danger' : row.status === 1 ? 'draft' : 'active'
        const copy = getWaveClosureCopy(row)
        return (
          <div className="space-y-1">
            <SoftStatusLabel label={WAVE_STATUS_LABEL[row.status]} tone={tone} />
            <p className="text-xs text-muted-foreground">{copy.nextAction}</p>
          </div>
        )
      },
    },
    {
      key: 'priority',
      title: '优先级',
      width: 80,
      render: v => WAVE_PRIORITY_LABEL[v as 1 | 2 | 3],
    },
    { key: 'taskCount', title: '任务数', width: 80 },
    {
      key: 'operatorName',
      title: '拣货人',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 160,
      render: v => formatDisplayDateTime(v),
    },
    {
      key: 'id',
      title: '操作',
      width: 180,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="详情"
          onPrimaryClick={() => openWaveDetail(row)}
          items={[
            { label: '查看打印闭环', onClick: () => openWaveDetail(row, 'print-closure') },
            { label: '打开出库补打', onClick: () => openPath(`/settings/barcode-print-query?category=outbound&keyword=${encodeURIComponent(row.waveNo)}`, '条码打印查询') },
          ]}
        />
      ),
    },
  ], [searchParams])

  const detailCopy = getWaveClosureCopy(detail ?? null)
  const printSummary = detail?.printSummary
  const totalQty = detail?.items?.reduce((sum, item) => sum + item.totalQty, 0) ?? 0
  const pickedQty = detail?.items?.reduce((sum, item) => sum + item.pickedQty, 0) ?? 0
  const progressPct = totalQty > 0 ? Math.round((pickedQty / totalQty) * 100) : 0

  return (
    <div className="space-y-5">
      <PageHeader title="波次拣货" description="管理波次拣货、分拣推进与出库打印异常的统一处理链。" />

      <FilterCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <Input
              placeholder="波次单号"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {([1, 2, 3, 4, 5] as WaveStatus[]).map(s => (
                <SelectItem key={s} value={String(s)}>{WAVE_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter(''); setPage(1) }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} rowKey="id" />

      <Dialog open={!!selectedWaveId} onOpenChange={v => !v && closeDetail()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              波次详情 — <span className="text-doc-code-strong">{detail?.waveNo ?? `#${selectedWaveId}`}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[75vh] space-y-5 overflow-y-auto py-2">
            <section className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">当前主链阶段：{detailCopy.stageLabel}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{detailCopy.description}</p>
                </div>
                <div className="rounded-xl border border-border bg-white px-4 py-3 text-right">
                  <p className="text-helper">下一步动作</p>
                  <p className="mt-1 font-semibold text-foreground">{detailCopy.nextAction}</p>
                </div>
              </div>
            </section>

            <section ref={progressRef} className="space-y-4 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-card-title">波次推进</h3>
                  <p className="text-muted-body">统一查看拣货进度、任务数量和当前责任人。</p>
                </div>
                {detail ? <SoftStatusLabel label={WAVE_STATUS_LABEL[detail.status]} tone={detail.status === 4 ? 'success' : detail.status === 5 ? 'danger' : detail.status === 1 ? 'draft' : 'active'} /> : null}
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <StatBlock label="任务数" value={detail?.taskCount ?? 0} />
                <StatBlock label="应拣总数" value={totalQty} />
                <StatBlock label="已拣总数" value={pickedQty} />
                <StatBlock label="当前进度" value={`${progressPct}%`} hint={detail?.operatorName ? `责任人：${detail.operatorName}` : '待分配'} />
              </div>
              {detail?.tasks?.length ? (
                <div className="rounded-xl border border-border">
                  <div className="grid grid-cols-[160px_1fr_120px] gap-3 border-b border-border px-4 py-3 text-sm font-medium text-muted-foreground">
                    <span>仓库任务</span>
                    <span>销售单 / 客户</span>
                    <span>当前状态</span>
                  </div>
                  <div className="divide-y divide-border">
                    {detail.tasks.map(task => (
                      <div key={task.taskId} className="grid grid-cols-[160px_1fr_120px] gap-3 px-4 py-3 text-sm">
                        <span className="text-doc-code">{task.taskNo}</span>
                        <span>{task.saleOrderNo} / {task.customerName || '—'}</span>
                        <span className="text-muted-foreground">{task.taskStatus}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section ref={printClosureRef} className="space-y-4 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-card-title">出库打印闭环</h3>
                  <p className="text-muted-body">这里统一承接箱贴条码补打、打印超时确认和波次推进卡点。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openPath(`/settings/barcode-print-query?category=outbound&keyword=${encodeURIComponent(detail?.waveNo ?? '')}`, '条码打印查询')}>
                    打开出库补打
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>
                    打开异常工作台
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <StatBlock label="包裹总数" value={printSummary?.totalPackages ?? 0} />
                <StatBlock label="已打印" value={printSummary?.successCount ?? 0} />
                <StatBlock label="打印失败" value={printSummary?.failedCount ?? 0} />
                <StatBlock label="超时待确认" value={printSummary?.timeoutCount ?? 0} />
                <StatBlock label="排队 / 打印中" value={printSummary?.processingCount ?? 0} />
              </div>
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {printSummary?.failedCount || printSummary?.timeoutCount
                  ? `当前仍有 ${Number(printSummary?.failedCount ?? 0) + Number(printSummary?.timeoutCount ?? 0)} 个出库标签需要处理。建议先补打，再继续分拣或出库。`
                  : '当前未发现阻断出库的打印异常，可继续推进波次执行。'}
                {printSummary?.recentPrinter ? ` 最近打印机：${printSummary.recentPrinter}。` : ''}
                {printSummary?.recentError ? ` 最近异常：${printSummary.recentError}。` : ''}
              </div>
            </section>

            {detail?.items?.length ? (
              <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
                <div>
                  <h3 className="text-card-title">波次商品汇总</h3>
                  <p className="text-muted-body">按商品查看应拣与已拣，快速定位缺口。</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-2">商品</th>
                      <th className="px-3 py-2 text-right">应拣</th>
                      <th className="px-3 py-2 text-right">已拣</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.items.map(item => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-xs text-muted-foreground">{item.productCode}</div>
                        </td>
                        <td className="px-3 py-2 text-right">{item.totalQty}</td>
                        <td className="px-3 py-2 text-right">{item.pickedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            {detail?.status === 1 ? <Button onClick={() => startMut.mutate(detail.id)} disabled={startMut.isPending}>开始拣货</Button> : null}
            {detail?.status === 2 ? <Button onClick={() => finishPickMut.mutate(detail.id)} disabled={finishPickMut.isPending}>完成拣货</Button> : null}
            {detail?.status === 3 ? <Button onClick={() => finishMut.mutate(detail.id)} disabled={finishMut.isPending}>完成波次</Button> : null}
            {detail && [1, 2, 3].includes(detail.status) ? (
              <Button
                variant="destructive"
                onClick={() => confirmAction({
                  title: '取消波次',
                  description: `确定取消波次「${detail.waveNo}」吗？此操作不可随意撤销。`,
                  variant: 'destructive',
                  confirmText: '取消波次',
                  onConfirm: () => cancelMut.mutate(detail.id),
                })}
                disabled={cancelMut.isPending}
              >
                取消
              </Button>
            ) : null}
            <Button variant="outline" onClick={closeDetail}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
