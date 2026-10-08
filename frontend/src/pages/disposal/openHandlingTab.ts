import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { resolveRouteTitle } from '@/router/routeDefinitions'
import { toast } from '@/lib/toast'

export function openHandlingTab(path: string, navigate: (path: string) => void) {
  const tab = buildWorkspaceTabRegistrationFromPath(path), workspace = useWorkspaceStore.getState(), existing = workspace.tabs.find(t => t.key === tab.key)
  if (!existing && workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，原草稿保留，请先关闭不需要的页面'); return false }
  if (workspace.addTab(existing ?? { ...tab, title: resolveRouteTitle(tab.path) ?? '处理来源' })) { navigate(existing?.path ?? tab.path); return true }
  return false
}
