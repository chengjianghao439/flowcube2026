import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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

const CATEGORY_OPTIONS: Array<{ value: BarcodePrintCategory; label: string; hint: string }> = [
  { value: 'inbound', label: '入库条码', hint: '库存条码、塑料盒条码的打印状态与补打' },
  { value: 'outbound', label: '出库条码', hint: '出库箱贴 / L 条码的打印状态与补打' },
  { value: 'logistics', label: '物流条码', hint: '物流标签与面单打印状态；可处理残缺补打' },
]

const STATUS_OPTIONS = [
  { value: '__all__', label: '全部状态' },
  { value: 'pending', label: '排队中' },
  { value: 'printing', label: '打印中' },
  { value: 'success', label: '已打印' },
  { value: 'failed', label: '打印失败' },
] as const

function statusBadge(job: BarcodePrintRecord['latestJob']) {
  if (!job) return <Badge variant="secondary">未打印</Badge>
  if (job.statusKey === 'success') return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">已打印</Badge>
  if (job.statusKey === 'failed') return <Badge variant="destructive">打印失败</Badge>
  if (job.statusKey === 'printing') return <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">打印中</Badge>
  return <Badge variant="outline">排队中</Badge>
}

export default function BarcodePrintQueryPage() {
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
    refetchInterval: 3000,
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
        width: 110,
        render: (_, row) => (
          <Button
            size="sm"
            variant="outline"
            disabled={!row.canReprint || (reprintMut.isPending && reprintMut.variables?.recordId === row.recordId)}
            onClick={() => reprintMut.mutate(row)}
          >
            {reprintMut.isPending && reprintMut.variables?.recordId === row.recordId ? '处理中…' : '重新打印'}
          </Button>
        ),
      },
    ]
  }, [category, reprintMut.isPending, reprintMut.variables])

  const activeCategory = CATEGORY_OPTIONS.find(item => item.value === category)!
  const rows = query.data?.list ?? []
  const pagination = query.data?.pagination

  return (
    <div className="space-y-5">
      <PageHeader
        title="条码打印查询"
        description="查询入库条码、出库条码、物流条码的打印状态，支持失败追踪与丢失补打。"
      />

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
