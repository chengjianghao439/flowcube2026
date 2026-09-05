import { ReportTable } from '@/components/shared/ReportTable'
import { useState, forwardRef, useImperativeHandle } from 'react'
import { useQuery } from '@tanstack/react-query'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { ReceiptFormDialog } from '@/components/shared/ReceiptFormDialog'
import { PaymentQueryDialog, PaymentQueryBar, EMPTY_PAYMENT_QUERY, type PaymentQueryValues } from '@/components/shared/PaymentQueryDialog'
import { getReceiptsApi, getReceiptDetailApi, type PaymentReceipt } from '@/api/payments'
import { formatDisplayDate } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import type { TableColumn } from '@/types'

/** 1待核销 = 钱到了还没冲账 · 2部分核销 = 还有余额 · 3已核销完 */
const RECEIPT_TONE: Record<number, StatusTone> = { 1: 'warning', 2: 'active', 3: 'success' }
const money = (n: number) => `¥${Number(n).toFixed(2)}`

interface Props {
  /** 1=付款（应付）2=收款（应收） */
  type: 1 | 2
  /** 限定可核销账款的结算方式，与所在页面一致 */
  settlementTypes: string
  /** 核销目标：现结页核账款，月结页核已确认的对账单 */
  target?: 'record' | 'statement'
  /**
   * 隐藏面板自带的工具条按钮（查询/导出/登记），交由父级在其 PageHeader 里渲染——
   * 让「收款核销」tab 的按钮与「按单登记」tab 一样落在页面右上角、与标题对齐。
   * 只影响按钮位置；筛选标签仍留在面板内。父级通过 ref 触发这三个动作。
   */
  hideToolbar?: boolean
}

/** 父级（PageHeader）驱动面板动作的句柄：把工具条按钮挪出去后，用它触发面板内部的查询/登记/导出 */
export interface ReceiptPanelHandle {
  openQuery: () => void
  openRegister: () => void
  exportExcel: () => void
}

/**
 * 收款核销面板：汇款单列表 + 新建核销 + 继续核销。
 *
 * 四个账款/对账页面共用。汇款单本身不分现结月结（一个往来方只会是其中一类），
 * 但新建核销时可选的账款会按 settlementTypes 限定在本页范围内。
 */
