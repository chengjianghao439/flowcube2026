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
    <ConfirmDialog open={taskId != null && !action.pendingRecord} title="结束收货"
      description="供应商短装、不再继续收货时使用：剩余未收数量作罢。实收已全部上架时立即完成并结算；有待上架货物时，全部上架后再结算。采购剩余量另按采购单处理。"
      confirmText="确定结束收货"
      loading={action.isPending}
      onConfirm={() => { if (taskId != null) void resolve(() => action.submit(taskId)) }}
      onCancel={onClose} />
  </>
}
