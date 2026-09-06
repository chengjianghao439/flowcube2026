import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { FilterCard } from '@/components/shared/FilterCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { FinderTrigger } from '@/components/finder'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { CustomerFinder } from '@/components/finder/CustomerFinder'
import { getPortalStatementsApi, type PortalStatementRow } from '@/api/portal'
import type { TableColumn } from '@/types'

const PAGE_SIZE = 20

export default function PortalStatementsPage() {
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null)
  const [finderOpen, setFinderOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-statements', customer?.id],
    queryFn: () => getPortalStatementsApi({ customerId: customer!.id, page: 1, pageSize: PAGE_SIZE }),
    enabled: !!customer,
  })

  const total = data?.pagination?.total ?? 0

  const columns: TableColumn<PortalStatementRow>[] = [
    { key: 'statementNo', title: '对账单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'period', title: '对账期间', width: 180, render: (_, row) => {
      const r = row as PortalStatementRow
      const start = r.periodStart ? String(r.periodStart).slice(0, 10) : '—'
      const end = r.periodEnd ? String(r.periodEnd).slice(0, 10) : '—'
      return `${start} ~ ${end}`
    } },
    { key: 'itemCount', title: '笔数', width: 60 },
    { key: 'totalAmount', title: '汇总金额', width: 110, align: 'right', render: v => <span className="font-medium tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'settledAmount', title: '已核销', width: 110, align: 'right', render: v => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'balance', title: '未核销', width: 110, align: 'right', render: v => <span className="font-semibold tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, row) => {
      const r = row as PortalStatementRow
      const tone = r.status === 3 ? 'success' : r.status === 2 ? 'active' : 'draft'
      return <SoftStatusLabel label={r.statusName} tone={tone} />
    } },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => String(v).slice(0, 16) },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="客户对账门户"
        description="按客户核对对账期间、汇总金额与核销进度。此页面只读。"
      />

      <FilterCard>
        <span className="text-sm font-medium">对账客户</span>
        <div className="w-80"><FinderTrigger value={customer?.name ?? ''} placeholder="选择需要核对的客户" onClick={() => setFinderOpen(true)} /></div>
        {customer && (
          <Button variant="ghost" size="sm" onClick={() => { setCustomer(null); }}>清空</Button>
        )}
      </FilterCard>

      {customer && (isError ? <QueryErrorState error={error} onRetry={() => void refetch()} title="对账单加载失败" compact /> : <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        emptyText="该客户暂无对账单"
      />)}

      {customer && (
        <ListSummary total={total} unit="张" />
      )}

      <CustomerFinder
        open={finderOpen}
        onClose={() => setFinderOpen(false)}
        onConfirm={(r) => { setCustomer({ id: r.id, name: r.name }); }}
      />

      {!customer && (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-20 text-muted-foreground">
          <FileText className="h-8 w-8 opacity-40" />
          <h2 className="font-medium text-foreground">先选择一位客户</h2>
          <p className="text-sm">查看该客户的对账期间、已核销金额与未核销余额。</p>
          <Button variant="outline" onClick={() => setFinderOpen(true)}>选择客户</Button>
        </div>
      )}
    </div>
  )
}
