import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'

/** 来源必须由账款 DTO 提供；手工或历史单号不能用前缀反推 ID。 */
export function FinanceOrderLink({ orderId, type, orderNo, enabled = true, onNavigate }: {
  orderId?: number | null
  type?: 1 | 2
  orderNo: string
  enabled?: boolean
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const { can } = usePermission()
  const hasSource = Number.isSafeInteger(orderId) && Number(orderId) > 0 && (type === 1 || type === 2)
  const allowed = hasSource && enabled && can(type === 2 ? PERMISSIONS.SALE_ORDER_VIEW : PERMISSIONS.PURCHASE_ORDER_VIEW)
  return <span className="text-doc-code">
    {allowed ? <button type="button" className="text-primary underline-offset-4 hover:underline focus-visible:underline" onClick={() => {
      const path = `/${type === 2 ? 'sale' : 'purchase'}/${orderId}`
      onNavigate?.()
      addTab({ key: path, path, title: type === 2 ? '销售详情' : '采购详情' })
      navigate(path)
    }}>{orderNo || '原单'}</button> : <span>{orderNo || '—'}</span>}
    {!hasSource && <span className="ml-2 text-xs text-muted-foreground">无法定位原单</span>}
  </span>
}
