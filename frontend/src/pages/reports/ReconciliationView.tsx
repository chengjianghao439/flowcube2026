import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getRelativeDateRange } from '@/lib/dateRange'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getReconciliationApi, type ReconciliationRecord } from '@/api/reports'
import { ReceiptPanel } from '@/components/shared/ReceiptPanel'
import { StatementPanel } from '@/components/shared/StatementPanel'
import { PaymentQueryDialog, PaymentQueryBar, EMPTY_PAYMENT_QUERY, type PaymentQueryValues } from '@/components/shared/PaymentQueryDialog'
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
    payPath: '/payments/payable',
    payTitle: '应付账款',
    statusOptions: [['1', '未付'], ['2', '部分付'], ['3', '已付清']] as const,
  },
  2: {
    title: '客户对账',
    description: '月结客户的应收账单：按账期核对、登记收款、导出 Excel，可回跳销售单。现结客户见「应收账款」。',
    party: '客户',
    paidCol: '已收',
    payPath: '/payments/receivable',
    payTitle: '应收账款',
    statusOptions: [['1', '未收'], ['2', '部分收'], ['3', '已收清']] as const,
  },
} as const

function isOverdue(record: ReconciliationRecord) {
  if (!record.dueDate) return false
  if (record.status === 3) return false
  return record.dueDate < new Date().toISOString().slice(0, 10)
}

export default function ReconciliationView({ type }: { type: StatementType }) {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const copy = COPY[type]
  // 第一期：对账明细 + 收款核销。第二期会把「对账明细」换成汇总对账单。
  const [tab, setTab] = useState<'statements' | 'receipts' | 'records'>('statements')
  const recent30d = getRelativeDateRange(30)
  // 查询条件统一收在弹窗里；默认带近 30 天，避免一进来就拉全量历史账
  const [query, setQuery] = useState<PaymentQueryValues>({
    ...EMPTY_PAYMENT_QUERY, startDate: recent30d.startDate, endDate: recent30d.endDate,
  })
  const [queryOpen, setQueryOpen] = useState(false)
  const queryLabels = {
    docLabel: '关联单号',
    partyLabel: copy.party,
    statusText: (v: string) => (copy.statusOptions.find(([val]) => val === v)?.[1] ?? v),
    dateLabel: '创建日期',
    amountLabel: '账款金额',
  }
  const exportParams = {
    type: String(type),
    ...(query.docNo ? { orderNo: query.docNo } : {}),
    ...(query.partyName ? { partyName: query.partyName } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.startDate ? { startDate: query.startDate } : {}),
    ...(query.endDate ? { endDate: query.endDate } : {}),
    ...(query.minAmount ? { minAmount: query.minAmount } : {}),
    ...(query.maxAmount ? { maxAmount: query.maxAmount } : {}),
    ...(query.dueStart ? { dueStart: query.dueStart } : {}),
    ...(query.dueEnd ? { dueEnd: query.dueEnd } : {}),
  }

  const reconciliationQ = useQuery({
    queryKey: ['reconciliation', type, query],
    queryFn: () => getReconciliationApi({ ...exportParams, pageSize: 99999, settlementTypes: MONTHLY_SCOPE }),
  })

  const { data, isLoading, isError, error, refetch } = reconciliationQ
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
    { key: 'id', title: '操作', width: 160, render: (_, row) => {
      const r = row as ReconciliationRecord
      return (
        <div className="flex flex-wrap items-center gap-2">
          {/* 月结不做单笔登记：收付款一律走「汇总对账 → 收款核销」，口径统一、账目清楚 */}
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
              onClick={() => downloadExport('/export/reconciliation', exportParams).catch(e => toast.error((e as Error).message))}
            >
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => openPath(copy.payPath, copy.payTitle)}>
              打开{copy.payTitle}
            </Button>
          </div>
        )}
      />

      <div className="flex gap-1 border-b border-border">
        {([
          { key: 'statements' as const, label: '汇总对账' },
          { key: 'receipts' as const, label: `${type === 1 ? '付款' : '收款'}核销` },
          { key: 'records' as const, label: '全部账款' },
        ]).map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === item.key ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'statements' && <StatementPanel type={type} />}
      {tab === 'receipts' && <ReceiptPanel type={type} settlementTypes={MONTHLY_SCOPE} target="statement" />}

      {tab === 'records' && (<>
      <FilterCard>
        <PaymentQueryBar
          query={query}
          onChange={setQuery}
          onOpen={() => setQueryOpen(true)}
          labels={queryLabels}
        />
      </FilterCard>

      <PaymentQueryDialog
        open={queryOpen}
        initial={query}
        onClose={() => setQueryOpen(false)}
        onApply={setQuery}
        labels={queryLabels}
        statusOptions={copy.statusOptions}
        showDueDate
      />

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
      </>)}

    </div>
  )
}
