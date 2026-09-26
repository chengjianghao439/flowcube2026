import { money } from '@/lib/format'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { useRefundDetail, useSubmitRefund, useExecuteRefund, useCancelRefund, invalidateFinance } from '@/hooks/useRefund'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { BackfillRequestDialog } from '@/components/shared/payments/BackfillRequestDialog'
import { UncertainSubmitNotice } from '@/components/shared/payments/UncertainSubmitNotice'
import { useIdempotentSubmit } from '@/components/shared/payments/useIdempotentSubmit'
import { isBackfillApplication, useBackfillPrompt } from '@/components/shared/payments/backfillFlow'

interface Props { open: boolean; onClose: () => void; id: number | null }

const STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft', 2: 'active', 3: 'success', 4: 'danger',
}


export default function RefundDetailDialog({ open, onClose, id }: Props) {
  const { data: refund, isLoading } = useRefundDetail(id || 0)
  const submit = useSubmitRefund()
  const execute = useExecuteRefund()
  const cancel = useCancelRefund()
  const qc = useQueryClient()
  const { can } = usePermission()
  const [actionLocked, setActionLocked] = useState(false)
  // state 只负责把按钮置灰；「能不能再提交」用 ref 判定——补录弹窗确认回调是旧渲染里存下的
  // 函数，读 state 闭包会看到过期的 false，同一笔退款可能被提交两次。
  const lockRef = useRef(false)
  const lock = () => { lockRef.current = true; setActionLocked(true) }
  const unlock = () => { lockRef.current = false; setActionLocked(false) }
  const { prompt, ask, close: closePrompt } = useBackfillPrompt()
  // 请求键轮换时机交给守卫：成功与明确被拒才换键，超时/断网与期间已结账保留
  const guard = useIdempotentSubmit({ action: 'refund.execute', prefix: 'refund-execute' })

  /** 确认/取消这类动作：错误提示交给全局拦截器，这里吞掉异常以免留下未处理的 rejection */
  async function run(fn: () => Promise<unknown>, successMsg: string) {
    if (lockRef.current) return
    try {
      lock()
      await fn()
      toast.success(successMsg)
      onClose()
    } catch {
      // 全局拦截器已提示
    } finally {
      unlock()
    }
  }

  /**
   * 执行退款（专用，不走 run）：退款日期落在已结账期间时不能直接执行——钱动了会计账上没有——
   * 需要把这次请求提交成跨期补录申请。确认后 `useExecuteRefund` 会复用**同一个请求键**重发，
   * 既不会重复退钱，也不会多出一张申请单。
   */
  async function runExecute(backfillReason?: string) {
    if (lockRef.current || !refund) return
    try {
      lock()
      guard.remember(`退款 ${money(refund.amount)} · ${refund.refundDate ? String(refund.refundDate).slice(0, 10) : '—'} · ${refund.customerName}`)
      const res = await execute.mutateAsync({ id: refund.id, requestKey: guard.keyRef.current, backfillReason })
      guard.settle()
      // 申请单不是「退款已完成」：业务一行未写、钱还没出账，只有审批通过后才会记账。
      // 单号与查看进度的地方必须一起说清楚，否则「已提交」会被当成钱已经退了。
      toast.success(isBackfillApplication(res)
        ? `已提交补录申请 ${res.applicationNo}，审批通过后才会记账；进度见「财务 › 跨期补录审批」`
        : '退款已完成')
      closePrompt()
      onClose()
    } catch (e) {
      const kind = guard.classify(e)
      if (kind === 'period-closed') {
        ask((e as Error).message, (
          <>
            退款 {money(refund.amount)} · {refund.refundDate ? String(refund.refundDate).slice(0, 10) : '—'}
            <br />客户：{refund.customerName} · 原销售单 <span className="text-doc-code">{refund.saleOrderNo}</span>
          </>
        ), runExecute)
        return
      }
      // 未确认：提示条已说清「可能已成功、先查回执」，不再弹「执行失败」把人推向重复执行
      if (kind === 'uncertain') return
      toast.error(e instanceof Error ? e.message : '执行退款失败')
    } finally {
      unlock()
    }
  }

  const status = refund?.status
  const isDraft = status === 1
  const isConfirmed = status === 2
  const canSubmit = isDraft && can(PERMISSIONS.REFUND_ORDER_CREATE)
  const canExecute = isConfirmed && can(PERMISSIONS.REFUND_ORDER_EXECUTE)
  const canCancel = (isDraft || isConfirmed) && can(PERMISSIONS.REFUND_ORDER_CREATE)

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!next && !actionLocked) { onClose(); closePrompt() } }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3">
            退款单详情
            {refund && <SoftStatusLabel label={refund.statusName} tone={STATUS_TONE[refund.status] ?? 'draft'} />}
          </DialogTitle>
        </DialogHeader>
        <UncertainSubmitNotice
          visible={guard.uncertain}
          pending={guard.checkMut.isPending}
          what={guard.lastLabelRef.current ?? undefined}
          onCheck={() => guard.checkLastResult(() => {
            invalidateFinance(qc)
            toast.success('上次提交的退款已执行成功，无需重复执行')
            onClose()
          })}
        />
        <OrderDetailSections type="refund" id={id || 0}>

        {isLoading && <p className="text-center py-8 text-muted-foreground">加载中…</p>}
        {refund && (
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 rounded-lg border border-border bg-muted/20 p-5 text-sm [&>div]:break-words [&>div]:leading-6">
            <div><span className="text-muted-foreground">退款单号：</span><span className="text-doc-code-strong">{refund.refundNo}</span></div>
            <div><span className="text-muted-foreground">销售单：</span><span className="text-doc-code">{refund.saleOrderNo}</span></div>
            <div><span className="text-muted-foreground">客户：</span>{refund.customerName}</div>
            <div><span className="text-muted-foreground">退款金额：</span><span className="tabular-nums text-xl font-semibold">{money(refund.amount)}</span></div>
            <div><span className="text-muted-foreground">退款日期：</span>{refund.refundDate ? String(refund.refundDate).slice(0, 10) : '—'}</div>
            <div><span className="text-muted-foreground">经办人：</span>{refund.operatorName || '—'}</div>
            {refund.confirmedByName && <div><span className="text-muted-foreground">确认人：</span>{refund.confirmedByName}</div>}
            {refund.refundedAt && <div><span className="text-muted-foreground">退款完成：</span>{formatDisplayDateTime(refund.refundedAt)}</div>}
            {refund.remark && <div className="col-span-2"><span className="text-muted-foreground">备注：</span>{refund.remark}</div>}
          </div>
        )}
        </OrderDetailSections>
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
              description: '将从退款账户出账 ' + money(refund?.amount) + ' 并冲减该销售单已收金额，此操作不可撤销。',
              confirmText: '执行退款',
              variant: 'destructive',
              onConfirm: () => runExecute(),
            })} disabled={execute.isPending || actionLocked}>执行退款</Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => confirmAction({
              title: '取消退款单',
              description: '取消后不可恢复。',
              confirmText: '取消',
              variant: 'destructive',
              onConfirm: () => run(() => cancel.mutateAsync(refund!.id), '退款单已取消'),
            })} disabled={cancel.isPending || actionLocked}>取消退款单</Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={actionLocked}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <BackfillRequestDialog
      open={!!prompt}
      onClose={closePrompt}
      message={prompt?.message ?? ''}
      summary={prompt?.summary}
      pending={execute.isPending}
      onConfirm={reason => prompt?.onConfirm(reason)}
    />
    </>
  )
}
