import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getBarcodePrintRecordsApi, reprintBarcodeRecordApi } from '@/api/print-jobs'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'
import type { BarcodePrintCategory, BarcodePrintRecord } from '@/types/print-jobs'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

const CATEGORY_OPTIONS: Array<{ value: BarcodePrintCategory; label: string; hint: string }> = [
  { value: 'inbound', label: '入库条码', hint: '库存条码、塑料盒条码的打印状态与补打' },
  { value: 'outbound', label: '出库条码', hint: '出库箱贴 / L 条码的打印状态与补打' },
  { value: 'logistics', label: '物流条码', hint: '物流标签与面单打印状态；可处理残缺补打' },
]

const STATUS_OPTIONS = [
  { value: '__all__', label: '全部状态' },
  { value: 'queued', label: '待派发' },
  { value: 'printing', label: '打印中' },
  { value: 'success', label: '已打印' },
  { value: 'failed', label: '打印失败' },
  { value: 'timeout', label: '超时待确认' },
  { value: 'cancelled', label: '已取消' },
] as const

function statusBadge(job: BarcodePrintRecord['latestJob']) {
  if (!job) return <Badge variant="secondary">未打印</Badge>
  if (job.statusKey === 'success') return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">已打印</Badge>
  if (job.statusKey === 'timeout') return <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">超时待确认</Badge>
  if (job.statusKey === 'failed') return <Badge variant="destructive">打印失败</Badge>
  if (job.statusKey === 'cancelled') return <Badge variant="outline">已取消</Badge>
  if (job.statusKey === 'printing') return <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">打印中</Badge>
  return <Badge variant="outline">待派发</Badge>
}

