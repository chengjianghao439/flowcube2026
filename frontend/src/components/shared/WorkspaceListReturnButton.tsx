import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { hasPermission, type PermissionRequirement } from '@/lib/permissions'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { getApiClientBaseURL } from '@/api/client'

/** 复用列表原查询与既有脏稿确认；只关闭当前来源页，不创建业务请求。 */
export function WorkspaceListReturnButton({ listPath, permission, tabKey, disabled = false, children = '返回列表' }: {
  listPath: string
  permission: PermissionRequirement
  tabKey: string
  disabled?: boolean
  children?: ReactNode
}) {
  const navigate = useNavigate(), { can } = usePermission()
  const latestDisabled = useRef(disabled), mounted = useRef(true)
  latestDisabled.current = disabled
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (!can(permission)) return null
  return <Button type="button" variant="outline" disabled={disabled} onClick={() => {
    const owner = useAuthStore.getState(), baseURL = getApiClientBaseURL(), workspace = useWorkspaceStore.getState()
    const tab = workspace.tabs.find(item => item.key === tabKey)
    confirmDirtyLeave({
      dirtyKeys: [tabKey],
      willNavigate: false,
      proceed: () => {
        // 确认期间登录/服务器、同键草稿或正在提交的状态变化，旧离开动作失格。
        const current = useAuthStore.getState(), store = useWorkspaceStore.getState(), user = current.user
        if (!mounted.current || latestDisabled.current || current.sessionGeneration !== owner.sessionGeneration
          || user?.id !== owner.user?.id || getApiClientBaseURL() !== baseURL
          || store.activeKey !== workspace.activeKey || store.tabs.find(item => item.key === tabKey) !== tab
          || !hasPermission(user?.permissions ?? [], permission, user?.roleId ?? 5)) return
        const target = getWorkspaceListPath(listPath), dirty = useDirtyGuardStore.getState()
        if (dirty.hasAnyDirtyIn([tabKey])) dirty.setBypassNextBlock(true)
        store.removeTab(tabKey)
        navigate(target)
      },
    })
  }}>{children}</Button>
}
