import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { toast } from '@/lib/toast'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

/** 原单入口仅注册/激活草稿，来源明细交给退货表单的权威接口读取。 */
export function ReturnSourceButton({ kind, sourceId, sourceNo, disabled = false }: { kind: 'sale' | 'purchase'; sourceId: number; sourceNo: string; disabled?: boolean }) {
  const { can } = usePermission()
  const navigate = useNavigate()
  if (!can(PERMISSIONS.RETURN_ORDER_CREATE)) return null
  function open() {
    if (disabled || !can(PERMISSIONS.RETURN_ORDER_CREATE)) return
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || !sourceNo?.trim()) { toast.warning('原单身份不完整，请重新读取原单'); return }
    const query = new URLSearchParams({ sourceId: String(sourceId), sourceNo: sourceNo.trim() })
    const registration = buildWorkspaceTabRegistrationFromPath(`/returns/${kind}/new?${query}`)
    const workspace = useWorkspaceStore.getState()
    if (!workspace.tabs.some(tab => tab.key === registration.key) && workspace.tabs.length >= MAX_WORKSPACE_TABS) {
      toast.warning('工作区标签已满，请先关闭不需要的页面，再发起退货')
      return
    }
    if (workspace.addTab({ ...registration, title: kind === 'sale' ? '新建销售退货单' : '新建采购退货单' })) navigate(registration.path)
  }
  return <Button variant="outline" disabled={disabled} onClick={open}>发起退货</Button>
}