export default function BarcodePrintQueryPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialCategory = (searchParams.get('category') as BarcodePrintCategory | null) || 'inbound'
  const initialInboundTaskId = Number(searchParams.get('inboundTaskId') || 0) || undefined
  const initialInboundTaskItemId = Number(searchParams.get('inboundTaskItemId') || 0) || undefined
  const initialKeyword = searchParams.get('keyword') || ''
  const [category, setCategory] = useState<BarcodePrintCategory>(initialCategory)
  const [search, setSearch] = useState(initialKeyword)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [status, setStatus] = useState('__all__')
  const [page, setPage] = useState(1)
  const isActiveTab = useActiveWorkspaceTab()

  const query = useQuery({
    queryKey: ['barcode-print-records', category, keyword, status, page, initialInboundTaskId, initialInboundTaskItemId],
    queryFn: () => getBarcodePrintRecordsApi({
      category,
      keyword,
        status: status === '__all__' ? undefined : status,
      page,
      pageSize: 20,
      inboundTaskId: category === 'inbound' ? initialInboundTaskId : undefined,
      inboundTaskItemId: category === 'inbound' ? initialInboundTaskItemId : undefined,
    }).then(r => r.data.data),
    enabled: isActiveTab,
    refetchInterval: isActiveTab ? 3000 : false,
  })

  const reprintMut = useMutation({
    mutationFn: (row: BarcodePrintRecord) => reprintBarcodeRecordApi({
      category: row.category,
      recordId: row.recordId,
    }).then(r => r.data.data),
    onSuccess: (data, row) => {
      toast.success(
        data?.printerCode
          ? `${row.barcode} 已重新加入打印队列 → ${data.printerCode}`
          : `${row.barcode} 已重新加入打印队列`,
      )
      qc.invalidateQueries({ queryKey: ['barcode-print-records'] })
      qc.invalidateQueries({ queryKey: ['print-jobs'] })
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '重新打印失败')
    },
  })

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

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
        title: category === 'inbound' ? '产品信息' : '业务信息',
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
            <div>{row.latestJob?.printerCode ?? row.latestJob?.printerName ?? '—'}</div>
            <div className="text-xs text-muted-foreground line-clamp-2">
              {row.latestJob?.errorMessage || row.latestJob?.printStateLabel || '尚未生成打印任务'}
            </div>
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
        render: (_, row) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!row.canReprint || (reprintMut.isPending && reprintMut.variables?.recordId === row.recordId)}
              onClick={() => reprintMut.mutate(row)}
            >
              {reprintMut.isPending && reprintMut.variables?.recordId === row.recordId ? '处理中…' : '重新打印'}
            </Button>
            {row.category === 'inbound' && row.inboundTaskId ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openPath(`/inbound-tasks/${row.inboundTaskId}?focus=print-batches`, row.bizNo || `收货订单 #${row.inboundTaskId}`)}
              >
                打开收货详情
              </Button>
            ) : null}
            {row.category === 'outbound' && row.waveId ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openPath(`/picking-waves?waveId=${row.waveId}&focus=print-closure`, row.waveNo || `波次 #${row.waveId}`)}
              >
                打开波次详情
              </Button>
            ) : null}
          </div>
        ),
      },
    ]
  }, [category, reprintMut.isPending, reprintMut.variables])

  const activeCategory = CATEGORY_OPTIONS.find(item => item.value === category)!
  const rows = query.data?.list ?? []
  const pagination = query.data?.pagination
  const inboundContext = useMemo(() => {
    if (category !== 'inbound') return null
    const taskId = initialInboundTaskId || rows.find(row => row.inboundTaskId)?.inboundTaskId
    if (!taskId) return null
    const failedCount = rows.filter(row => row.latestJob?.statusKey === 'failed').length
    const timeoutCount = rows.filter(row => row.latestJob?.statusKey === 'timeout').length
    const printingCount = rows.filter(row => row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued').length
    const taskNo = rows.find(row => row.inboundTaskId === taskId)?.bizNo ?? `#${taskId}`
    return {
      taskId,
      taskNo,
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
    const failedCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'failed').length
    const timeoutCount = rows.filter(row => row.waveId === waveId && row.latestJob?.statusKey === 'timeout').length
    const printingCount = rows.filter(row => row.waveId === waveId && (row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued')).length
    return { waveId, waveNo, failedCount, timeoutCount, printingCount }
  }, [category, rows])
  const logisticsContext = useMemo(() => {
    if (category !== 'logistics') return null
    const failedCount = rows.filter(row => row.latestJob?.statusKey === 'failed').length
    const timeoutCount = rows.filter(row => row.latestJob?.statusKey === 'timeout').length
    const printingCount = rows.filter(row => row.latestJob?.statusKey === 'printing' || row.latestJob?.statusKey === 'queued').length
    return {
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
      />

      {inboundContext && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">当前正在处理收货打印链路</p>
              <p className="mt-1 text-sm text-muted-foreground">
                收货订单 <span className="text-doc-code">{inboundContext.taskNo}</span> 的库存条码都在这里追踪。先收口失败 / 超时，再回收货详情继续上架与审核。
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openPath('/reports/exception-workbench', '异常工作台')}
              >
                打开异常工作台
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-rose-200 bg-white px-4 py-3">
              <p className="text-helper">打印失败</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{inboundContext.failedCount}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
              <p className="text-helper">超时待确认</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{inboundContext.timeoutCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-helper">仍在排队 / 打印中</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{inboundContext.printingCount}</p>
            </div>
          </div>
        </div>
      )}

      {outboundContext && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">当前正在处理出库打印链路</p>
              <p className="mt-1 text-sm text-muted-foreground">
                波次 <span className="text-doc-code">{outboundContext.waveNo}</span> 的出库箱贴都在这里追踪。先收口失败 / 超时，再回波次详情继续拣货与分拣。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openPath(`/picking-waves?waveId=${outboundContext.waveId}&focus=print-closure`, `波次 ${outboundContext.waveNo}`)}
              >
                返回波次详情
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openPath('/reports/exception-workbench', '异常工作台')}
              >
                打开异常工作台
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-rose-200 bg-white px-4 py-3">
              <p className="text-helper">打印失败</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{outboundContext.failedCount}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
              <p className="text-helper">超时待确认</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{outboundContext.timeoutCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-helper">仍在排队 / 打印中</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{outboundContext.printingCount}</p>
            </div>
          </div>
        </div>
      )}

      {logisticsContext && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">当前正在处理物流标签链路</p>
              <p className="mt-1 text-sm text-muted-foreground">
                物流标签打印异常会直接影响现场出库确认。建议先处理失败 / 超时，再回 PDA 扫描物流条码继续出库。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openPath('/pda/ship', 'PDA 出库确认')}>
                打开 PDA 出库
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>
                打开异常工作台
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-rose-200 bg-white px-4 py-3">
              <p className="text-helper">打印失败</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{logisticsContext.failedCount}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
              <p className="text-helper">超时待确认</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{logisticsContext.timeoutCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-helper">仍在排队 / 打印中</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{logisticsContext.printingCount}</p>
            </div>
          </div>
          {logisticsContext.latestBizNo ? (
            <p className="text-xs text-muted-foreground">最近物流编码：<span className="text-doc-code">{logisticsContext.latestBizNo}</span></p>
          ) : null}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {CATEGORY_OPTIONS.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setCategory(item.value)
              setPage(1)
            }}
            className={[
              'rounded-2xl border p-4 text-left transition-colors',
              category === item.value
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border bg-card hover:bg-muted/40',
            ].join(' ')}
          >
            <div className="font-semibold text-foreground">{item.label}</div>
            <div className="mt-1 text-sm text-muted-foreground leading-relaxed">{item.hint}</div>
          </button>
        ))}
      </div>

      <FilterCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              placeholder={`搜索${activeCategory.label} / 单号 / 关键字`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setKeyword(search.trim())
                  setPage(1)
                }
              }}
            />
          </div>
          <Select
            value={status}
            onValueChange={value => {
              setStatus(value)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setKeyword(search.trim()); setPage(1) }}>搜索</Button>
          <Button
            variant="outline"
            onClick={() => {
              setSearch('')
              setKeyword('')
              setStatus('__all__')
              setPage(1)
            }}
          >
            重置
          </Button>
        </div>
        {(initialInboundTaskId || initialInboundTaskItemId) && category === 'inbound' && (
          <div className="mt-3 text-helper">
            当前按收货订单筛选
            {initialInboundTaskId ? ` #${initialInboundTaskId}` : ''}
            {initialInboundTaskItemId ? ` / 明细 #${initialInboundTaskItemId}` : ''}
          </div>
        )}
      </FilterCard>

      <DataTable
        columns={columns}
        data={rows}
        loading={query.isLoading}
        rowKey="recordId"
      />

      {pagination && <div className="px-1 text-helper">状态每 3 秒自动刷新</div>}
    </div>
  )
}
