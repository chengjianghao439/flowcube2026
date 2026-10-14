import { useRef, useState } from 'react'
import { closePurchaseApi, type ClosePurchaseResult } from '@/api/purchase'
import { commercialReadConfig } from '@/api/sale-commercial'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import { hasPermission } from '@/lib/permissions'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/store/authStore'
import { useInvalidate } from './useInvalidate'
import { captureKitReadOwner } from './useKits'
import { useKitOperation, type KitOperationConfirmation } from './useKitOperation'

/** Use the existing durable query identity; only this mount can retry its original {}. */
export function useClosePurchase() {
  const [owner] = useState(captureKitReadOwner)
  const active = useSectionActive(), current = useRef(active)
  current.current = active
  const invalidate = useInvalidate()
  const write = useKitOperation<Record<string, never>, ClosePurchaseResult>(owner, 'purchase-close-remaining', {
    isCurrent: () => current.current,
    execute: (_body, query, originalOwner) => closePurchaseApi(query.resourceId!, query.requestKey, commercialReadConfig(originalOwner)),
    validate: (result, query) => !!result && result.purchaseOrderId === query.resourceId
      && result.status === 3 && result.closedReason === 'short_close',
    mayWrite: () => {
      const user = useAuthStore.getState().user
      return !!user && hasPermission(user.permissions, PERMISSIONS.PURCHASE_ORDER_CONFIRM, user.roleId)
    },
  })
  async function confirmed(answer: KitOperationConfirmation<Record<string, never>, ClosePurchaseResult> | null) {
    if (!answer || !write.canView(answer)) return null
    void invalidate('purchase_close')
    toast.success(`采购单 #${answer.data.purchaseOrderId} 已结束剩余采购`)
    return answer.data
  }
  return {
    isPending: write.busy,
    blocked: write.blocked,
    error: write.error,
    pendingRecord: write.pending,
    canRetry: write.canRetry,
    submit: (id: number) => Number.isSafeInteger(id) && id > 0
      ? write.submit({}, { action: `purchase.closeRemaining.${id}`, kind: 'close-remaining', resourceType: 'purchase_order', resourceId: id }).then(confirmed)
      : Promise.resolve(null),
    retry: () => write.retry().then(confirmed),
    check: () => write.queryOriginal().then(confirmed),
  }
}
