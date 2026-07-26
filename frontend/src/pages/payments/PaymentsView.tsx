import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { usePaymentActions } from '@/components/shared/usePaymentActions'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getPaymentsApi } from '@/api/payments'
import type { PaymentRecord } from '@/api/payments'
import { IMMEDIATE_SETTLEMENT_TYPES } from '@/generated/status'
import type { TableColumn } from '@/types'
import { formatDisplayDate } from '@/lib/dateTime'

/** 账款页只管现结；月结走对账页，两边合起来才是全量 */
const IMMEDIATE_SCOPE = IMMEDIATE_SETTLEMENT_TYPES.join(',')

/** 1未付 = 尚未发生 · 2部分付 = 进行中 · 3已付清 = 终态成功 */
const ST_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success' }

export type PaymentType = 1 | 2

/**
 * 应付与应收共用同一张 `payment_records` 表和同一套接口，页面结构完全一致，
 * 差异只有文案和「结算确认」这一列（仅应付有）。因此这里只写一份实现，
 * 由 payable.tsx / receivable.tsx 传 type 渲染成两个独立页面。
 */
const COPY = {
  1: {
    title: '应付账款',
    description: '现结供应商：下单当天到期，逐笔确认结算后登记付款；月结供应商见「供应商对账」',
    party: '供应商',
    amountCol: '已付金额',
    paidCard: '已付',
    balanceCard: '待付余额',
    payAction: '登记付款',
    payDialog: '登记付款',
    statusOptions: [['1', '未付'], ['2', '部分付'], ['3', '已付清']] as const,
  },
  2: {
    title: '应收账款',
    description: '现结客户：下单当天到期，出库后逐笔登记收款；月结客户见「客户对账」',
    party: '客户',
    amountCol: '已收金额',
    paidCard: '已收',
    balanceCard: '待收余额',
    payAction: '登记收款',
    payDialog: '登记收款',
    statusOptions: [['1', '未收'], ['2', '部分收'], ['3', '已收清']] as const,
  },
} as const

export default function PaymentsView({ type }: { type: PaymentType }) {
  const copy = COPY[type]
  const isPayable = type === 1
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const { renderActions, dialogs } = usePaymentActions(type)

  const { data, isLoading } = useQuery({
    queryKey: ['payments', { type, status: statusFilter, keyword }],
    queryFn: () => getPaymentsApi({
      type,
      pageSize: 99999,
      status: statusFilter || undefined,
      keyword: keyword || undefined,
      settlementTypes: IMMEDIATE_SCOPE,
    }),
  })

  const summary = (data as { summary?: { totalAmount: number; paidAmount: number; balance: number } })?.summary

  const columns: TableColumn<PaymentRecord>[] = [
    { key: 'orderNo', title: '关联单号', width: 160, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: copy.party, width: 140 },
    { key: 'totalAmount', title: '总金额', width: 100, render: (v) => `¥${Number(v).toFixed(2)}` },
    { key: 'paidAmount', title: copy.amountCol, width: 100, render: (v) => <span className="tabular-nums text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'balance', title: '余额', width: 100, render: (v) => <span className={`tabular-nums ${Number(v) > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 90, render: (v, row) => <SoftStatusLabel label={(row as PaymentRecord).statusName} tone={ST_TONE[v as number] ?? 'draft'} /> },
    // 财务确认列：仅应付有——上架自动结算的应付须确认后才能登记付款
    ...(isPayable ? [{ key: 'confirmStatus', title: '结算确认', width: 100, render: (_: unknown, row: PaymentRecord) => (
      row.confirmStatus === 0
        ? <SoftStatusLabel label="待确认" tone="warning" />
        : <span className="text-xs text-muted-foreground">{row.confirmedByName ? `已确认 · ${row.confirmedByName}` : '已确认'}</span>
    ) }] as TableColumn<PaymentRecord>[] : []),
    { key: 'dueDate', title: '到期日', width: 100, render: (v, row) => {
      const d = v ? formatDisplayDate(v) : null
      const r = row as PaymentRecord
      const overdue = d && r.status !== 3 && new Date(d) < new Date()
      return d ? <span className={overdue ? 'font-bold text-destructive' : ''}>{d}{overdue ? ' 逾期' : ''}</span> : <span className="text-muted-foreground">-</span>
    }},
    { key: 'id', title: '操作', width: 120, render: (_, row) => renderActions(row as PaymentRecord) }
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={copy.title} description={copy.description} />
      {/* 汇总卡片 */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">总金额</p><p className="tabular-nums text-2xl font-bold text-foreground">¥{summary.totalAmount.toFixed(2)}</p></div>
          <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{copy.paidCard}</p><p className="tabular-nums text-2xl font-bold text-success">¥{summary.paidAmount.toFixed(2)}</p></div>
          <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{copy.balanceCard}</p><p className="tabular-nums text-2xl font-bold text-destructive">¥{summary.balance.toFixed(2)}</p></div>
        </div>
      )}

      <FilterCard>
        <Input
          placeholder={`搜索单号 / ${copy.party}`}
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') setKeyword(search.trim()) }}
          className="h-9 w-60"
        />
        <Button size="sm" onClick={() => setKeyword(search.trim())}>查询</Button>
        <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v) }}>
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
        {(statusFilter || keyword) && (
          <Button size="sm" variant="ghost" onClick={() => { setStatusFilter(''); setSearch(''); setKeyword('') }}>重置</Button>
        )}
      </FilterCard>

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} />

      {dialogs}
    </div>
  )
}
