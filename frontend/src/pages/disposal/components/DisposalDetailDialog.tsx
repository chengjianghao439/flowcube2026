import { useState } from 'react'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { useDisposalDetail, useDisposalMutation } from '@/hooks/useDisposal'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { DISPOSE_TYPE_LABELS, DISPOSE_TYPE_TONES } from '@/types/disposal'
import { DISPOSAL_STATUS_TONE } from '../constants'

interface Props { open: boolean; onClose: () => void; id: number | null }

const STATUS_TONE: Record<number, StatusTone> = DISPOSAL_STATUS_TONE

export default function DisposalDetailDialog({ open, onClose, id }: Props) {
  const { data: disposal, isLoading } = useDisposalDetail(id || 0)
  const mutation = useDisposalMutation()
  const { can } = usePermission()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
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

  const status = disposal?.status
  const isDraft = status === 1
  const isPendingApproval = status === 2
  const isApproved = status === 3
  const canSubmit = isDraft && can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE)
  const canApprove = isPendingApproval && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)
  const canDispose = isApproved && can(PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE)
  const canCancel = (isDraft || isPendingApproval) && can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE)

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!next && !actionLocked) onClose() }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            呆滞处置单详情
            {disposal && <SoftStatusLabel label={disposal.statusName} tone={STATUS_TONE[disposal.status] ?? 'draft'} />}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-center py-8 text-muted-foreground">加载中…</p>}
        {disposal && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground">处置单号：</span><span className="text-doc-code-strong">{disposal.disposalNo}</span></div>
              <div><span className="text-muted-foreground">仓库：</span>{disposal.warehouseName}</div>
              <div><span className="text-muted-foreground">经办人：</span>{disposal.operatorName || '-'}</div>
              <div><span className="text-muted-foreground">处置总价值：</span><span className="tabular-nums">¥{disposal.totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span></div>
              <div><span className="text-muted-foreground">创建时间：</span>{formatDisplayDateTime(disposal.createdAt)}</div>
              {disposal.approvedAt && <div><span className="text-muted-foreground">审批时间：</span>{formatDisplayDateTime(disposal.approvedAt)}</div>}
              {disposal.approvedByName && <div><span className="text-muted-foreground">审批人：</span>{disposal.approvedByName}</div>}
              {disposal.disposedAt && <div><span className="text-muted-foreground">处置时间：</span>{formatDisplayDateTime(disposal.disposedAt)}</div>}
              {disposal.remark && <div className="col-span-3"><span className="text-muted-foreground">备注：</span>{disposal.remark}</div>}
              {disposal.rejectReason && <div className="col-span-3 text-destructive"><span className="text-muted-foreground">驳回原因：</span>{disposal.rejectReason}</div>}
            </div>

            <div>
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium border-b pb-1 mb-1">
                <div className="col-span-2">编码</div>
                <div className="col-span-3">名称</div>
                <div className="col-span-1">单位</div>
                <div className="col-span-1">数量</div>
                <div className="col-span-2">成本单价</div>
                <div className="col-span-2">小计</div>
                <div className="col-span-1">处置方式</div>
              </div>
              {disposal.items?.map(item => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center py-1 border-b last:border-0 text-sm">
                  <div className="col-span-2 text-doc-code">{item.productCode}{item.articleNumber ? <span className="ml-1 text-xs text-muted-foreground">货 {item.articleNumber}</span> : null}</div>
                  <div className="col-span-3">{item.productName}<div className="text-xs text-muted-foreground">{item.spec || ''}{item.spec && item.color ? ' · ' : ''}{item.color || ''}</div></div>
                  <div className="col-span-1 text-muted-foreground">{item.unit}</div>
                  <div className="col-span-1 tabular-nums">{item.quantity}</div>
                  <div className="col-span-2 tabular-nums">¥{item.unitValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</div>
                  <div className="col-span-2 tabular-nums">¥{item.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</div>
                  <div className="col-span-1">
                    <SoftStatusLabel label={DISPOSE_TYPE_LABELS[item.disposeType]} tone={DISPOSE_TYPE_TONES[item.disposeType]} />
                  </div>
                  {item.remark && <div className="col-span-12 text-xs text-muted-foreground">行备注：{item.remark}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {canSubmit && (
            <Button onClick={() => confirmAction({
              title: '提交审批',
              description: '提交后处置单进入待审批状态，草稿将不可再修改。',
              confirmText: '提交',
              onConfirm: () => run(() => mutation.submit.mutateAsync(disposal!.id), '已提交审批'),
            })} disabled={mutation.submit.isPending || actionLocked}>提交审批</Button>
          )}
          {canApprove && (
            <>
              <Button onClick={() => confirmAction({
                title: '审批通过',
                description: '审批通过后即可执行处置（降价促销/退货供应商/报废将扣减库存）。',
                confirmText: '通过',
                onConfirm: () => run(() => mutation.approve.mutateAsync(disposal!.id), '已审批通过'),
              })} disabled={mutation.approve.isPending || actionLocked}>审批通过</Button>
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={mutation.reject.isPending || actionLocked}>驳回</Button>
            </>
          )}
          {canDispose && (
            <Button variant="destructive" onClick={() => confirmAction({
              title: '执行处置',
              description: '将按明细扣减库存（降价促销/退货供应商出库、报废另留台账），此操作不可撤销。',
              confirmText: '执行处置',
              variant: 'destructive',
              onConfirm: () => run(() => mutation.dispose.mutateAsync(disposal!.id), '处置完成'),
            })} disabled={mutation.dispose.isPending || actionLocked}>执行处置</Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => confirmAction({
              title: '取消处置单',
              description: '取消后不可恢复。',
              confirmText: '取消',
              variant: 'destructive',
              onConfirm: () => run(() => mutation.cancel.mutateAsync(disposal!.id), '已取消'),
            })} disabled={mutation.cancel.isPending || actionLocked}>取消</Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={actionLocked}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>驳回处置单</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <Label>驳回原因</Label>
          <Input value={rejectReason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRejectReason(e.target.value)} placeholder="必填，将展示给经办人" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRejectOpen(false)}>取消</Button>
          <Button variant="destructive" disabled={!rejectReason.trim() || mutation.reject.isPending}
            onClick={() => {
              run(() => mutation.reject.mutateAsync({ id: disposal!.id, reason: rejectReason.trim() }), '已驳回')
              setRejectOpen(false)
            }}>确认驳回</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
