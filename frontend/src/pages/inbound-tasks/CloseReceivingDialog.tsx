import { useRef } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { Button } from '@/components/ui/button'
import { useCloseReceivingInbound } from '@/hooks/useInboundTasks'
import type { CloseReceivingResult } from '@/api/inbound-tasks'

/** 列表与详情共用；回执固定原单，后来的另一单不会被旧回调关闭。 */
export default function CloseReceivingDialog({ taskId, onClose, onDone }: { taskId: number | null; onClose: () => void; onDone?: (result: CloseReceivingResult) => void }) {
  const action = useCloseReceivingInbound()
  const { can } = usePermission()
  const currentTarget = useRef(taskId)
  currentTarget.current = taskId
  async function resolve(execute: () => Promise<CloseReceivingResult | null>) {
    const result = await execute()
    if (result && currentTarget.current === result.taskId) { onClose(); onDone?.(result) }
  }
  return <>
    {action.pendingRecord && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 space-y-2 text-sm">
      <p>收货单 #{action.pendingRecord.taskId} 结束收货结果未确认。原提交保留，查询前请勿换单重新操作。</p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={action.isPending} onClick={() => { void resolve(action.check) }}>查询原提交结果</Button>
        <Button variant="outline" disabled={action.isPending || !can(PERMISSIONS.INBOUND_ORDER_CANCEL)} onClick={() => { void resolve(action.retry) }}>按原请求重试</Button>
      </div>
    </div>}
    <ConfirmDialog open={taskId != null && !action.pendingRecord} title="结束本次收货"
      description="本次实收全部上架后结算，未收采购余量保留，可另建批次补收。"
      confirmText="结束本次收货"
      loading={action.isPending}
      onConfirm={() => { if (taskId != null) void resolve(() => action.submit(taskId)) }}
      onCancel={onClose} />
  </>
}
