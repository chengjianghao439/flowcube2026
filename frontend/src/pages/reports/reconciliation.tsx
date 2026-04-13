import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getReconciliationApi, type ReconciliationRecord } from '@/api/reports'
import type { TableColumn, Pagination } from '@/types'

type StatementType = 1 | 2
function SummaryCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone?: 'blue' | 'amber' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'amber'
    ? 'border-amber-200 bg-amber-50'
    : tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'rose'
        ? 'border-rose-200 bg-rose-50'
        : 'border-blue-200 bg-blue-50'
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function isOverdue(record: ReconciliationRecord) {
  if (!record.dueDate) return false
  if (record.status === 3) return false
  return record.dueDate < new Date().toISOString().slice(0, 10)
}

export default function ReconciliationPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [type, setType] = useState<StatementType>(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const recent30d = getRelativeDateRange(30)
  const recent90d = getRelativeDateRange(90)
  const monthRange = getMonthDateRange()
  const [startDate, setStartDate] = useState(recent30d.startDate)
  const [endDate, setEndDate] = useState(recent30d.endDate)
  const [applied, setApplied] = useState({ keyword: '', startDate: recent30d.startDate, endDate: recent30d.endDate, status: '' })

  const reconciliationQ = useQuery({
    queryKey: ['reconciliation', type, page, applied],
    queryFn: () => getReconciliationApi({
      type,
      page,
      pageSize: 20,
      keyword: applied.keyword || undefined,
      startDate: applied.startDate || undefined,
      endDate: applied.endDate || undefined,
      status: applied.status || undefined,
    }).then(r => r.data.data!),
  })

  const { data, isLoading, isError, error, refetch } = reconciliationQ
  const summary = data?.summary
  const rows = data?.list ?? []
  const displayRows = useMemo(() => {
    const sortedRows = [...rows].sort((a, b) => {
      const overdueDelta = Number(isOverdue(b)) - Number(isOverdue(a))
      if (overdueDelta !== 0) return overdueDelta

      const unsettledDelta = Number(a.status === 3) - Number(b.status === 3)
      if (unsettledDelta !== 0) return unsettledDelta

      const dueA = a.dueDate || '9999-12-31'
      const dueB = b.dueDate || '9999-12-31'
      if (dueA !== dueB) return dueA.localeCompare(dueB)

      return String(b.createdAt).localeCompare(String(a.createdAt))
    })

    return sortedRows
  }, [rows])

  function openPath(path: string | null | undefined, title: string) {
    if (!path) return
    addTab({ key: path, title, path })
    navigate(path)
  }

  function applyFilters() {
    setPage(1)
    setApplied({
      keyword: search.trim(),
      startDate,
      endDate,
      status: statusFilter,
    })
  }

  function resetFilters() {
    setSearch('')
    setStartDate(recent30d.startDate)
    setEndDate(recent30d.endDate)
    setStatusFilter('')
    setApplied({ keyword: '', startDate: recent30d.startDate, endDate: recent30d.endDate, status: '' })
    setPage(1)
  }

  function applyPreset(start: string, end: string) {
    setStartDate(start)
    setEndDate(end)
    setApplied(prev => ({ ...prev, startDate: start, endDate: end }))
    setPage(1)
  }

  const columns: TableColumn<ReconciliationRecord>[] = [
    { key: 'orderNo', title: '关联单号', width: 170, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: type === 1 ? '供应商' : '客户', width: 160 },
    { key: 'sourceOrderNo', title: '源单号', width: 170, render: (v, row) => (
      <div className="space-y-0.5">
        <div className="text-doc-code-muted">{String(v)}</div>
        {row.receiptTaskNo && <div className="text-xs text-muted-foreground">收货单 {row.receiptTaskNo}</div>}
      </div>
    )},
    { key: 'totalAmount', title: '总金额', width: 110, render: v => <span className="tabular-nums font-medium">¥{Number(v).toFixed(2)}</span> },
    { key: 'paidAmount', title: type === 1 ? '已付' : '已收', width: 110, render: v => <span className="tabular-nums text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'balance', title: '余额', width: 110, render: v => <span className={`tabular-nums ${Number(v) > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 120, render: (v, row) => {
      const record = row as ReconciliationRecord
      const overdue = isOverdue(record)
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={Number(v) === 3 ? 'outline' : Number(v) === 2 ? 'secondary' : 'default'}>{record.statusName}</Badge>
          {overdue && <Badge variant="destructive" className="rounded-full px-2">逾期</Badge>}
        </div>
      )
    } },
    { key: 'dueDate', title: '到期日', width: 120, render: v => v ? String(v) : <span className="text-muted-foreground">-</span> },
    { key: 'createdAt', title: '创建时间', width: 160, render: v => formatDisplayDateTime(String(v)) },
    { key: 'id', title: '操作', width: 220, render: (_, row) => {
      const r = row as ReconciliationRecord
      return (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openPath(r.sourcePath, `原单 ${r.sourceOrderNo}`)} disabled={!r.sourcePath}>
            查看原单
          </Button>
          {r.receiptPath && (
            <Button size="sm" variant="ghost" onClick={() => openPath(r.receiptPath, `收货单 ${r.receiptTaskNo}`)}>
              查看收货单
            </Button>
          )}
        </div>
      )
    } },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="对账基础版"
        description="客户对账单与供应商对账单统一查看，支持按时间范围筛选、导出 Excel，并直接回跳原始单据。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => downloadExport('/export/reconciliation', {
                type: String(type),
                ...(applied.keyword ? { keyword: applied.keyword } : {}),
                ...(applied.startDate ? { startDate: applied.startDate } : {}),
                ...(applied.endDate ? { endDate: applied.endDate } : {}),
                ...(applied.status ? { status: applied.status } : {}),
              }).catch(e => toast.error((e as Error).message))}
            >
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => openPath('/payments', '应付/应收账款')}>打开账款中心</Button>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="总单数" value={summary?.totalRecords ?? 0} hint="当前筛选范围内" tone="blue" />
        <SummaryCard label="总金额" value={`¥${(summary?.totalAmount ?? 0).toFixed(2)}`} hint="按账单总额汇总" tone="amber" />
        <SummaryCard label="已付/已收" value={`¥${(summary?.paidAmount ?? 0).toFixed(2)}`} hint="已结清金额" tone="emerald" />
        <SummaryCard label="待回收余额" value={`¥${(summary?.balance ?? 0).toFixed(2)}`} hint={`逾期 ${summary?.overdueCount ?? 0} 单`} tone="rose" />
      </div>

      <div className="flex gap-1 border-b border-border">
        {([
          { key: 1 as const, label: '供应商对账单' },
          { key: 2 as const, label: '客户对账单' },
        ]).map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setType(item.key)
              setPage(1)
              setApplied({ keyword: '', startDate: recent30d.startDate, endDate: recent30d.endDate, status: '' })
              setSearch('')
              setStartDate(recent30d.startDate)
              setEndDate(recent30d.endDate)
              setStatusFilter('')
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${type === item.key ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <FilterCard>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
            当前需重点核对 {focusCount} 条
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => applyPreset(recent30d.startDate, recent30d.endDate)}>
            近 30 天
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset(recent90d.startDate, recent90d.endDate)}>
            近 90 天
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset(monthRange.startDate, monthRange.endDate)}>
            本月
          </Button>
        </div>
        <Input
          placeholder="搜索单号 / 往来方"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 w-60"
          onKeyDown={e => { if (e.key === 'Enter') applyFilters() }}
        />
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9 w-40" />
        <span className="text-muted-foreground">至</span>
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9 w-40" />
        <Select value={statusFilter || '__all__'} onValueChange={v => setStatusFilter(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="1">未付</SelectItem>
            <SelectItem value="2">部分付</SelectItem>
            <SelectItem value="3">已付清</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={applyFilters}>查询</Button>
        <Button size="sm" variant="ghost" onClick={resetFilters}>重置</Button>
      </FilterCard>

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="对账数据加载失败"
          description="当前对账单数据无法加载，请点击右上角刷新页面或稍后重试"
          compact
        />
      )}

      {!isError && (
        <DataTable
          columns={columns}
          data={displayRows}
          loading={isLoading}
          pagination={data?.pagination as Pagination | undefined}
          onPageChange={setPage}
          onRowDoubleClick={(row) => openPath(row.sourcePath || row.receiptPath, row.orderNo)}
          emptyText={viewMode === 'focus' ? '当前范围内暂无待核对对账数据' : '暂无对账数据'}
        />
      )}
    </div>
  )
}
