import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
/**
 * 批次拣货管理页
 * 路由：/picking-waves
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getWavesApi, getWaveByIdApi, startWaveApi, finishPickingApi, finishWaveApi, cancelWaveApi,
  WAVE_STATUS_LABEL, WAVE_PRIORITY_LABEL,
  type PickingWave, type WaveStatus,
} from '@/api/picking-waves'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { confirmAction } from '@/lib/confirm'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import WaveQueryDialog, { type WaveQueryValues } from './WaveQueryDialog'
import { todayYmd } from '@/lib/dateTime'

function getWaveClosureCopy(wave: PickingWave | null) {
  if (!wave) {
    return {
      stageLabel: '待选择批次',
      description: '从列表打开批次详情后，可继续查看拣货、分拣进度和箱贴打印情况。',
      nextAction: '先打开具体批次',
    }
  }

  const printSummary = wave.printSummary
  if (wave.status === 5) {
    return { stageLabel: '已取消', description: '该批次已取消，不再进行出库打印。', nextAction: '如需恢复，请重新建批次' }
  }
  if ((printSummary?.failedCount ?? 0) > 0 || (printSummary?.timeoutCount ?? 0) > 0) {
    return {
      stageLabel: '待补打',
      description: '出库箱贴存在失败或超时任务，建议先补打，再继续拣货 / 分拣 / 出库。',
      nextAction: '优先处理出库打印异常',
    }
  }
  if (wave.status === 1) {
    return { stageLabel: '待拣货', description: '批次已创建，等待仓库开始拣货。', nextAction: '安排仓库开始拣货' }
  }
  if (wave.status === 2) {
    return { stageLabel: '拣货中', description: '批次正在按路线推进，优先确认进度和卡点。', nextAction: '跟进拣货推进与异常容器' }
  }
  if (wave.status === 3) {
    return { stageLabel: '待分拣', description: '批次拣货已完成，等待后续分拣 / 复核 / 出库。', nextAction: '继续推进分拣与出库' }
  }
  if (wave.status === 4) {
    return { stageLabel: '已完成', description: '该批次已完成，仍可复盘打印和任务执行情况。', nextAction: '可回看打印与执行记录' }
  }
  return { stageLabel: wave.statusName, description: '当前批次可继续查看执行与打印信息。', nextAction: '检查主链处理状态' }
}

function StatBlock({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
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
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [page, setPage] = useState(1)
  const selectedWaveId = Number(searchParams.get('waveId') || 0) || null
  const focus = searchParams.get('focus') || ''
  const progressRef = useRef<HTMLDivElement | null>(null)
  const printClosureRef = useRef<HTMLDivElement | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['picking-waves', keyword, statusFilter, page],
    queryFn: () => getWavesApi({ keyword, page, pageSize: 20, ...(statusFilter ? { status: statusFilter } : {}) }),
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  const { data: detail } = useQuery({
    queryKey: ['picking-wave-detail', selectedWaveId],
    queryFn: () => getWaveByIdApi(selectedWaveId!),
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
  })
  const finishPickMut = useMutation({
    mutationFn: finishPickingApi,
    onSuccess: () => { toast.success('拣货完成'); invalidate() },
  })
  const finishMut = useMutation({
    mutationFn: finishWaveApi,
    onSuccess: () => { toast.success('批次已完成'); invalidate(); closeDetail() },
  })
  const cancelMut = useMutation({
    mutationFn: cancelWaveApi,
    onSuccess: () => { toast.success('已取消'); invalidate(); closeDetail() },
  })

  // 下面 columns 依赖这两个函数，不包 useCallback 的话 columns 每次渲染都要重建
  const openWaveDetail = useCallback((wave: PickingWave, nextFocus?: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('waveId', String(wave.id))
    if (nextFocus) params.set('focus', nextFocus)
    else params.delete('focus')
    setSearchParams(params)
  }, [searchParams, setSearchParams])

  function closeDetail() {
    const params = new URLSearchParams(searchParams)
    params.delete('waveId')
    params.delete('focus')
    setSearchParams(params)
  }

  const openPath = useCallback((path: string, title: string) => {
    addTab({ key: path, title, path })
    navigate(path)
  }, [addTab, navigate])

  // ── 查询弹窗筛选值 ──
  const initialQuery: WaveQueryValues = {
    keyword, status: statusFilter, warehouseId: null, startDate: todayYmd(), endDate: todayYmd(),
  }
  function applyQuery(v: WaveQueryValues) {
    setKeyword(v.keyword)
    setStatusFilter(v.status)
    setPage(1)
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setStatusFilter(''); setPage(1) }

  const chips = [
    keyword && { key: 'keyword', label: `批次号：${keyword}`, onRemove: () => setKeyword('') },
    statusFilter && { key: 'status', label: `状态：${WAVE_STATUS_LABEL[Number(statusFilter) as WaveStatus] ?? statusFilter}`, onRemove: () => setStatusFilter('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns = useMemo<TableColumn<PickingWave>[]>(() => [
    {
      key: 'waveNo',
      title: '批次单号',
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
      width: 140,
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span>,
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
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span>,
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
          primaryVariant="outline"
          items={[
            { label: '查看打印进度', onClick: () => openWaveDetail(row, 'print-closure') },
            { label: '打开出库补打', onClick: () => openPath(`/settings/barcode-print-query?category=outbound&keyword=${encodeURIComponent(row.waveNo)}`, '条码打印查询') },
          ]}
        />
      ),
    },
  ], [openPath, openWaveDetail])

  const detailCopy = getWaveClosureCopy(detail ?? null)
  const printSummary = detail?.printSummary
  const totalQty = detail?.items?.reduce((sum, item) => sum + item.totalQty, 0) ?? 0
  const pickedQty = detail?.items?.reduce((sum, item) => sum + item.pickedQty, 0) ?? 0
  const progressPct = totalQty > 0 ? Math.round((pickedQty / totalQty) * 100) : 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="批次拣货"
        description="管理批次拣货、分拣推进，以及出库箱贴打印异常的处理。"
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/picking-waves').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          </>
        }
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} rowKey="id" />
      <Pagination page={page} totalPages={totalPages} total={total} unit="个" onPageChange={setPage} />

      <Dialog open={!!selectedWaveId} onOpenChange={v => !v && closeDetail()}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              批次详情 — <span className="text-doc-code-strong">{detail?.waveNo ?? `#${selectedWaveId}`}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[75vh] space-y-5 overflow-y-auto py-2">
            <section className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">当前主链阶段：{detailCopy.stageLabel}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{detailCopy.description}</p>
                </div>
                <div className="rounded-lg border border-border bg-white px-4 py-3 text-left">
                  <p className="text-helper">下一步动作</p>
                  <p className="mt-1 font-semibold text-foreground">{detailCopy.nextAction}</p>
                </div>
              </div>
            </section>

            <section ref={progressRef} className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-card-title">批次进度</h3>
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
                <div className="rounded-lg border border-border">
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

            <section ref={printClosureRef} className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-card-title">出库箱贴打印</h3>
                  <p className="text-muted-body">在这里统一处理箱贴补打、打印超时确认，以及定位批次进度受阻环节。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openPath(`/settings/barcode-print-query?category=outbound&keyword=${encodeURIComponent(detail?.waveNo ?? '')}`, '条码打印查询')}>
                    打开出库补打
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <StatBlock label="包裹总数" value={printSummary?.totalPackages ?? 0} />
                <StatBlock label="未生成任务" value={printSummary?.noJobCount ?? 0} />
                <StatBlock label="待派发" value={printSummary?.pendingCount ?? 0} />
                <StatBlock label="已打印" value={printSummary?.successCount ?? 0} />
                <StatBlock label="打印失败" value={printSummary?.failedCount ?? 0} />
                <StatBlock label="超时待确认" value={printSummary?.timeoutCount ?? 0} />
                <StatBlock label="排队 / 打印中" value={printSummary?.processingCount ?? 0} />
              </div>
              <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {printSummary?.noJobCount
                  ? `当前有 ${printSummary.noJobCount} 个包裹未生成打印任务，请先回打包或补打入口生成可追踪任务。`
                  : printSummary?.failedCount || printSummary?.timeoutCount
                  ? `当前仍有 ${Number(printSummary?.failedCount ?? 0) + Number(printSummary?.timeoutCount ?? 0)} 个出库标签需要处理。建议先补打，再继续分拣或出库。`
                  : '当前未发现阻断出库的打印异常，可继续推进批次执行。'}
                {printSummary?.recentPrinter ? ` 最近打印机：${printSummary.recentPrinter}。` : ''}
                {printSummary?.recentError ? ` 最近异常：${printSummary.recentError}。` : ''}
              </div>
            </section>

            {detail?.items?.length ? (
              <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div>
                  <h3 className="text-card-title">批次商品汇总</h3>
                  <p className="text-muted-body">按商品查看应拣与已拣，快速定位缺口。</p>
                </div>
                <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <ProductIdentityHeaders />
                      <th className="px-3 py-2 text-right">应拣</th>
                      <th className="px-3 py-2 text-right">已拣</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.items.map(item => (
                      <tr key={item.id}>
                        <ProductIdentityCells product={item} />
                        <td className="px-3 py-2 text-right tabular-nums">{item.totalQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.pickedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </section>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            {detail?.status === 1 ? <Button onClick={() => startMut.mutate(detail.id)} disabled={startMut.isPending}>开始拣货</Button> : null}
            {detail?.status === 2 ? <Button onClick={() => finishPickMut.mutate(detail.id)} disabled={finishPickMut.isPending}>完成拣货</Button> : null}
            {detail?.status === 3 ? <Button onClick={() => finishMut.mutate(detail.id)} disabled={finishMut.isPending}>完成批次</Button> : null}
            {detail && [1, 2, 3].includes(detail.status) ? (
              <Button
                variant="destructive"
                onClick={() => confirmAction({
                  title: '取消批次',
                  description: `确定取消批次「${detail.waveNo}」吗？此操作不可随意撤销。`,
                  variant: 'destructive',
                  confirmText: '取消批次',
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

      <WaveQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
