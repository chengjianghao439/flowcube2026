import { useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

/** 已应用筛选复用现有收货列表标签路径，不增加持久缓存。 */
export function getInboundListWorkspacePath(): string {
  const tab = useWorkspaceStore.getState().tabs.find(item => item.key === '/inbound-tasks')
  return tab && buildWorkspaceTabRegistrationFromPath(tab.path).key === '/inbound-tasks' ? tab.path : '/inbound-tasks'
}
