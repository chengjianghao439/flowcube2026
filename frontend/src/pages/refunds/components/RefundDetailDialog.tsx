import { useState } from 'react'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { useRefundDetail, useSubmitRefund, useExecuteRefund, useCancelRefund } from '@/hooks/useRefund'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'

interface Props { open: boolean; onClose: () => void; id: number | null }

const STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft', 2: 'active', 3: 'success', 4: 'danger',
}

const m = (n: number) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function RefundDetailDialog({ open, onClose, id }: Props) {
  const { data: refund, isLoading } = useRefundDetail(id || 0)
  const submit = useSubmitRefund()
  const execute = useExecuteRefund()
  const cancel = useCancelRefund()
  const { can } = usePermission()
  const [actionLocked, setActionLocked] = useState(false)

  async function run(fn: () => Promise<unknown>, successMsg: string) {
    if (actionLocked) return
    try {
      setActionLocked(true)
      await fn()
      toast.success(successMsg)
      onClose()
    } finally {
      setActionLocked(false)
    }
  }

  const status = refund?.status
  const isDraft = status === 1
  const isConfirmed = status === 2
  const canSubmit = isDraft && can(PERMISSIONS.REFUND_ORDER_CREATE)
  const canExecute = isConfirmed && can(PERMISSIONS.REFUND_ORDER_EXECUTE)
  const canCancel = (isDraft || isConfirmed) && can(PERMISSIONS.REFUND_ORDER_CREATE)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !actionLocked) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            退款单详情
            {refund && <SoftStatusLabel label={refund.statusName} tone={STATUS_TONE[refund.status] ?? 'draft'} />}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-center py-8 text-muted-foreground">加载中...</p>}
        {refund && (
          <div className="grid grid-cols-2 gap-4 py-2 text-sm">
            <div><span className="text-muted-foreground">退款单号：</span><span className="text-doc-code-strong">{refund.refundNo}</span></div>
            <div><span className="text-muted-foreground">销售单：</span><span className="text-doc-code">{refund.saleOrderNo}</span></div>
            <div><span className="text-muted-foreground">客户：</span>{refund.customerName}</div>
            <div><span className="text-muted-foreground">退款金额：</span><span className="tabular-nums font-medium">¥{m(refund.amount)}</span></div>
            <div><span className="text-muted-foreground">退款日期：</span>{refund.refundDate ? String(refund.refundDate).slice(0, 10) : '—'}</div>
            <div><span className="text-muted-foreground">经办人：</span>{refund.operatorName || '—'}</div>
            {refund.confirmedByName && <div><span className="text-muted-foreground">确认人：</span>{refund.confirmedByName}</div>}
            {refund.refundedAt && <div><span className="text-muted-foreground">退款完成：</span>{formatDisplayDateTime(refund.refundedAt)}</div>}
            {refund.remark && <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{refund.remark}</div>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {canSubmit && (
            <Button onClick={() => confirmAction({
              title: '确认退款单',
              description: '确认后退款单进入可执行状态。',
              confirmText: '确认',
              onConfirm: () => run(() => submit.mutateAsync(refund!.id), '退款单已确认'),
            })} disabled={submit.isPending || actionLocked}>确认退款</Button>
          )}
          {canExecute && (
            <Button variant="destructive" onClick={() => confirmAction({
              title: '执行退款',
              description: '将从退款账户出账 ¥' + m(refund?.amount ?? 0) + ' 并冲减该销售单已收金额，此操作不可撤销。',
              confirmText: '执行退款',
              variant: 'destructive',
              onConfirm: () => run(() => execute.mutateAsync(refund!.id), '退款已完成'),
            })} disabled={execute.isPending || actionLocked}>执行退款</Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => confirmAction({
              title: '取消退款单',
              description: '取消后不可恢复。',
              confirmText: '取消',
              variant: 'destructive',
              onConfirm: () => run(() => cancel.mutateAsync(refund!.id), '退款单已取消'),
            })} disabled={cancel.isPending || actionLocked}>取消</Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={actionLocked}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
