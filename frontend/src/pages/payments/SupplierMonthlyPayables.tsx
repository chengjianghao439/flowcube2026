import { Link } from 'react-router-dom'
import { getPaymentsApi, type PaymentRecord } from '@/api/payments'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { SummaryStrip } from '@/components/shared/SummaryStrip'
import { SETTLEMENT_TYPE } from '@/generated/status'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { usePermission } from '@/hooks/usePermission'
import { useVisibleQuery } from '@/hooks/useVisibleQuery'
import { formatDisplayDate } from '@/lib/dateTime'
import { money } from '@/lib/format'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { TableColumn } from '@/types'

const columns: TableColumn<PaymentRecord>[] = [
  { key: 'orderNo', title: '关联单号', width: 170 },
  { key: 'partyName', title: '月结供应商', width: 160 },
  { key: 'totalAmount', title: '总金额', width: 110, align: 'right', render: v => money(Number(v)) },
  { key: 'paidAmount', title: '已付金额', width: 110, align: 'right', render: v => money(Number(v)) },
  { key: 'balance', title: '月结欠款', width: 110, align: 'right', render: v => <span className="font-medium text-destructive-ink">{money(Number(v))}</span> },
  { key: 'dueDate', title: '到期日', width: 120, render: v => v ? formatDisplayDate(String(v)) : '—' },
]

/** 直接查看原月结应付；是否生成对账单不影响欠款可见性，不提供逐笔付款。 */
export default function SupplierMonthlyPayables() {
  const active = useActiveWorkspaceTab()
  const { can } = usePermission()
  const { data, isPending, isPaused, isError, error, refetch } = useVisibleQuery({
    queryKey: ['payments', 'supplier-monthly-outstanding'],
    queryFn: () => getPaymentsApi({ type: '1', settlementTypes: String(SETTLEMENT_TYPE.MONTHLY), status: 'unsettled', page: 1, pageSize: 200 }),
    enabled: active && can(PERMISSIONS.PAYMENT_VIEW),
  })

  return <section aria-label="月结欠款" className="space-y-3 border-b border-border pb-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">月结欠款</h2>
        <p className="mt-1 text-sm text-muted-foreground">月结未结清账款，含未生成对账单的欠款；仍通过月结对账单核销付款。</p>
      </div>
      {can(PERMISSIONS.REPORT_VIEW) && <Link className="text-sm text-primary underline-offset-4 hover:underline" to="/reports/reconciliation/payable">月结对账</Link>}
    </div>
    {isError ? <QueryErrorState error={error} onRetry={() => void refetch()} title="月结欠款加载失败" compact />
      : isPaused ? <p role="status" className="text-sm text-muted-foreground">月结欠款加载已暂停，请恢复网络后重试。</p>
      : isPending ? <p role="status" className="text-sm text-muted-foreground">正在加载月结欠款…</p>
      : data && <>
        <SummaryStrip items={[{ label: '月结未结清金额', value: money(data.summary.balance) }]} />
        <DataTable virtualized columns={columns} data={data.list} emptyText="暂无月结欠款" />
        {data.pagination.total > data.list.length
          ? <p role="status" className="text-xs text-muted-foreground">当前显示前 {data.list.length} 笔，共 {data.pagination.total} 笔；月结未结清金额包含全部匹配账款。</p>
          : <ListSummary total={data.pagination.total} unit="笔" />}
      </>}
  </section>
}
