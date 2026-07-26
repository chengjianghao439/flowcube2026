import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getReconciliationApi, type ReconciliationRecord } from '@/api/reports'
import { usePaymentActions } from '@/components/shared/usePaymentActions'
import type { PaymentRecord } from '@/api/payments'
import { SETTLEMENT_TYPE } from '@/generated/status'
import type { TableColumn } from '@/types'

export type StatementType = 1 | 2

/** 对账页只管月结往来方；现结走账款页，两边合起来才是全量 */
const MONTHLY_SCOPE = String(SETTLEMENT_TYPE.MONTHLY)

/**
 * 供应商对账与客户对账读同一张 `payment_records`、走同一个接口，页面结构完全一致，
 * 差异只有文案和跳转目标。因此只写一份实现，由 reconciliation-payable.tsx /
 * reconciliation-receivable.tsx 传 type 渲染成两个独立页面。
 */
const COPY = {
  1: {
    title: '供应商对账',
    description: '月结供应商的应付账单：按账期核对、登记付款、导出 Excel，可回跳采购单与收货单。现结供应商见「应付账款」。',
    party: '供应商',
    paidCol: '已付',
    paidCard: '已付金额',
    balanceCard: '待付余额',
    payPath: '/payments/payable',
    payTitle: '应付账款',
    statusOptions: [['1', '未付'], ['2', '部分付'], ['3', '已付清']] as const,
  },
  2: {
    title: '客户对账',
    description: '月结客户的应收账单：按账期核对、登记收款、导出 Excel，可回跳销售单。现结客户见「应收账款」。',
    party: '客户',
    paidCol: '已收',
    paidCard: '已收金额',
    balanceCard: '待收余额',
    payPath: '/payments/receivable',
    payTitle: '应收账款',
    statusOptions: [['1', '未收'], ['2', '部分收'], ['3', '已收清']] as const,
  },
} as const

function SummaryCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone?: 'blue' | 'amber' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'amber'
    ? 'border-amber-200 bg-amber-50'
    : tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'rose'
        ? 'border-rose-200 bg-rose-50'
        : 'border-blue-200 bg-blue-50'
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function isOverdue(record: ReconciliationRecord) {
  if (!record.dueDate) return false
  if (record.status === 3) return false
  return record.dueDate < new Date().toISOString().slice(0, 10)
}

export default function ReconciliationView({ type }: { type: StatementType }) {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const copy = COPY[type]
  // 月结往来方的收付款也在这里办——账款页已按即时结算过滤，不再覆盖这批账
  const { renderActions, dialogs } = usePaymentActions(type)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const recent30d = getRelativeDateRange(30)
  const recent90d = getRelativeDateRange(90)
  const monthRange = getMonthDateRange()
  const [startDate, setStartDate] = useState(recent30d.startDate)
  const [endDate, setEndDate] = useState(recent30d.endDate)
  const [applied, setApplied] = useState({ keyword: '', startDate: recent30d.startDate, endDate: recent30d.endDate, status: '' })

  const reconciliationQ = useQuery({
    queryKey: ['reconciliation', type, applied],
    queryFn: () => getReconciliationApi({
      type,
      pageSize: 99999,
      keyword: applied.keyword || undefined,
      startDate: applied.startDate || undefined,
      endDate: applied.endDate || undefined,
      status: applied.status || undefined,
      settlementTypes: MONTHLY_SCOPE,
    }),
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
  }

  function applyPreset(start: string, end: string) {
    setStartDate(start)
    setEndDate(end)
    setApplied(prev => ({ ...prev, startDate: start, endDate: end }))
  }

  const columns: TableColumn<ReconciliationRecord>[] = [
    { key: 'orderNo', title: '关联单号', width: 170, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: copy.party, width: 160 },
    { key: 'sourceOrderNo', title: '源单号', width: 170, render: (v, row) => (
      <div className="space-y-0.5">
        <div className="text-doc-code-muted">{String(v)}</div>
        {row.receiptTaskNo && <div className="text-xs text-muted-foreground">收货单 {row.receiptTaskNo}</div>}
      </div>
    )},
    { key: 'totalAmount', title: '总金额', width: 110, render: v => <span className="tabular-nums font-medium">¥{Number(v).toFixed(2)}</span> },
    { key: 'paidAmount', title: copy.paidCol, width: 110, render: v => <span className="tabular-nums text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'balance', title: '余额', width: 110, render: v => <span className={`tabular-nums ${Number(v) > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 120, render: (v, row) => {
      const record = row as ReconciliationRecord
      const overdue = isOverdue(record)
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <SoftStatusLabel
            label={record.statusName}
            tone={Number(v) === 3 ? 'success' : Number(v) === 2 ? 'active' : 'draft'}
          />
          {overdue && <SoftStatusLabel label="逾期" tone="danger" />}
        </div>
      )
    } },
    { key: 'dueDate', title: '到期日', width: 120, render: v => v ? String(v) : <span className="text-muted-foreground">-</span> },
    { key: 'createdAt', title: '创建时间', width: 160, render: v => formatDisplayDateTime(String(v)) },
    { key: 'id', title: '操作', width: 220, render: (_, row) => {
      const r = row as ReconciliationRecord
      return (
        <div className="flex flex-wrap items-center gap-2">
          {/* 月结往来方的收付款只能在这里办，账款页已按即时结算过滤掉了这批账 */}
          {renderActions(r as unknown as PaymentRecord)}
          <Button size="sm" variant="ghost" onClick={() => openPath(r.sourcePath, `原单 ${r.sourceOrderNo}`)} disabled={!r.sourcePath}>
            原单
          </Button>
          {r.receiptPath && (
            <Button size="sm" variant="ghost" onClick={() => openPath(r.receiptPath, `收货单 ${r.receiptTaskNo}`)}>
              收货单
            </Button>
          )}
        </div>
      )
    } },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={copy.title}
        description={copy.description}
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
            <Button variant="outline" onClick={() => openPath(copy.payPath, copy.payTitle)}>
              打开{copy.payTitle}
            </Button>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="总单数" value={summary?.totalRecords ?? 0} hint="当前筛选范围内" tone="blue" />
        <SummaryCard label="总金额" value={`¥${(summary?.totalAmount ?? 0).toFixed(2)}`} hint="按账单总额汇总" tone="amber" />
        <SummaryCard label={copy.paidCard} value={`¥${(summary?.paidAmount ?? 0).toFixed(2)}`} hint="已结清金额" tone="emerald" />
        <SummaryCard label={copy.balanceCard} value={`¥${(summary?.balance ?? 0).toFixed(2)}`} hint={`逾期 ${summary?.overdueCount ?? 0} 单`} tone="rose" />
      </div>

      <FilterCard>
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
          placeholder={`搜索单号 / ${copy.party}`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 w-60"
          onKeyDown={e => { if (e.key === 'Enter') applyFilters() }}
        />
        <DatePicker value={startDate} onChange={setStartDate} max={endDate || undefined} className="h-9 w-40" />
        <span className="text-muted-foreground">至</span>
        <DatePicker value={endDate} onChange={setEndDate} min={startDate || undefined} className="h-9 w-40" />
        <Select value={statusFilter || '__all__'} onValueChange={v => setStatusFilter(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            {copy.statusOptions.map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
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
          onRowDoubleClick={(row) => openPath(row.sourcePath || row.receiptPath, row.orderNo)}
          emptyText="暂无对账数据"
        />
      )}

      {dialogs}
    </div>
  )
}
