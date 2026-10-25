import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { submitReprintIntent, getReprintIntent, reprintOwnerIdentity, subscribeReprintIntents, reprintIntentRevision, listReprintIntents } from '@/lib/printReprintIntent'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useContext, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Search, PackageOpen, PackageCheck, Truck } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
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
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { resolveRouteTitle } from '@/router/routeDefinitions'
import { formatPrintStatus } from '@/utils/displayFormatters'
import PrintRequestDetails from './PrintRequestDetails'
import BarcodePrintQueryDialog, { type BarcodePrintQueryValues } from './BarcodePrintQueryDialog'
import { BARCODE_PRINT_STATUS_OPTIONS } from './constants'

const CATEGORY_OPTIONS: Array<{ value: BarcodePrintCategory; label: string; hint: string }> = [
  { value: 'inbound', label: '入库条码', hint: '库存条码标签的打印记录与补打；历史缺失时可查找有效收货来源恢复标签' },
  { value: 'outbound', label: '出库条码', hint: '出库箱贴 / L 条码的打印记录与补打' },
  { value: 'logistics', label: '物流条码', hint: '物流标签与面单的打印记录与补打' },
]

/** 本页列表自动刷新间隔（毫秒）。页面文案直接引用它，避免文案与轮询周期再次对不上。 */
const AUTO_REFRESH_MS = 15000

function safeId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
}

function jobNextStep(job: BarcodePrintRecord['latestJob']) {
  if (job?.statusKey === 'success') return '客户端已回报成功，请现场核对标签纸张。'
  if (job?.statusKey === 'queued' || job?.statusKey === 'printing') return '打印结果尚待确认，请核对工作站和现场纸张，避免重复打印。'
  if (job?.statusKey === 'failed' || job?.statusKey === 'timeout') return '先核对工作站、打印机和纸张，确认需要后再使用本页既有补打。'
  return null
}

/** 「最近一次打印任务自身的结果」。注意它**不包含**条码的业务状态（见 barcodeStatusBadge）。 */
function jobStatusBadge(job: BarcodePrintRecord['latestJob']) {
  if (!job) return <SoftStatusLabel label="未生成打印任务" tone="draft" />
  if (job.statusKey === 'unassigned') return <SoftStatusLabel label="未配置打印机" tone="warning" />
  if (job.statusKey === 'success')    return <SoftStatusLabel label="已打印"     tone="success" />
  if (job.statusKey === 'timeout')    return <SoftStatusLabel label="超时待确认" tone="warning" />
  if (job.statusKey === 'failed')     return <SoftStatusLabel label="打印失败"   tone="danger" />
  // 因容器作废被撤回终结：不是「打印失败」，而是从未出纸。
  if (job.statusKey === 'voided_job') return <SoftStatusLabel label="未出纸"     tone="danger" />
  if (job.statusKey === 'cancelled')  return <SoftStatusLabel label="已取消"     tone="danger" />
  if (job.statusKey === 'printing')   return <SoftStatusLabel label="打印中"     tone="active" />
  return <SoftStatusLabel label="待派发" tone="draft" />
}

/**
 * 状态列：条码的**业务状态**（入库条码由后端给 `barcodeStatusKey`）。
 * 作废与「最近任务结果」是两件事——作废容器既有的任务可能仍显示「已打印」，
 * 所以这里只画业务状态，任务结果留在「打印机 / 最近任务」列里单独展示。
 * 出库/物流条码没有行级业务状态，退回任务结果，行为与改动前一致。
 */
function barcodeStatusBadge(record: BarcodePrintRecord) {
  const key = record.barcodeStatusKey
  // 容器作废：打印历史保留并照常显示，但不能再补打（后端补打接口另有独立拒绝，按钮禁用只是提前告知）
  if (key === 'voided') return <SoftStatusLabel label="条码已作废" tone="danger" />
  if (key === 'cancelled') return <SoftStatusLabel label="已取消" tone="danger" />
  return jobStatusBadge(record.latestJob)
}

