import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getBarcodePrintRecordsApi, reprintBarcodeRecordApi } from '@/api/print-jobs'
import { printQueueFeedback, triggerPrintPoll } from '@/lib/printQueue'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { readNullableIntParam } from '@/lib/urlSearchParams'
import type { TableColumn } from '@/types'
import type { BarcodePrintCategory, BarcodePrintRecord } from '@/types/print-jobs'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { formatPrintStatus } from '@/utils/displayFormatters'
import BarcodePrintQueryDialog, { type BarcodePrintQueryValues } from './BarcodePrintQueryDialog'
import { BARCODE_PRINT_STATUS_OPTIONS } from './constants'

const CATEGORY_OPTIONS: Array<{ value: BarcodePrintCategory; label: string; hint: string }> = [
  { value: 'inbound', label: '入库条码', hint: '库存条码标签的打印记录与补打（从未打印过的不在此列）' },
  { value: 'outbound', label: '出库条码', hint: '出库箱贴 / L 条码的打印记录与补打' },
  { value: 'logistics', label: '物流条码', hint: '物流标签与面单的打印记录与补打' },
]

/** 本页列表自动刷新间隔（毫秒）。页面文案直接引用它，避免文案与轮询周期再次对不上。 */
const AUTO_REFRESH_MS = 15000

function statusBadge(job: BarcodePrintRecord['latestJob']) {
  if (!job) return <SoftStatusLabel label="未生成打印任务" tone="draft" />
  if (job.statusKey === 'unassigned') return <SoftStatusLabel label="未配置打印机" tone="warning" />
  if (job.statusKey === 'success')   return <SoftStatusLabel label="已打印"     tone="success" />
  if (job.statusKey === 'timeout')   return <SoftStatusLabel label="超时待确认" tone="warning" />
  if (job.statusKey === 'failed')    return <SoftStatusLabel label="打印失败"   tone="danger" />
  if (job.statusKey === 'cancelled') return <SoftStatusLabel label="已取消"     tone="danger" />
  if (job.statusKey === 'printing')  return <SoftStatusLabel label="打印中"     tone="active" />
  return <SoftStatusLabel label="待派发" tone="draft" />
}

