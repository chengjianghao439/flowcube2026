import { useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

/** 已应用条件属于现有销售列表标签的路径；返回前确定目标，避免先请求默认范围。 */
export function getSaleListWorkspacePath(): string {
  const tab = useWorkspaceStore.getState().tabs.find(item => item.key === '/sale')
  return tab && buildWorkspaceTabRegistrationFromPath(tab.path).key === '/sale'
    ? tab.path
    : '/sale'
}
