import type { DisposalOrder } from '@/types/disposal'
import { money } from '@/lib/format'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { ProductIdentityGridCells, ProductIdentityGridHeaders } from '@/components/shared/ProductIdentityCells'
import { useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { useDisposalDetail, useDisposalMutation } from '@/hooks/useDisposal'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { DISPOSE_TYPE_LABELS, DISPOSE_TYPE_TONES } from '@/types/disposal'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { captureDisposalOwner, disposalEpoch, disposalOwnerCurrent, mayExecuteDisposal, type DisposalOwner } from '@/lib/disposalRecovery'
import { useDisposalExecution } from '@/hooks/useDisposalExecution'
import { DisposalExecutionPanel } from '../DisposalExecutionPanel'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import type { PermissionCode } from '@/lib/permission-codes'
import { DISPOSAL_STATUS_TONE, DISPOSAL_STATUS_LABEL } from '../constants'
import { DISPOSAL_DISPLAY_LABEL } from '@/generated/status'

interface Props { open: boolean; onClose: () => void; id: number | null; initialDetail?: DisposalOrder; actionsDisabled?: boolean }
interface RejectDraft { id: number; owner: DisposalOwner; open: boolean; reason: string }

const STATUS_TONE: Record<number, StatusTone> = DISPOSAL_STATUS_TONE

export default function DisposalDetailDialog({ open, onClose, id, initialDetail, actionsDisabled = false }: Props) {
  const active = useSectionActive(), { can } = usePermission()
  const initialOwner = useRef({ data: initialDetail, owner: captureDisposalOwner() })
  if (initialOwner.current.data !== initialDetail) initialOwner.current = { data: initialDetail, owner: captureDisposalOwner() }
  const validInitial = initialDetail && disposalOwnerCurrent(initialOwner.current.owner)
  const readable = open && active && can(PERMISSIONS.INVENTORY_DISPOSAL_VIEW)
  const { data: loadedDetail, isLoading } = useDisposalDetail(id || 0, readable && !validInitial)
  const disposal = readable ? validInitial ? initialDetail : loadedDetail : undefined
  const mutation = useDisposalMutation()
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, RejectDraft>>({})
  const [actionLocked, setActionLocked] = useState(false)
  const context = useRef({ id, open, active, epoch: disposalEpoch(), actionsDisabled, serial: 0 })
  const old = context.current
  if (old.id !== id || old.open !== open || old.active !== active || old.epoch !== disposalEpoch() || old.actionsDisabled !== actionsDisabled) context.current = { id, open, active, epoch: disposalEpoch(), actionsDisabled, serial: old.serial + 1 }
  const serial = context.current.serial, owner = captureDisposalOwner()
  // 同单返回恢复原输入；账号、服务器或权限代次变化不会借用旧草稿。
  const rejectKey = JSON.stringify([id, owner.userId, owner.baseURL, owner.sessionGeneration, owner.epoch])
  const rejectDraft = rejectDrafts[rejectKey], rejectOpen = rejectDraft?.open ?? false, rejectReason = rejectDraft?.reason ?? ''
  const write = useDisposalExecution(id || 0, readable && !actionsDisabled)
  function mayReadReject(draft: RejectDraft) {
    const current = context.current, user = useAuthStore.getState().user
    return current.serial === serial && current.id === draft.id && disposal?.id === draft.id && current.open && current.active && disposalOwnerCurrent(draft.owner)
      && hasPermission(user?.permissions, PERMISSIONS.INVENTORY_DISPOSAL_VIEW, user?.roleId) && hasPermission(user?.permissions, PERMISSIONS.INVENTORY_DISPOSAL_APPROVE, user?.roleId)
  }
  function updateRejectDraft(change: Partial<Pick<RejectDraft, 'open' | 'reason'>>) {
    if (id === null) return
    const draft = rejectDraft ?? { id, owner, open: false, reason: '' }
    if (mayReadReject(draft)) setRejectDrafts(previous => ({ ...previous, [rejectKey]: { ...draft, ...change } }))
  }
  const setRejectOpen = (next: boolean) => updateRejectDraft({ open: next })
  function mayAct(permission: PermissionCode) {
    const current = context.current, user = useAuthStore.getState().user
    return current.serial === serial && current.id === disposal?.id && current.open && current.active && !current.actionsDisabled && disposalOwnerCurrent(owner) && hasPermission(user?.permissions, permission, user?.roleId)
  }
  async function run(fn: () => Promise<unknown>, successMsg: string, permission: PermissionCode) {
    if (actionLocked || !mayAct(permission)) return
    try { setActionLocked(true); await fn(); if (mayAct(permission)) { toast.success(successMsg); onClose() } }
    finally { setActionLocked(false) }
  }
  const status = disposal?.status
  const allScrap = !!disposal?.items?.length && disposal.items.every(item => item.disposeType === 3)
  const legacyApproved = status === 3 && disposal?.items?.some(item => item.disposeType === 1 || item.disposeType === 2)
  const statusLabel = legacyApproved ? DISPOSAL_DISPLAY_LABEL.LEGACY_APPROVED
    : status == null ? '' : DISPOSAL_STATUS_LABEL[status] ?? disposal?.statusName ?? ''
  const isDraft = status === 1 && !actionsDisabled
  const isPendingApproval = status === 2 && !actionsDisabled
  const isApproved = status === 3 && !actionsDisabled
  const canSubmit = isDraft && allScrap && can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE)
  const canApprove = isPendingApproval && allScrap && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)
  const canReject = isPendingApproval && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)
  const canDispose = isApproved && allScrap && can(PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE)
  const canCancel = (isDraft || isPendingApproval) && can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE)

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!next && !actionLocked) onClose() }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            滞销处理单详情
            {disposal && <SoftStatusLabel label={statusLabel} tone={STATUS_TONE[disposal.status] ?? 'draft'} />}
          </DialogTitle>
        </DialogHeader>
        <OrderDetailSections type="disposal" id={id || 0}>

        {isLoading && <p className="text-center py-8 text-muted-foreground">加载中…</p>}
        {disposal && !allScrap && <p role="alert" className="rounded border p-3">{status === 3 ? '本单含促销、退供应商或异常明细，不能直接扣库。请返回列表选择“整单签认”，核对全部旧行后由另一名人员签认处理意图，再走正常销售、采购退货或重新报废流程；未签认前保持旧单。' : status === 4 ? '历史直接处置记录仅供追溯，不补单、不重算历史金额、不再次执行。' : '本单含旧处理方式；草稿／待审可先取消后手动走正常销售或采购退货，待审仍可按原规则驳回。不能把旧行改成报废。'}</p>}
        <DisposalExecutionPanel write={write} active={readable && !actionsDisabled} />
        {disposal && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-lg bg-muted/30 p-4 text-sm">
              <div><span className="text-muted-foreground">处置单号：</span><span className="text-doc-code-strong">{disposal.disposalNo}</span></div>
              <div><span className="text-muted-foreground">仓库：</span>{disposal.warehouseName}</div>
              <div><span className="text-muted-foreground">经办人：</span>{disposal.operatorName || '-'}</div>
              <div><span className="text-muted-foreground">历史参考总估值：</span><span className="tabular-nums">{money(disposal.totalValue)}</span></div>
              <div><span className="text-muted-foreground">创建时间：</span>{formatDisplayDateTime(disposal.createdAt)}</div>
              {disposal.approvedAt && <div><span className="text-muted-foreground">审批时间：</span>{formatDisplayDateTime(disposal.approvedAt)}</div>}
              {disposal.approvedByName && <div><span className="text-muted-foreground">审批人：</span>{disposal.approvedByName}</div>}
              {disposal.disposedAt && <div><span className="text-muted-foreground">处置时间：</span>{formatDisplayDateTime(disposal.disposedAt)}</div>}
              {disposal.remark && <div className="col-span-3"><span className="text-muted-foreground">备注：</span>{disposal.remark}</div>}
              {disposal.rejectReason && <div className="col-span-3 text-destructive-ink"><span className="text-muted-foreground">驳回原因：</span>{disposal.rejectReason}</div>}
            </div>

            <div className="overflow-x-auto">
              <div className="grid min-w-[1440px] grid-cols-[160px_160px_144px_224px_112px_80px_120px_180px_120px_100px] gap-2 text-xs text-muted-foreground font-medium border-b bg-muted/30 py-3 mb-1">
                <ProductIdentityGridHeaders />
                <div className="">单位</div>
                <div className="">数量</div>
                <div className="">历史参考价</div>
                <div className="">小计</div>
                <div className="">处置方式</div>
              </div>
              {disposal.items?.map(item => (
                <div key={item.id} className="grid min-w-[1440px] grid-cols-[160px_160px_144px_224px_112px_80px_120px_180px_120px_100px] gap-2 items-center py-3 border-b last:border-0 text-sm">
                  <ProductIdentityGridCells product={item} />
                  <div className="text-muted-foreground">{item.unit}</div>
                  <div className="tabular-nums">{item.quantity}</div>
                  <div className="tabular-nums">{money(item.unitValue)}</div>
                  <div className="tabular-nums">{money(item.value)}</div>
                  <div className="">
                    <SoftStatusLabel label={DISPOSE_TYPE_LABELS[item.disposeType]} tone={DISPOSE_TYPE_TONES[item.disposeType]} />
                  </div>
                  {item.remark && <div className="col-span-full text-xs text-muted-foreground">行备注：{item.remark}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        </OrderDetailSections>
        <DialogFooter className="gap-2">
          {canSubmit && (
            <Button onClick={() => confirmAction({
              title: '提交审批',
              description: '提交后处置单进入待审批状态，草稿将不可再修改。',
              confirmText: '提交',
              onConfirm: () => run(() => mutation.submit.mutateAsync(disposal!.id), '已提交审批', PERMISSIONS.INVENTORY_DISPOSAL_CREATE),
            })} disabled={mutation.submit.isPending || actionLocked}>提交审批</Button>
          )}
          {canApprove && (
            <>
              <Button onClick={() => confirmAction({
                title: '审批通过',
                description: '审批通过后可执行整单报废，按原库存可用量与商品数量规则扣库并留台账。',
                confirmText: '通过',
                onConfirm: () => run(() => mutation.approve.mutateAsync(disposal!.id), '已审批通过', PERMISSIONS.INVENTORY_DISPOSAL_APPROVE),
              })} disabled={mutation.approve.isPending || actionLocked}>审批通过</Button>

            </>
          )}
          {canReject && <Button variant="outline" onClick={() => { if (mayAct(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)) setRejectOpen(true) }} disabled={mutation.reject.isPending || actionLocked}>驳回</Button>}
          {canDispose && (
            <Button variant="destructive" onClick={() => confirmAction({
              title: '执行报废',
              description: '将整单报废，按原明细扣减库存条码余量并留报废台账，此操作不可撤销。未知结果须核对原请求，不能另发执行。',
              confirmText: '执行报废',
              variant: 'destructive',
              onConfirm: async () => {
                if (!mayAct(PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE) || !mayExecuteDisposal() || write.blocked) return
                const result = await write.execute()
                if (result && write.canApply(result) && mayAct(PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE)) { toast.success('报废完成'); onClose() }
              },
            })} disabled={write.blocked || actionLocked}>执行报废</Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => confirmAction({
              title: '取消处置单',
              description: '取消后不可恢复。',
              confirmText: '取消',
              variant: 'destructive',
              onConfirm: () => run(() => mutation.cancel.mutateAsync(disposal!.id), '已取消', PERMISSIONS.INVENTORY_DISPOSAL_CREATE),
            })} disabled={mutation.cancel.isPending || actionLocked}>取消</Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={actionLocked}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={rejectOpen && readable && status === 2 && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)} onOpenChange={setRejectOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>驳回处置单</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <Label>驳回原因</Label>
          <textarea aria-label="驳回原因" className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={rejectReason} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateRejectDraft({ reason: e.target.value })} placeholder="必填，将展示给经办人" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRejectOpen(false)}>取消</Button>
          <Button variant="destructive" disabled={actionsDisabled || !rejectReason.trim() || mutation.reject.isPending}
            onClick={() => {
              if (!rejectDraft || !rejectDraft.reason.trim() || !mayReadReject(rejectDraft) || !mayAct(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)) return
              run(() => mutation.reject.mutateAsync({ id: rejectDraft.id, reason: rejectDraft.reason.trim() }), '已驳回', PERMISSIONS.INVENTORY_DISPOSAL_APPROVE)
              setRejectOpen(false)
            }}>确认驳回</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
