import { PERMISSIONS as P, type PermissionCode } from '@/lib/permission-codes'
import { money } from '@/lib/format'
import type { PendingApproval } from '@/types/approval'

export const PENDING_APPROVAL_PERMISSIONS = [P.APPROVAL_TASK_VIEW, P.PURCHASE_ORDER_APPROVE, P.INVENTORY_DISPOSAL_APPROVE, P.FINANCE_EXPENSE_APPROVE, P.SUPPLIER_REFUND_CONFIRM] as const
export const pendingApprovalRowKey = (row: PendingApproval) => row.entryKey || `engine-task:${row.taskId}`
export const pendingApprovalProgress = (row: PendingApproval) => row.sourceKind === 'document' ? '业务单级审核' : `第 ${row.currentStep} 级待审`
export function pendingApprovalTime(row: PendingApproval) {
  return row.sourceKind === 'document'
    ? row.bizType === 'expense_claim' ? { label: '提交时间', value: row.submittedAt } : { label: '创建时间', value: row.createdAt }
    : { label: '提交时间', value: row.createdAt }
}
export function pendingApprovalAmountLabel(row: PendingApproval) {
  if (row.sourceKind === 'document') return row.bizType === 'inventory_disposal' ? '参考估值' : '单据总额'
  return row.bizType === 'product_price' ? '新单价' : row.bizType === 'sale_credit_override' ? '超额金额' : row.bizType === 'purchase_requisition' ? '估算金额' : '原审批金额'
}

/** 静态业务身份与既有原单入口；不能从标题或服务端URL猜测业务类型。 */
export function pendingApprovalAmount(row: Pick<PendingApproval, 'bizType'|'amount'>) { return row.bizType === 'supplier_refund' ? Number.isFinite(row.amount) ? `¥${row.amount.toFixed(4)}` : '—' : money(row.amount) }

export const APPROVAL_BUSINESS: Record<string, { label: string; permission: PermissionCode; path: (id: number) => string }> = {
  supplier_refund: { label: '供应商退款', permission: P.SUPPLIER_REFUND_VIEW, path: id => `/supplier-refunds?detailId=${id}` },
  purchase_requisition: { label: '采购申请单', permission: P.PURCHASE_REQUISITION_VIEW, path: id => `/purchase-requisitions/${id}` },
  purchase_order: { label: '采购单', permission: P.PURCHASE_ORDER_VIEW, path: id => `/purchase/${id}` },
  sale_credit_override: { label: '超额放行', permission: P.SALE_CREDIT_OVERRIDE_VIEW, path: id => `/credit-overrides?detailId=${id}` },
  product_price: { label: '商品改价', permission: P.PRODUCT_VIEW, path: id => `/price-change?detailId=${id}` },
  inventory_disposal: { label: '滞销处理单', permission: P.INVENTORY_DISPOSAL_VIEW, path: id => `/disposals?detailId=${id}` },
  expense_claim: { label: '费用报销', permission: P.FINANCE_EXPENSE_VIEW, path: id => `/finance/expenses?detailId=${id}` },
}

export function approvalSource(bizType: string, id: number, can: (permission: PermissionCode) => boolean) {
  const meta = Object.hasOwn(APPROVAL_BUSINESS, bizType) ? APPROVAL_BUSINESS[bizType] : undefined
  const reason = !meta ? '暂不支持此单据类型'
    : !Number.isSafeInteger(id) || id <= 0 ? '原单编号无效'
      : !can(meta.permission) || bizType === 'supplier_refund' && ![P.PURCHASE_ORDER_VIEW,P.RETURN_ORDER_VIEW,P.PAYMENT_VIEW].every(p=>can(p)) ? '没有查看原单的权限' : ''
  return { label: meta?.label ?? '未知审批类型', path: reason || !meta ? null : meta.path(id), reason }
}

/** 列表页复用原标签，只替换审批定位；既有筛选与旧URL参数原样保留。 */
export function approvalNavigationPath(path: string, tabs: readonly { path: string }[]) {
  const [pathname, search = ''] = path.split('?')
  const incoming = new URLSearchParams(search)
  if (!incoming.has('detailId')) return path
  const existing = tabs.find(tab => tab.path.split('?')[0] === pathname)
  const params = new URLSearchParams(existing?.path.split('?')[1] || '')
  params.set('detailId', incoming.get('detailId')!)
  return `${pathname}?${params.toString()}`
}