export const ReceiptPanel = forwardRef<ReceiptPanelHandle, Props>(function ReceiptPanel(
  { type, settlementTypes, target = 'record', hideToolbar = false }, ref,
) {
  const isPayable = type === 1
  const actionLabel = isPayable ? '付款' : '收款'
  const partyLabel = isPayable ? '供应商' : '客户'

  const [query, setQuery] = useState<PaymentQueryValues>(EMPTY_PAYMENT_QUERY)
  const [queryOpen, setQueryOpen] = useState(false)
  const queryLabels = {
    docLabel: `${actionLabel}单号`,
    partyLabel,
    statusText: (v: string) => ({ '1':'待核销', '2':'部分核销', '3':'已核销' }[v] ?? v),
    dateLabel: `${actionLabel}日期`,
    amountLabel: `${actionLabel}金额`,
  }
  const [formOpen, setFormOpen] = useState(false)
  const [continueTarget, setContinueTarget] = useState<PaymentReceipt | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)

  const exportParams = {
    type: String(type),
    ...(query.docNo ? { receiptNo: query.docNo } : {}),
    ...(query.partyName ? { partyName: query.partyName } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.startDate ? { startDate: query.startDate } : {}),
    ...(query.endDate ? { endDate: query.endDate } : {}),
    ...(query.minAmount ? { minAmount: query.minAmount } : {}),
    ...(query.maxAmount ? { maxAmount: query.maxAmount } : {}),
  }
  const { data, isLoading } = useQuery({
    queryKey: ['payment-receipts', { type, query }],
    queryFn: () => getReceiptsApi({ ...exportParams, pageSize: 500 }),
  })
  const { data: detail } = useQuery({
    queryKey: ['payment-receipt-detail', detailId],
    queryFn: () => getReceiptDetailApi(detailId!),
    enabled: detailId != null,
  })

  const handleExport = () => downloadExport('/export/payment-receipts', exportParams)
    .catch(e => toast.error((e as Error).message))
  // 工具条按钮被父级挪进 PageHeader 后，通过 ref 触发面板内部的查询/登记/导出
  useImperativeHandle(ref, () => ({
    openQuery: () => setQueryOpen(true),
    openRegister: () => { setContinueTarget(null); setFormOpen(true) },
    exportExcel: handleExport,
  }))

  const columns: TableColumn<PaymentReceipt>[] = [
    { key: 'receiptNo', title: '单号', width: 220, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'partyName', title: partyLabel, width: 160 },
    { key: 'amount', title: `${actionLabel}金额`, width: 110, align: 'right', render: v => <span className="tabular-nums font-medium">{money(v as number)}</span> },
    { key: 'settledAmount', title: '已核销', width: 110, align: 'right', render: v => <span className="tabular-nums text-success">{money(v as number)}</span> },
    { key: 'balance', title: '未核销', width: 110, align: 'right', render: v => (
      <span className={`tabular-nums ${Number(v) > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>{money(v as number)}</span>
    )},
    { key: 'status', title: '状态', width: 100, render: (v, row) => (
      <SoftStatusLabel label={(row as PaymentReceipt).statusName} tone={RECEIPT_TONE[v as number] ?? 'draft'} />
    )},
    { key: 'paymentDate', title: '日期', width: 110, render: v => v ? formatDisplayDate(String(v)) : '-' },
    { key: 'method', title: '方式', width: 80, render: v => (v as string) || '-' },
    { key: 'operatorName', title: '经办人', width: 90, render: v => (v as string) || '-' },
    { key: 'id', title: '操作', width: 180, render: (_, row) => {
      const r = row as PaymentReceipt
      // 与「按单登记」tab 一致：主按钮 + 下拉次操作（有余额→继续核销为主、明细进下拉；已核销完→只有明细）
      return r.balance > 0 ? (
        <TableActionsMenu
          primaryLabel="继续核销"
          onPrimaryClick={() => { setContinueTarget(r); setFormOpen(true) }}
          items={[{ label: '明细', onClick: () => setDetailId(r.id) }]}
        />
      ) : (
        <TableActionsMenu primaryLabel="明细" primaryVariant="outline" onPrimaryClick={() => setDetailId(r.id)} items={[]} />
      )
    }},
  ]

  return (
    <div className="space-y-4">
      {hideToolbar ? (
        <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <PaymentQueryBar query={query} onChange={setQuery} labels={queryLabels} />
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={handleExport}>导出 Excel</Button>
            <Button onClick={() => { setContinueTarget(null); setFormOpen(true) }}>登记{actionLabel}</Button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} rowKey="id" />

      <PaymentQueryDialog
        open={queryOpen}
        initial={query}
        onClose={() => setQueryOpen(false)}
        onApply={setQuery}
        labels={queryLabels}
        partyType={type}
        statusOptions={[['1','待核销'],['2','部分核销'],['3','已核销']] as const}
      />

      <ReceiptFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setContinueTarget(null) }}
        type={type}
        settlementTypes={settlementTypes}
        target={target}
        receipt={continueTarget}
      />

      {/* 核销明细：这笔钱冲抵了哪些订单 */}
      <Dialog open={detailId != null} onOpenChange={v => !v && setDetailId(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>核销明细 — <span className="text-doc-code-strong">{detail?.receiptNo}</span></DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="text-sm text-muted-foreground">
              {detail.partyName} · {actionLabel} {money(detail.amount)} · 已核销 <span className="text-success">{money(detail.settledAmount)}</span>
              {detail.balance > 0 && <> · 未核销 <span className="font-medium text-warning">{money(detail.balance)}</span></>}
            </div>
          )}
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <ReportTable className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">关联单号</th>
                  <th className="px-4 py-3 text-right">本次核销</th>
                  <th className="px-4 py-3 text-right">订单总额</th>
                  <th className="px-4 py-3 text-right">剩余余额</th>
                </tr>
              </thead>
              <tbody>
                {detail?.settlements?.map(s => (
                  <tr key={s.entryId} className="border-t">
                    <td className="px-4 py-3 text-doc-code">{s.orderNo}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(s.amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(s.orderTotal)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.orderBalance > 0
                        ? <span className="text-destructive">{money(s.orderBalance)}</span>
                        : <span className="text-success">已结清</span>}
                    </td>
                  </tr>
                ))}
                {detail && !detail.settlements?.length && (
                  <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">这笔款尚未核销任何订单</td></tr>
                )}
              </tbody>
            </ReportTable>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDetailId(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
