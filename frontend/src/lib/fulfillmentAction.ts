import type { FulfillmentIssue } from '@/api/fulfillment'
import { PERMISSIONS, type PermissionCode } from './permission-codes'

const paths = { sale: '/sale', purchase: '/purchase', inbound: '/inbound-tasks', transfer: '/transfer' }
const safeId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0
export function fulfillmentDocumentPath(issue: Pick<FulfillmentIssue, 'document_type' | 'document_id'>): string | null {
  const path = Object.hasOwn(paths, issue.document_type) ? paths[issue.document_type] : null
  return path && safeId(issue.document_id) ? `${path}/${issue.document_id}${issue.document_type === 'sale' ? '' : '?focus=fulfillment'}` : null
}
export type FulfillmentAction = { path: string | null; label: string; note?: string; itemId?: number }
/** 明确系统键是交接契约；标题、原因与 action_path 仅为历史数据，不能执行。 */
export function explainFulfillmentAction(issue: FulfillmentIssue, can: (permission: PermissionCode) => boolean): FulfillmentAction {
  const original = fulfillmentDocumentPath(issue)
  const fallback: FulfillmentAction = { path: original, label: issue.document_type === 'sale' ? '查看销售订单' : '查看原单事项' }
  if (!original || issue.source !== 'auto' || issue.status === 'resolved') return fallback
  const key = issue.source_key
  const ids = (pattern: RegExp) => {
    const match = typeof key === 'string' ? key.match(pattern) : null
    return match && match[0] === key && match.slice(1).every(value => safeId(Number(value))) ? match.slice(1).map(Number) : null
  }
  if (issue.document_type === 'sale') {
    const reverse = ids(/^(?:return|adjust):([1-9]\d*)$/)
    if (reverse) return { path: `/sale/${issue.document_id}?focus=progress&taskId=${reverse[0]}`, label: key.startsWith('return:') ? '查看拣货退回任务' : '查看改单确认任务' }
    if (ids(/^credit:([1-9]\d*)$/)) return can(PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW)
      ? { path: '/credit-overrides', label: '查看超额放行申请' }
      : { ...fallback, note: '需有超额放行查看权限的同事处理' }
  }
  if (issue.document_type === 'purchase' && key === 'purchase-delay') return { path: original, label: '核对采购到货日期' }
  if (issue.document_type === 'inbound') {
    if (ids(/^putaway:([1-9]\d*)$/)) return { path: `/inbound-tasks/${issue.document_id}?focus=waiting-putaway`, label: '查看待上架条码', note: '仓库需在 PDA 上架入口扫码处理' }
    if (ids(/^print:([1-9]\d*)$/)) return can(PERMISSIONS.PRINT_JOB_VIEW)
      ? { path: `/settings/barcode-print-query?category=inbound&inboundTaskId=${issue.document_id}`, label: '查看打印记录' }
      : { path: original, label: '查看收货进度', note: '需有打印查看权限的同事核对打印记录' }
  }
  return fallback
}