export default function BarcodePrintQueryPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const qc = useQueryClient()
  const { can } = usePermission()
  const canReprint = can(PERMISSIONS.PRINT_JOB_REPRINT)
  const canViewInbound = can(PERMISSIONS.INBOUND_ORDER_VIEW)
  const canViewWave = can(PERMISSIONS.PICKING_WAVE_VIEW)
  const canViewReport = can(PERMISSIONS.REPORT_VIEW)
  const [locationParams] = useSearchParams()
  const tabPath = useContext(TabPathContext)
  const searchParams = tabPath ? new URLSearchParams(tabPath.split('?')[1] ?? '') : locationParams
  const initialCategory = (searchParams.get('category') as BarcodePrintCategory | null) || 'inbound'
  const initialInboundTaskId = readNullableIntParam(searchParams, 'inboundTaskId') ?? undefined
  const initialInboundTaskItemId = readNullableIntParam(searchParams, 'inboundTaskItemId') ?? undefined
  const initialKeyword = searchParams.get('keyword') || ''
  const [category, setCategory] = useState<BarcodePrintCategory>(initialCategory)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [status, setStatus] = useState('__all__')
  const [queryOpen, setQueryOpen] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [confirm, setConfirm] = useState<{ row: BarcodePrintRecord; key: string | null; owner: string; another: boolean } | null>(null)
  const confirmTrigger = useRef<HTMLElement | null>(null)
  const queryTrigger = useRef<HTMLButtonElement>(null)
  const openConfirm = useCallback((value: NonNullable<typeof confirm>) => {
    confirmTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirm(value)
  }, [])
  useSyncExternalStore(subscribeReprintIntents, reprintIntentRevision)
  const storedIntents = listReprintIntents().filter(info => info.resource.startsWith(`barcode:${category}:`))
  const isActiveTab = useActiveWorkspaceTab()
  const activeTabRef = useRef(isActiveTab)
  activeTabRef.current = isActiveTab
  const focusQuery = useCallback(() => {
    if (activeTabRef.current) queryTrigger.current?.focus({ preventScroll: true })
  }, [])
  const hasInboundHandoff = category === 'inbound' && !!(initialInboundTaskId || initialInboundTaskItemId)

  const query = useQuery({
    queryKey: ['barcode-print-records', category, recovery, keyword, status, initialInboundTaskId, initialInboundTaskItemId],
    queryFn: () => getBarcodePrintRecordsApi({
      category,
      recovery: category === 'inbound' && recovery,
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
    enabled: isActiveTab && (!recovery || !!keyword || !!initialInboundTaskId || !!initialInboundTaskItemId),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    // 轮询间隔与其它记录类页面（PDA 10–30s）对齐：这是「查看打印记录」页，
    // 没有 3 秒级实时性要求，而这个间隔直接乘在每轮的串行请求数上。
    refetchInterval: isActiveTab ? AUTO_REFRESH_MS : false,
  })
  const canOperate = isActiveTab && !!query.data && !query.isFetching && !query.isPaused && !query.isError
  const total = query.data?.pagination?.total ?? 0
  const awaitingRecoveryQuery = recovery && !keyword && !initialInboundTaskId && !initialInboundTaskItemId
  const currentCategory = CATEGORY_OPTIONS.find(item => item.value === category)

  // ── 查询弹窗筛选值 ──
  const initialQuery = useMemo<BarcodePrintQueryValues>(() => ({ keyword, status }), [keyword, status])
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
    mutationFn: ({ row, another = false, expectedKey, expectedOwner, queryOnly = false }: { row: BarcodePrintRecord; another?: boolean; expectedKey?: string | null; expectedOwner?: string; queryOnly?: boolean }) => {
      const current = query.data?.list.find(item => item.category === row.category && item.recordId === row.recordId)
      if (!canOperate || !canReprint || !safeId(row.recordId) || !queryOnly && !current?.canReprint) throw new Error('请先重新读取并核对打印记录')
      const original = getReprintIntent(`barcode:${row.category}:${row.recordId}`)
      const saved = original && 'payload' in original ? original.payload as { category?: string; recordId?: number; recovery?: boolean } : null
      const recover = !another && saved ? saved.recovery === true : row.canRecover === true
      const payload = { category: row.category, recordId: row.recordId, ...(recover ? { recovery: true } : {}) }
      return submitReprintIntent(`barcode:${row.category}:${row.recordId}`, payload, (key, config) => reprintBarcodeRecordApi(payload, config, key), result => result.category === row.category && result.recordId === row.recordId && Number.isSafeInteger(result.requestId), { newIntent: another, expectedKey, expectedOwner, queryOnly })
    },
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
      toast.error((e as { message?: string }).message ?? '补打结果未确认，请按原条码重试')
    },
  })

  // columns 依赖它，不包 useCallback 的话 columns 每次渲染都要重建
  const openPath = useCallback((path: string, title: string) => {
    if (!canOperate) return
    const target = buildWorkspaceTabRegistrationFromPath(path)
    addTab({ ...target, title: resolveRouteTitle(target.path.split('?')[0]) || title })
    navigate(target.path)
  }, [addTab, navigate, canOperate])

  // 解构出稳定的 mutate 与需要的状态位：直接依赖整个 reprintMut 对象会让 columns
  // 每次渲染重建（该对象引用不稳定）
  const { mutate: reprint, isPending: reprinting, variables: reprintingRequest } = reprintMut

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
        title: '条码状态',
        width: 130,
        render: (_, row) => (
          <div className="space-y-1">
            {barcodeStatusBadge(row)}
            {/* 作废原因跟着**业务状态**走（解释为什么这张条码不能再补打），不跟任务结果混在一起 */}
            {row.voidReason && (
              <div className="text-[11px] leading-4 text-muted-foreground">原因：{row.voidReason}</div>
            )}
          </div>
        ),
      },
      {
        key: 'printer',
        title: '打印机 / 最近任务',
        width: 220,
        render: (_, row) => (
          <div className="space-y-1 text-sm">
            <div>{row.latestJob?.printerName ?? (row.latestJob?.printerCode ? '已绑定打印机' : '—')}</div>
            <div className="text-xs leading-5 text-muted-foreground break-words" title={row.latestJob?.errorMessage ?? row.latestJob?.printStateLabel ?? undefined}>
              {/* 明确标注是「任务」结果：与左侧的条码业务状态并列而非互相覆盖 */}
              {row.latestJob
                ? `最近任务：${formatPrintStatus(row.latestJob.statusKey, row.latestJob.printStateLabel, row.latestJob.errorMessage)}`
                : '无打印任务'}
            </div>
            {row.latestJob?.printerCode && (
              <div className="text-[11px] text-muted-foreground">打印机编号：{row.latestJob.printerCode}</div>
            )}
            <PrintRequestDetails job={row.latestJob} />
            {jobNextStep(row.latestJob) && <p className="text-xs leading-5 text-muted-foreground">{jobNextStep(row.latestJob)}</p>}
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
          const isReprinting = reprinting && reprintingRequest?.row.recordId === row.recordId
          const intent = storedIntents.find(info => info.resource === `barcode:${row.category}:${row.recordId}`) ?? null
          return (
            <TableActionsMenu
              onUnavailableFocus={focusQuery}
              primaryLabel={isReprinting ? '处理中…' : intent ? '核对原补打' : row.canRecover ? '恢复标签' : '重新打印'}
              primaryVariant="outline"
              primaryDisabled={!canOperate || !canReprint || !safeId(row.recordId) || !row.canReprint || isReprinting}
              onPrimaryClick={() => {
                if (row.canRecover && !intent) openConfirm({ row, key: null, owner: reprintOwnerIdentity(), another: false })
                else reprint({ row })
              }}
              items={[
                ...(intent && canOperate && canReprint && row.canReprint && !isReprinting ? [{ label: '明确另补一份', afterMenuClose: true, onClick: () => openConfirm({ row, key: intent.key, owner: reprintOwnerIdentity(), another: true }) }] : []),
                ...(canOperate && canViewInbound && row.category === 'inbound' && safeId(row.inboundTaskId)
                  ? [{ label: '打开收货详情', onClick: () => openPath(`/inbound-tasks/${row.inboundTaskId}?focus=print-batches`, row.bizNo || `收货订单 #${row.inboundTaskId}`) }]
                  : []),
                ...(canOperate && canViewWave && row.category === 'outbound' && safeId(row.waveId)
                  ? [{ label: '打开批次详情', onClick: () => openPath(`/picking-waves?waveId=${row.waveId}&focus=print-closure`, row.waveNo || `批次 #${row.waveId}`) }]
                  : []),
              ]}
            />
          )
        },
      },
    ]
  }, [storedIntents, category, reprinting, reprintingRequest, reprint, openPath, openConfirm, focusQuery, canOperate, canReprint, canViewInbound, canViewWave])

  const handoffReading = hasInboundHandoff && (query.isFetching || query.isPaused || query.isError)
  const rows = useMemo(() => handoffReading ? [] : query.data?.list ?? [], [query.data, handoffReading])
  const inboundContext = useMemo(() => {
    if (category !== 'inbound' || !safeId(initialInboundTaskId) || !canOperate) return null
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
  }, [category, initialInboundTaskId, rows, canOperate])
  const outboundContext = useMemo(() => {
    if (category !== 'outbound' || !canOperate) return null
    const waveId = rows.find(row => safeId(row.waveId))?.waveId
    if (!safeId(waveId)) return null
    const waveNo = rows.find(row => row.waveId === waveId)?.waveNo ?? `#${waveId}`
    const unassignedCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'unassigned').length
    const failedCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'failed').length
    const timeoutCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'timeout').length
    const printingCount = rows.filter(row => row.waveId === waveId && (row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued')).length
    return { waveId, waveNo, unassignedCount, failedCount, timeoutCount, printingCount }
  }, [category, rows, canOperate])
  const logisticsContext = useMemo(() => {
    if (category !== 'logistics' || !canOperate) return null
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
  }, [category, rows, canOperate])

  return (
    <div className="fc-print-query-page space-y-4" style={{ overflowAnchor: 'none' }}>
      <PageHeader
        title="条码打印查询"
        description={`${recovery ? '按库存条码、商品或收货单号查询。仅恢复有有效收货单及明细的现存条码；不新建库存。请先核对现场标签。' : currentCategory?.hint ?? ''} 业务完成与条码业务状态不代表已出纸；最近打印任务单独展示。客户端成功回报后仍需现场核对纸张，失败或超时先核对工作站、打印机和纸张。`}
      />

      <section className="fc-list-workbench min-w-0 rounded-xl border border-border bg-card" aria-label="条码打印记录">
        <div className="fc-list-toolbar">
          <div className="fc-segmented-control" role="group" aria-label="条码类别">
            {CATEGORY_OPTIONS.map(item => (
              <button
                key={item.value}
                type="button"
                aria-pressed={category === item.value}
                title={item.hint}
                onClick={() => { setCategory(item.value); setRecovery(false) }}
                className="fc-segmented-option"
              >
                {item.value === 'inbound' ? <PackageOpen className="h-4 w-4 shrink-0" aria-hidden /> : item.value === 'outbound' ? <PackageCheck className="h-4 w-4 shrink-0" aria-hidden /> : <Truck className="h-4 w-4 shrink-0" aria-hidden />}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="fc-list-toolbar-actions">
            {category === 'inbound' && <Button variant="ghost" onClick={() => { setRecovery(v => !v); setStatus('__all__') }}>{recovery ? '返回打印历史' : '恢复收货标签'}</Button>}
            <Button ref={queryTrigger} variant="outline" onClick={() => setQueryOpen(true)}><Search className="mr-1.5 h-4 w-4" aria-hidden />查询</Button>
          </div>
        </div>
        {(initialInboundTaskId || initialInboundTaskItemId) && category === 'inbound' && <div className="fc-list-query-context">
          <p className="font-medium">
            当前按收货订单筛选
            {initialInboundTaskId ? ` #${initialInboundTaskId}` : ''}
            {initialInboundTaskItemId ? ` / 明细 #${initialInboundTaskItemId}` : ''}
          </p>
        </div>}
        {chips.length > 0 && (
          <div className="fc-list-filter-chips flex flex-wrap items-center gap-2">
            {chips.map(c => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                {c.label}
                <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
          </div>
        )}

        {!canOperate && !awaitingRecoveryQuery && <div className="fc-list-read-state space-y-2 text-sm" role={query.isError ? 'alert' : 'status'}>
          <p>{query.isError ? '打印记录读取失败，无法核对最新状态；旧记录暂不提供操作。' : query.isPaused ? '网络已暂停，等待恢复后重新读取打印记录。' : query.isFetching ? hasInboundHandoff ? '正在重新读取原收货单的打印记录…' : '正在重新读取打印记录，旧记录待核对，暂不提供操作。' : '最新打印记录尚待核对，暂不提供操作。'}</p>
          {query.isError && <Button variant="outline" onClick={() => void query.refetch()}>重新读取打印记录</Button>}
        </div>}
        {inboundContext && (
          <div className="fc-print-context space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">当前正在处理收货打印任务</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  收货订单 <span className="text-doc-code">{inboundContext.taskNo}</span> 的库存条码都在这里追踪。先绑定缺失的打印机，再处理失败 / 超时的打印任务，再回到收货详情继续上架。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canViewInbound && <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openPath(`/inbound-tasks/${inboundContext.taskId}?focus=print-batches`, `收货订单 ${inboundContext.taskNo}`)}
                >
                  返回收货详情
                </Button>}
              </div>
            </div>
            <div className="fc-print-context-counts grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
              <div className="min-w-0">
                <p className="text-helper">未配置打印机</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.unassignedCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">打印失败</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.failedCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">超时待确认</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.timeoutCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">仍在排队 / 打印中</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{inboundContext.printingCount}</p>
              </div>
            </div>
          </div>
        )}

        {outboundContext && (
          <div className="fc-print-context space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">当前正在处理出库打印任务</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  批次 <span className="text-doc-code">{outboundContext.waveNo}</span> 的出库箱贴都在这里追踪。先绑定缺失的打印机，再处理失败 / 超时的打印任务，再回到批次详情继续拣货与分拣。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canViewWave && <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openPath(`/picking-waves?waveId=${outboundContext.waveId}&focus=print-closure`, `批次 ${outboundContext.waveNo}`)}
                >
                  返回批次详情
                </Button>}
              </div>
            </div>
            <div className="fc-print-context-counts grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
              <div className="min-w-0">
                <p className="text-helper">未配置打印机</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.unassignedCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">打印失败</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.failedCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">超时待确认</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.timeoutCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">仍在排队 / 打印中</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{outboundContext.printingCount}</p>
              </div>
            </div>
          </div>
        )}

        {logisticsContext && (
          <div className="fc-print-context space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">当前正在处理物流标签打印任务</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  这里展示物流类别记录，需逐条核对原业务。先核对工作站、打印机和纸张，再处理失败 / 超时；取号与业务完成均不代表标签已出纸。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canViewReport && <Button size="sm" variant="ghost" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>
                  打开异常工作台
                </Button>}
              </div>
            </div>
            <div className="fc-print-context-counts grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
              <div className="min-w-0">
                <p className="text-helper">未配置打印机</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.unassignedCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">打印失败</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.failedCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">超时待确认</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.timeoutCount}</p>
              </div>
              <div className="min-w-0">
                <p className="text-helper">仍在排队 / 打印中</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{logisticsContext.printingCount}</p>
              </div>
            </div>
            {logisticsContext.latestBizNo ? (
              <p className="text-xs text-muted-foreground">最近物流编码：<span className="text-doc-code">{logisticsContext.latestBizNo}</span></p>
            ) : null}
          </div>
        )}

        {storedIntents.length > 0 && <div className="fc-list-read-state text-sm" role="status">
          <p>存在已保留的补打意图。“核对原补打”查询或恢复原结果，不静默另建任务。未知或过期结果须核对原任务及现场纸张；确需增加一份时，请在该行操作菜单明确选择“另补一份”。</p>
          {storedIntents.filter(info => info.phase === 'pending').map(info => <div key={info.resource} className="mt-2 flex flex-wrap items-center gap-2">
            <span>原条码记录 #{info.resource.split(':').at(-1)}：{info.expired ? '原意图已过期，结果仍未知，禁止按旧意图重建。' : '原结果尚未确认。'}</span>
            {'payload' in info && <Button size="sm" variant="outline" disabled={!canOperate || !canReprint || reprinting} onClick={() => {
              const payload = info.payload as { category: BarcodePrintCategory; recordId: number; recovery?: boolean }
              reprint({ row: { category: payload.category, recordId: payload.recordId, canRecover: payload.recovery === true } as BarcodePrintRecord, queryOnly: true })
            }}>查询原结果</Button>}
          </div>)}
          {!rows.length && <p className="mt-2">历史记录缺失时，选择“恢复收货标签”并按实物条码查询有效来源。原意图在此保留，查询失败不会另建任务。</p>}
        </div>}
        <ConfirmDialog
          open={!!confirm}
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (!activeTabRef.current) return
            const target = confirmTrigger.current
            confirmTrigger.current = null
            if (target?.isConnected && !target.matches(':disabled') && target.getClientRects().length) target.focus({ preventScroll: true })
            else queryTrigger.current?.focus({ preventScroll: true })
          }}
          title={confirm?.another ? '明确另补一份' : '恢复收货标签'}
          description={`${confirm?.row.barcode ?? ''}：${confirm?.another ? '原补打可能已经入队或出纸。此操作明确创建另一份标签，请先核对原任务和现场纸张。' : '历史打印记录已缺失，将根据有效收货来源恢复此库存条码的标签。请确认现场确需标签。'}`}
          confirmText={confirm?.another ? '确认另补一份' : '确认恢复标签'}
          loading={reprinting}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { if (confirm) reprint({ row: confirm.row, another: confirm.another, expectedKey: confirm.key, expectedOwner: confirm.owner }, { onSuccess: () => setConfirm(null) }) }}
        />
        <DataTable
          virtualized
          columns={columns}
          data={rows}
          loading={query.isLoading || (handoffReading && (query.isFetching || query.isPaused))}
          rowKey="recordId"
          emptyState={<EmptyState
            variant={query.isError ? 'error' : chips.length || recovery ? 'no-result' : 'no-data'}
            title={query.isError ? '打印记录暂不可用' : query.isPaused ? '等待网络恢复' : awaitingRecoveryQuery ? '先查询有效收货来源' : recovery ? '未找到可恢复的收货标签' : chips.length || hasInboundHandoff ? '未找到匹配的打印记录' : `暂无${currentCategory?.label ?? '条码'}打印记录`}
            description={query.isError ? '请重新读取打印记录，确认最新状态后再操作。' : query.isPaused ? '网络恢复后会重新读取，当前不能确认最新打印结果。' : awaitingRecoveryQuery ? '输入库存条码、商品或收货单号后查找；查询不会新建库存或自动打印。' : recovery ? '请核对查询条件与有效收货来源；未找到记录不代表需要新建库存。' : chips.length || hasInboundHandoff ? '请核对当前类别和查询范围，或调整筛选条件后重试。' : '本类别当前没有打印记录；切换类别或使用查询查找。'}
            action={awaitingRecoveryQuery ? <Button variant="outline" onClick={() => setQueryOpen(true)}>输入恢复查询条件</Button> : undefined}
          />}
        />
      </section>
      <div className="fc-list-footer">
          {canOperate ? <ListSummary total={total} unit="条" /> : <span>{awaitingRecoveryQuery ? '等待输入查询条件' : '记录数量待核对'}</span>}
          <span>状态每 {AUTO_REFRESH_MS / 1000} 秒自动刷新</span>
      </div>

      <BarcodePrintQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
        onAfterClose={focusQuery}
      />
    </div>
  )
}
