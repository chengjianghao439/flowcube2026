import { money } from '@/lib/format'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { QueryChips } from '@/components/shared/QueryChips'
import { EmptyState } from '@/components/shared/EmptyState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { PickerField } from '@/components/shared/PickerField'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { CustomerFinder } from '@/components/finder/CustomerFinder'
import { getPortalStatementsApi, type PortalStatementRow } from '@/api/portal'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'

const PAGE_SIZE = 20
type StatementCustomer = { id: number; name: string }

export default function PortalStatementsPage() {
  const [customer, setCustomer] = useState<StatementCustomer | null>(null)
  const [draftCustomer, setDraftCustomer] = useState<StatementCustomer | null>(null)
  const [queryOpen, setQueryOpen] = useState(false)
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
      const start = formatDisplayDate(r.periodStart)
      const end = formatDisplayDate(r.periodEnd)
      return `${start} ~ ${end}`
    } },
    { key: 'itemCount', title: '笔数', width: 60 },
    { key: 'totalAmount', title: '汇总金额', width: 110, align: 'right', render: v => <span className="font-medium tabular-nums">{money(Number(v))}</span> },
    { key: 'settledAmount', title: '已结算', width: 110, align: 'right', render: v => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'balance', title: '未结算', width: 110, align: 'right', render: v => <span className="font-semibold tabular-nums">{money(Number(v))}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, row) => {
      const r = row as PortalStatementRow
      const tone = r.status === 3 ? 'success' : r.status === 2 ? 'active' : 'draft'
      return <SoftStatusLabel label={r.statusName} tone={tone} />
    } },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => formatDisplayDateTime(v) },
  ]

  return (
    <div className="desktop-record-page space-y-4">
      <PageHeader
        title="客户对账单查询"
        description="按客户查看各期对账单与结算情况。"
        actions={<Button variant="outline" onClick={() => { setDraftCustomer(customer); setQueryOpen(true) }}>查询</Button>}
      />

      <QueryChips chips={customer ? [{ key: 'customer', text: `客户：${customer.name}`, onClear: () => setCustomer(null) }] : []}
        onClearAll={() => setCustomer(null)} />
      <QueryDialog open={queryOpen} dialogId="portal-statements-query" title="查询客户对账单"
        resetLabel="清空" onReset={() => setDraftCustomer(null)} onClose={() => setQueryOpen(false)}
        onApply={() => { setCustomer(draftCustomer); setQueryOpen(false) }}>
        <QueryFormLayout>
          <PickerField className="h-9" label="对账客户" value={draftCustomer?.name ?? ''} placeholder="选择要查看的客户"
            onOpen={() => setFinderOpen(true)} onClear={() => setDraftCustomer(null)} />
        </QueryFormLayout>
      </QueryDialog>
      <CustomerFinder open={finderOpen} onClose={() => setFinderOpen(false)}
        onConfirm={result => setDraftCustomer({ id: result.id, name: result.name })} />

      {customer && (isError ? <QueryErrorState error={error} onRetry={() => void refetch()} title="对账单加载失败" /> : <DataTable
        columns={columns} fluid virtualized scrollLabel="客户对账单表格" columnStorageKey="portal-statements:v1"
        data={data?.list ?? []}
        loading={isLoading}
        emptyText="该客户暂无对账单"
      />)}

      {customer && data && !isLoading && !isError && <ListSummary total={total} unit="张" />}

      {!customer && <EmptyState icon={<FileText className="h-8 w-8" />} title="先选择一位客户"
        description="点击右上角「查询」选择客户，查看每期对账单的金额、已结算与未结算金额。" />}
    </div>
  )
}
