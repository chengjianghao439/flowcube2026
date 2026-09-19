import { useQuery } from '@tanstack/react-query'
import { money } from '@/lib/format'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { ReportTable } from '@/components/shared/ReportTable'
import { getReceiptDetailApi } from '@/api/payments'


interface Props {
  open: boolean
  onClose: () => void
  /** 要看的汇款单 ID（关闭期间调用方仍会保留上一次的值，查询由 open 控制） */
  receiptId: number | null
  /** 1=付款（应付）2=收款（应收） */
  type: 1 | 2
}

/**
 * 核销明细：这笔款冲抵了哪些订单，以及每张订单核销后的剩余余额。
 *
 * 行数随核销笔数增长，故按工作区弹窗承载，表格区自己滚动（2026-09-18 弹窗重构）。
 */
export function ReceiptDetailDialog({ open, onClose, receiptId, type }: Props) {
  const active = useActiveWorkspaceTab()
  const actionLabel = type === 1 ? '付款' : '收款'

  const { data: detail } = useQuery({
    queryKey: ['payment-receipt-detail', receiptId],
    queryFn: () => getReceiptDetailApi(receiptId!),
    enabled: active && open && receiptId != null,
  })

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="payment-receipt-detail"
      title={<>核销明细 — <span className="text-doc-code-strong">{detail?.receiptNo}</span></>}
      defaultWidth={1000}
      defaultHeight={620}
      minWidth={720}
      minHeight={440}
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3 p-5">
        {detail && (
          <div className="text-sm text-muted-foreground">
            {detail.partyName} · {actionLabel} {money(detail.amount)} · 已核销 <span className="text-success">{money(detail.settledAmount)}</span>
            {detail.balance > 0 && <> · 未核销 <span className="font-medium text-warning">{money(detail.balance)}</span></>}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
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
      </div>
    </AppDialog>
  )
}
