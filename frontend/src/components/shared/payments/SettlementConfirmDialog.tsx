import { money } from '@/lib/format'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { confirmPaymentApi, getSettlementDetailApi } from '@/api/payments'
import type { PaymentRecord } from '@/api/payments'
import { toast } from '@/lib/toast'
import { usePaymentViewInvalidation } from './usePaymentViewInvalidation'

interface Props {
  open: boolean
  onClose: () => void
  record: PaymentRecord | null
}

/**
 * 应付结算确认：核对「实际上架量 × 采购单价 − 退货冲减」后才允许登记付款。
 *
 * 只有采购上架自动结算生成的应付需要确认。明细行数随收货批次变化，故用可拖拽的
 * AppDialog 承载，表格区自己滚动而不是把整张弹窗撑长（2026-09-18 弹窗重构）。
 */
export function SettlementConfirmDialog({ open, onClose, record }: Props) {
  const invalidatePaymentViews = usePaymentViewInvalidation()

  const { data: settlement } = useQuery({
    queryKey: ['payment-settlement', record?.id],
    queryFn: () => getSettlementDetailApi(record!.id),
    enabled: open && !!record,
  })
  const confirmMut = useMutation({
    mutationFn: (id: number) => confirmPaymentApi(id),
    onSuccess: () => {
      invalidatePaymentViews()
      onClose()
      toast.success('应付结算已确认，可登记付款')
    },
  })

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="payment-settlement-confirm"
      title={<>应付结算确认 — <span className="text-doc-code-strong">{record?.orderNo}</span></>}
      defaultWidth={960}
      defaultHeight={640}
      minWidth={720}
      minHeight={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={confirmMut.isPending} onClick={() => { if (record) confirmMut.mutate(record.id) }}>
            {confirmMut.isPending ? '确认中…' : '确认结算金额'}
          </Button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm text-muted-foreground">
          该应付由收货上架自动结算生成。请核对以下明细（实际上架量 × 采购单价）后确认；确认后才可登记付款。
          若结算金额后续被重算改变（补收货/退货/撤回收货），会自动打回待确认。
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className="px-2 py-1.5 text-left">收货单</th><th className="px-2 py-1.5 text-left">商品</th><th className="px-2 py-1.5 text-right">上架量</th><th className="px-2 py-1.5 text-right">采购单价</th><th className="px-2 py-1.5 text-right">金额</th></tr>
            </thead>
            <tbody>
              {settlement?.lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1.5 text-doc-code">{l.taskNo}</td>
                  <td className="px-2 py-1.5">{l.productName}{l.articleNumber ? <span className="text-xs text-muted-foreground"> · {l.articleNumber}</span> : null}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.putawayQty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(l.amount)}</td>
                </tr>
              ))}
              {settlement?.returns.map((r, i) => (
                <tr key={`ret-${i}`} className="border-t text-destructive">
                  <td className="px-2 py-1.5 text-doc-code">{r.returnNo}</td>
                  <td className="px-2 py-1.5">采购退货冲减</td>
                  <td className="px-2 py-1.5" colSpan={2}></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                </tr>
              ))}
              {!settlement?.lines.length && !settlement?.returns.length && (
                <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">加载中…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-right text-sm">应付合计：<span className="font-bold tabular-nums">{money(record?.totalAmount)}</span></p>
      </div>
    </AppDialog>
  )
}
