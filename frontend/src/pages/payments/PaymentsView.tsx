import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { usePaymentActions } from '@/components/shared/usePaymentActions'
import { ReceiptPanel, type ReceiptPanelHandle } from '@/components/shared/ReceiptPanel'
import { PaymentQueryDialog, PaymentQueryBar, EMPTY_PAYMENT_QUERY, type PaymentQueryValues } from '@/components/shared/PaymentQueryDialog'
import { getPaymentsApi } from '@/api/payments'
import type { PaymentRecord } from '@/api/payments'
import { IMMEDIATE_SETTLEMENT_TYPES } from '@/generated/status'
import type { TableColumn } from '@/types'
import { formatDisplayDate } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'

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
    payAction: '登记付款',
    payDialog: '登记付款',
    statusOptions: [['1', '未付'], ['2', '部分付'], ['3', '已付清']] as const,
  },
  2: {
    title: '应收账款',
    description: '现结客户：下单当天到期，出库后逐笔登记收款；月结客户见「客户对账」',
    party: '客户',
    amountCol: '已收金额',
    payAction: '登记收款',
    payDialog: '登记收款',
    statusOptions: [['1', '未收'], ['2', '部分收'], ['3', '已收清']] as const,
  },
} as const

export default function PaymentsView({ type }: { type: PaymentType }) {
  const copy = COPY[type]
  const isPayable = type === 1
  // 按单登记 = 逐笔登记（客户只付一单）；收款核销 = 一笔汇款冲抵多单
  const [tab, setTab] = useState<'records' | 'receipts'>('records')
  // query 是「已生效」的完整查询条件，筛选栏与高级查询弹窗都写它，导出也复用同一份
  const [query, setQuery] = useState<PaymentQueryValues>(EMPTY_PAYMENT_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)
  // 核销 tab 的动作按钮挪到本页 PageHeader（与「按单登记」tab 对齐），通过 ref 触发面板内部动作
  const receiptRef = useRef<ReceiptPanelHandle>(null)
  const { renderActions, dialogs } = usePaymentActions(type)
  const queryLabels = {
    docLabel: '关联单号',
    partyLabel: copy.party,
    statusText: (v: string) => copy.statusOptions.find(([val]) => val === v)?.[1] ?? v,
    dateLabel: '创建日期',
    amountLabel: '账款金额',
  }
  const exportParams = {
    type: String(type),
    ...(query.docNo ? { orderNo: query.docNo } : {}),
    ...(query.partyName ? { partyName: query.partyName } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.confirmStatus ? { confirmStatus: query.confirmStatus } : {}),
    ...(query.startDate ? { startDate: query.startDate } : {}),
    ...(query.endDate ? { endDate: query.endDate } : {}),
    ...(query.minAmount ? { minAmount: query.minAmount } : {}),
    ...(query.maxAmount ? { maxAmount: query.maxAmount } : {}),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['payments', { type, query }],
    queryFn: () => getPaymentsApi({ ...exportParams, pageSize: 99999, settlementTypes: IMMEDIATE_SCOPE }),
  })

  const columns: TableColumn<PaymentRecord>[] = [
    { key: 'orderNo', title: '关联单号', width: 160, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: copy.party, width: 140 },
    { key: 'totalAmount', title: '总金额', width: 100, render: (v) => `¥${Number(v).toFixed(2)}` },
    { key: 'paidAmount', title: copy.amountCol, width: 100, render: (v) => <span className="tabular-nums text-success">¥{Number(v).toFixed(2)}</span> },
    { key: 'balance', title: '余额', width: 100, render: (v) => <span className={`tabular-nums ${Number(v) > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 130, render: (v, row) => {
      const r = row as PaymentRecord
      // 现结当天到期，逾期信息原本挂在到期日列上；那列换成创建日期后移到这里，避免丢失
      const overdue = r.status !== 3 && r.dueDate && new Date(r.dueDate) < new Date()
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <SoftStatusLabel label={r.statusName} tone={ST_TONE[v as number] ?? 'draft'} />
          {overdue && <SoftStatusLabel label="已逾期" tone="danger" />}
        </div>
      )
    }},
    // 财务确认列：仅应付有——上架自动结算的应付须确认后才能登记付款
    ...(isPayable ? [{ key: 'confirmStatus', title: '结算确认', width: 100, render: (_: unknown, row: PaymentRecord) => (
      row.confirmStatus === 0
        ? <SoftStatusLabel label="待确认" tone="warning" />
        : <span className="text-xs text-muted-foreground">{row.confirmedByName ? `已确认 · ${row.confirmedByName}` : '已确认'}</span>
    ) }] as TableColumn<PaymentRecord>[] : []),
    // 现结只保留一个日期：到期日恒等于下单当天，与创建日期重复，展示创建日期即可
    { key: 'createdAt', title: '创建日期', width: 110,
      render: v => v ? formatDisplayDate(String(v)) : <span className="text-muted-foreground">-</span> },
    { key: 'id', title: '操作', width: 120, render: (_, row) => renderActions(row as PaymentRecord) }
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={tab === 'records' ? (
          // 按单登记：查询 + 导出（导出参数键为 orderNo，与本 tab 列表一致）
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button
              variant="outline"
              onClick={() => downloadExport(
                '/export/payments',
                { ...exportParams, settlementTypes: IMMEDIATE_SCOPE },
              ).catch(e => toast.error((e as Error).message))}
            >
              导出 Excel
            </Button>
          </div>
        ) : (
          // 核销 tab：按钮同样落在右上角 PageHeader（与按单登记对齐），通过 ref 驱动 ReceiptPanel
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => receiptRef.current?.openQuery()}>查询</Button>
            <Button variant="outline" onClick={() => receiptRef.current?.exportExcel()}>导出 Excel</Button>
            <Button onClick={() => receiptRef.current?.openRegister()}>登记{isPayable ? '付款' : '收款'}</Button>
          </div>
        )}
      />

      <div className="flex gap-1 border-b border-border">
        {([
          { key: 'records' as const, label: '按单登记' },
          { key: 'receipts' as const, label: `${isPayable ? '付款' : '收款'}核销` },
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

      {tab === 'receipts' && <ReceiptPanel ref={receiptRef} type={type} settlementTypes={IMMEDIATE_SCOPE} hideToolbar />}

      {tab === 'records' && (<>
      <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} />

      <PaymentQueryDialog
        open={queryOpen}
        initial={query}
        onClose={() => setQueryOpen(false)}
        onApply={setQuery}
        labels={queryLabels}
        partyType={type}
        statusOptions={copy.statusOptions}
        showConfirmStatus={isPayable}
        singleDate
      />
      </>)}

      {dialogs}
    </div>
  )
}
