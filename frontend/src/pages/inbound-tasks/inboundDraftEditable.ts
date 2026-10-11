import type { InboundTask } from '@/types/inbound-tasks'
/** 无未删容器由服务端资格标志确认；详情已有明细时再逐行核对零值。 */
export function isInboundDraftEditable(task?: InboundTask): boolean {
  return !!task && Number.isSafeInteger(task.id) && task.id > 0 && task.draftEditable === true && task.status === 1 && task.submittedAt == null
    && (task.items === undefined || task.items.length > 0 && task.items.every(row => row.receivedQty === 0 && row.putawayQty === 0))
}
