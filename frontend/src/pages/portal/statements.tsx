import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { FilterCard } from '@/components/shared/FilterCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CustomerFinder } from '@/components/finder/CustomerFinder'
import { getPortalStatementsApi, type PortalStatementRow } from '@/api/portal'
import type { TableColumn } from '@/types'

const PAGE_SIZE = 20

export default function PortalStatementsPage() {
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null)
  const [finderOpen, setFinderOpen] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['portal-statements', customer?.id, page],
    queryFn: () => getPortalStatementsApi({ customerId: customer!.id, page, pageSize: PAGE_SIZE }),
    enabled: !!customer,
  })

  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
        description="客户查看本司名下对账单：金额与核销情况与财务「客户对账」页一致，只读。"
      />

      <FilterCard>
        <Input
          className="w-56"
          placeholder={customer ? `当前客户：${customer.name}` : '请选择客户'}
          value={customer?.name ?? ''}
          readOnly
          onClick={() => setFinderOpen(true)}
        />
        <Button variant="outline" onClick={() => setFinderOpen(true)}>选择客户</Button>
        {customer && (
          <Button variant="ghost" size="sm" onClick={() => { setCustomer(null); setPage(1) }}>清空</Button>
        )}
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        emptyText={customer ? '该客户暂无对账单' : '请先选择客户'}
      />

      {customer && (
        <Pagination page={page} totalPages={totalPages} total={total} unit="张"
          onPageChange={setPage} />
      )}

      <CustomerFinder
        open={finderOpen}
        onClose={() => setFinderOpen(false)}
        onConfirm={(r) => { setCustomer({ id: r.id, name: r.name }); setPage(1) }}
      />

      {!customer && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <FileText className="h-8 w-8 opacity-40" />
          <span className="text-sm">选择客户后查看其对账单</span>
        </div>
      )}
    </div>
  )
}