export default function BarcodePrintQueryPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialCategory = (searchParams.get('category') as BarcodePrintCategory | null) || 'inbound'
  const initialInboundTaskId = readNullableIntParam(searchParams, 'inboundTaskId') ?? undefined
  const initialInboundTaskItemId = readNullableIntParam(searchParams, 'inboundTaskItemId') ?? undefined
  const initialKeyword = searchParams.get('keyword') || ''
  const [category, setCategory] = useState<BarcodePrintCategory>(initialCategory)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [status, setStatus] = useState('__all__')
  const [queryOpen, setQueryOpen] = useState(false)
  const isActiveTab = useActiveWorkspaceTab()

  const query = useQuery({
    queryKey: ['barcode-print-records', category, keyword, status, initialInboundTaskId, initialInboundTaskItemId],
    queryFn: () => getBarcodePrintRecordsApi({
      category,
      keyword,
        status: status === '__all__' ? undefined : status,
      page: 1,
      // 不要在这里指定 pageSize（2026-09-18 审计 P2）：列表走 payloadClient 的自动取齐，
      // 它会按 ceil(总数 / 批量) 串行请求。原先写死 pageSize: 20，相当于把批量从默认 200 缩到 20、
      // 请求数放大 10 倍；再叠加轮询（当时为 3 秒，现为 AUTO_REFRESH_MS），
      // 约 1000 条记录就是 50 次/轮 ≈ 1000 次/分，
      // 恰好打满全局 IP 限流（app.js 默认 1000 次/60 秒）。限流按 IP，同一出口的整个办公室
      // （多台 PDA/桌面端）会一起被限流，所有业务接口开始返回「请求过于频繁」。
      // 省略后回到默认批量 200。
      inboundTaskId: category === 'inbound' ? initialInboundTaskId : undefined,
      inboundTaskItemId: category === 'inbound' ? initialInboundTaskItemId : undefined,
    }),
    enabled: isActiveTab,
    // 轮询间隔与其它记录类页面（PDA 10–30s）对齐：这是「查看打印记录」页，
    // 没有 3 秒级实时性要求，而这个间隔直接乘在每轮的串行请求数上。
    refetchInterval: isActiveTab ? AUTO_REFRESH_MS : false,
  })
  const total = query.data?.pagination?.total ?? 0

  // ── 查询弹窗筛选值 ──
  const initialQuery: BarcodePrintQueryValues = { keyword, status }
  function applyQuery(v: BarcodePrintQueryValues) {
    setKeyword(v.keyword)
    setStatus(v.status);
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setStatus('__all__'); }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    status !== '__all__' && { key: 'status', label: `状态：${BARCODE_PRINT_STATUS_OPTIONS.find(s => s.value === status)?.label ?? status}`, onRemove: () => setStatus('__all__') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const reprintMut = useMutation({
    mutationFn: (row: BarcodePrintRecord) => reprintBarcodeRecordApi({
      category: row.category,
      recordId: row.recordId,
    }, { skipGlobalError: true }),
    onSuccess: (d) => {
      if (!d) return
      if (!d.queued) {
        // 2026-09-14：没有打印机时后端也会留一条失败记录（保证对象始终有打印记录），
        // 所以这里不再说「未创建任务」，而是提示先去绑定打印机。
        toast.warning('未绑定可用打印机，本次未出纸；记录已保留，绑定打印机后可再补打')
        qc.invalidateQueries({ queryKey: ['barcode-print-records'] })
        qc.invalidateQueries({ queryKey: ['print-jobs'] })
        return
      }
      triggerPrintPoll()
      const fb = printQueueFeedback(d.dispatchHint)
      if (fb.level === 'warning') toast.warning(fb.message)
      else toast.success(fb.message)
      qc.invalidateQueries({ queryKey: ['barcode-print-records'] })
      qc.invalidateQueries({ queryKey: ['print-jobs'] })
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '重新打印失败')
    },
  })

  // columns 依赖它，不包 useCallback 的话 columns 每次渲染都要重建
  const openPath = useCallback((path: string, title: string) => {
    addTab({ key: path, title, path })
    navigate(path)
  }, [addTab, navigate])

  // 解构出稳定的 mutate 与需要的状态位：直接依赖整个 reprintMut 对象会让 columns
  // 每次渲染重建（该对象引用不稳定）
  const { mutate: reprint, isPending: reprinting, variables: reprintingRow } = reprintMut

  const columns = useMemo<TableColumn<BarcodePrintRecord>[]>(() => {
    const bizTitle =
      category === 'inbound' ? '入库单号'
        : category === 'outbound' ? '出库任务'
          : '物流单号'
    return [
      {
        key: 'barcode',
        title: '条码',
        width: 150,
        render: (_, row) => (
          <div className="space-y-1">
            <div className="text-doc-code-strong">{row.barcode}</div>
            <div className="text-[11px] text-muted-foreground">{row.barcodeKind}</div>
          </div>
        ),
      },
      {
        key: 'title',
        title: category === 'inbound' ? '商品信息' : '业务信息',
        render: (_, row) => (
          <div className="space-y-1">
            <div className="font-medium">{row.title}</div>
            {row.subtitle && <div className="text-xs text-muted-foreground">{row.subtitle}</div>}
          </div>
        ),
      },
      {
        key: 'bizNo',
        title: bizTitle,
        width: 140,
        render: (_, row) => row.bizNo ? <span className="text-doc-code">{row.bizNo}</span> : <span className="text-muted-foreground">—</span>,
      },
      {
        key: 'warehouseName',
        title: '仓库 / 位置',
        width: 160,
        render: (_, row) => (
          <div className="space-y-1 text-sm">
            <div>{row.warehouseName ?? '—'}</div>
            <div className="text-xs text-muted-foreground">{row.locationCode || row.extraInfo || '—'}</div>
          </div>
        ),
      },
      {
        key: 'latestJob',
        title: '打印状态',
        width: 120,
        render: (_, row) => statusBadge(row.latestJob),
      },
      {
        key: 'printer',
        title: '打印机 / 结果',
        width: 220,
        render: (_, row) => (
          <div className="space-y-1 text-sm">
            <div>{row.latestJob?.printerName ?? (row.latestJob?.printerCode ? '已绑定打印机' : '—')}</div>
            <div className="text-xs leading-5 text-muted-foreground break-words" title={row.latestJob?.errorMessage ?? row.latestJob?.printStateLabel ?? undefined}>
              {formatPrintStatus(row.latestJob?.statusKey, row.latestJob?.printStateLabel, row.latestJob?.errorMessage)}
            </div>
            {row.latestJob?.printerCode && (
              <div className="text-[11px] text-muted-foreground">打印机编号：{row.latestJob.printerCode}</div>
            )}
          </div>
        ),
      },
      {
        key: 'createdAt',
        title: '最近变化',
        width: 150,
        render: (_, row) => formatDisplayDateTime(row.latestJob?.updatedAt || row.createdAt),
      },
      {
        key: 'action',
        title: '操作',
        width: 210,
        render: (_, row) => {
          const isReprinting = reprinting && reprintingRow?.recordId === row.recordId
          return (
            <TableActionsMenu
              primaryLabel={isReprinting ? '处理中…' : '重新打印'}
              primaryVariant="outline"
              primaryDisabled={!row.canReprint || isReprinting}
              onPrimaryClick={() => reprint(row)}
              items={[
                ...(row.category === 'inbound' && row.inboundTaskId
                  ? [{ label: '打开收货详情', onClick: () => openPath(`/inbound-tasks/${row.inboundTaskId}?focus=print-batches`, row.bizNo || `收货订单 #${row.inboundTaskId}`) }]
                  : []),
                ...(row.category === 'outbound' && row.waveId
                  ? [{ label: '打开批次详情', onClick: () => openPath(`/picking-waves?waveId=${row.waveId}&focus=print-closure`, row.waveNo || `批次 #${row.waveId}`) }]
                  : []),
              ]}
            />
          )
        },
      },
    ]
  }, [category, reprinting, reprintingRow, reprint, openPath])

  const rows = useMemo(() => query.data?.list ?? [], [query.data])
  const inboundContext = useMemo(() => {
    if (category !== 'inbound' || !initialInboundTaskId) return null
    const taskId = initialInboundTaskId
    const taskRows = rows.filter(row => row.inboundTaskId === taskId)
    const unassignedCount = taskRows.filter(row => row.latestJob?.statusKey === 'unassigned').length
    const failedCount = taskRows.filter(row => row.latestJob?.statusKey === 'failed').length
    const timeoutCount = taskRows.filter(row => row.latestJob?.statusKey === 'timeout').length
    const printingCount = taskRows.filter(row => row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued').length
    const taskNo = taskRows[0]?.bizNo ?? `#${taskId}`
    return {
      taskId,
      taskNo,
      unassignedCount,
      failedCount,
      timeoutCount,
      printingCount,
    }
  }, [category, initialInboundTaskId, rows])
  const outboundContext = useMemo(() => {
    if (category !== 'outbound') return null
    const waveId = rows.find(row => row.waveId)?.waveId
    if (!waveId) return null
    const waveNo = rows.find(row => row.waveId === waveId)?.waveNo ?? `#${waveId}`
    const unassignedCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'unassigned').length
    const failedCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'failed').length
    const timeoutCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'timeout').length
    const printingCount = rows.filter(row => row.waveId === waveId && (row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued')).length
    return { waveId, waveNo, unassignedCount, failedCount, timeoutCount, printingCount }
  }, [category, rows])
  const logisticsContext = useMemo(() => {
    if (category !== 'logistics') return null
    const unassignedCount = rows.filter(row => row.latestJob?.statusKey === 'unassigned').length
    const failedCount = rows.filter(row => row.latestJob?.statusKey === 'failed').length
    const timeoutCount = rows.filter(row => row.latestJob?.statusKey === 'timeout').length
    const printingCount = rows.filter(row => row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued').length
    return {
      unassignedCount,
      failedCount,
      timeoutCount,
      printingCount,
      latestBizNo: rows[0]?.bizNo ?? null,
    }
  }, [category, rows])

  return (
    <div className="space-y-5">
      <PageHeader
        title="条码打印查询"
        description="查询入库条码、出库条码、物流条码的打印状态，支持失败追踪与丢失补打。"
        actions={<Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>}
      />

      {inboundContext && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">当前正在处理收货打印任务</p>
              <p className="mt-1 text-sm text-muted-foreground">
                收货订单 <span className="text-doc-code">{inboundContext.taskNo}</span> 的库存条码都在这里追踪。先绑定缺失的打印机，再处理失败 / 超时的打印任务，再回到收货详情继续上架。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openPath(`/inbound-tasks/${inboundContext.taskId}?focus=print-batches`, `收货订单 ${inboundContext.taskNo}`)}
              >
                返回收货详情
              </Button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-warning/20 bg-background px-4 py-3">
              <p className="text-helper">未配置打印机</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.unassignedCount}</p>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-background px-4 py-3">
              <p className="text-helper">打印失败</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.failedCount}</p>
            </div>
            <div className="rounded-lg border border-warning/20 bg-background px-4 py-3">
              <p className="text-helper">超时待确认</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.timeoutCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-helper">仍在排队 / 打印中</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.printingCount}</p>
            </div>
          </div>
        </div>
      )}

      {outboundContext && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">当前正在处理出库打印任务</p>
              <p className="mt-1 text-sm text-muted-foreground">
                批次 <span className="text-doc-code">{outboundContext.waveNo}</span> 的出库箱贴都在这里追踪。先绑定缺失的打印机，再处理失败 / 超时的打印任务，再回到批次详情继续拣货与分拣。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openPath(`/picking-waves?waveId=${outboundContext.waveId}&focus=print-closure`, `批次 ${outboundContext.waveNo}`)}
              >
                返回批次详情
              </Button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-warning/20 bg-background px-4 py-3">
              <p className="text-helper">未配置打印机</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.unassignedCount}</p>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-background px-4 py-3">
              <p className="text-helper">打印失败</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.failedCount}</p>
            </div>
            <div className="rounded-lg border border-warning/20 bg-background px-4 py-3">
              <p className="text-helper">超时待确认</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.timeoutCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-helper">仍在排队 / 打印中</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.printingCount}</p>
            </div>
          </div>
        </div>
      )}

      {logisticsContext && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">当前正在处理物流标签打印任务</p>
              <p className="mt-1 text-sm text-muted-foreground">
                物流标签打印异常会直接影响现场出库确认。建议先绑定缺失的打印机，再处理失败 / 超时，再由现场继续扫描物流条码完成出库。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>
                打开异常工作台
              </Button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-warning/20 bg-background px-4 py-3">
              <p className="text-helper">未配置打印机</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.unassignedCount}</p>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-background px-4 py-3">
              <p className="text-helper">打印失败</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.failedCount}</p>
            </div>
            <div className="rounded-lg border border-warning/20 bg-background px-4 py-3">
              <p className="text-helper">超时待确认</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.timeoutCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-helper">仍在排队 / 打印中</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.printingCount}</p>
            </div>
          </div>
          {logisticsContext.latestBizNo ? (
            <p className="text-xs text-muted-foreground">最近物流编码：<span className="text-doc-code">{logisticsContext.latestBizNo}</span></p>
          ) : null}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {CATEGORY_OPTIONS.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setCategory(item.value);
            }}
            className={[
              'rounded-lg border p-4 text-left transition-colors',
              category === item.value
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:bg-muted/40',
            ].join(' ')}
          >
            <div className="font-semibold text-foreground">{item.label}</div>
            <div className="mt-1 text-sm text-muted-foreground leading-relaxed">{item.hint}</div>
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
          {(initialInboundTaskId || initialInboundTaskItemId) && category === 'inbound' && (
            <span className="ml-auto text-helper">
              当前按收货订单筛选
              {initialInboundTaskId ? ` #${initialInboundTaskId}` : ''}
              {initialInboundTaskItemId ? ` / 明细 #${initialInboundTaskItemId}` : ''}
            </span>
          )}
        </div>
      )}

      <DataTable
        virtualized
        columns={columns}
        data={rows}
        loading={query.isLoading}
        rowKey="recordId"
      />
      <ListSummary total={total} unit="条" />

      {<div className="px-1 text-helper">状态每 {AUTO_REFRESH_MS / 1000} 秒自动刷新</div>}

      <BarcodePrintQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
