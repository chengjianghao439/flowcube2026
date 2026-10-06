import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { captureReorderOwner, positiveReorderId, reorderEpoch, reorderOwnerCurrent, subscribeReorder } from '@/lib/saleReorder'
import { toast } from '@/lib/toast'
export function ReorderSourceButton({ sourceId, model, disabled = false }: { sourceId: number; model: 'ordinary' | 'kit-v1'; disabled?: boolean }) {
  const { can } = usePermission(), navigate = useNavigate()
  const [owner] = useState(captureReorderOwner)
  useSyncExternalStore(subscribeReorder, reorderEpoch)
  const current = reorderOwnerCurrent(owner)
  if (!can(PERMISSIONS.SALE_ORDER_CREATE) || !can(PERMISSIONS.SALE_ORDER_VIEW)) return null
  function open() {
    if (disabled || !reorderOwnerCurrent(owner) || !positiveReorderId(sourceId) || !can(PERMISSIONS.SALE_ORDER_CREATE) || !can(PERMISSIONS.SALE_ORDER_VIEW)) return
    const registration = buildWorkspaceTabRegistrationFromPath(`/sale/${model === 'kit-v1' ? 'new-kit' : 'new'}?sourceId=${sourceId}`)
    const workspace = useWorkspaceStore.getState(), existing = workspace.tabs.find(t => t.key === registration.key)
    if (existing) { workspace.setActive(existing.key); navigate(existing.path); return }
    if (workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，请先关闭不需要的页面，再按原单新建'); return }
    if (workspace.addTab({ ...registration, title: model === 'kit-v1' ? '新建套销售' : '新建销售单' })) navigate(registration.path)
  }
  return <Button variant="outline" disabled={disabled || !current} title={current ? undefined : '账号、权限或服务器已变化，请重新打开原单后再开'} onClick={open}>按这张单再开</Button>
}
