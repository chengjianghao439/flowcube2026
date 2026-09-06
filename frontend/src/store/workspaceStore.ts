import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getMergedPageGroup } from '@/router/mergedPageGroups'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
export { PATH_TITLES } from '@/router/routeDefinitions'

export interface WorkspaceTab {
  key: string        // 唯一标识，对列表页即路径本身
  title: string
  path: string
  closable: boolean
}

export const HOME_TAB: WorkspaceTab = {
  key: '/dashboard',
  title: '仪表盘',
  path: '/dashboard',
  closable: false,
}

/** 工作区标签上限（2026-08-21 审计 C.3 修复）：keepAlive 组件实例永久累积，
 *  无上限会让内存/DOM 随使用时长单调增长。超出上限按 LRU 关闭最旧可关闭 tab。 */
export const MAX_WORKSPACE_TABS = 30

function isDesktopWorkspacePath(path: string) {
  return !(path === '/pda' || path.startsWith('/pda/'))
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeKey: string
  /** 添加标签，若已存在则激活并返回 true */
  addTab: (tab: Omit<WorkspaceTab, 'closable'>) => boolean
  /** 关闭标签，返回关闭后应激活的 key */
  removeTab: (key: string, currentActiveKey?: string) => string
  setActive: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
  syncFromLocation: (path: string, title?: string) => void
}

/** 旧快捷入口与持久化标题同步新名称，不改其他单据的自定义标题。 */
function currentTabTitle(path: string, fallback: string): string {
  return getMergedPageGroup(path)?.title
    ?? (path.split(/[?#]/)[0] === '/reports/role-workbench' ? '待办中心' : fallback)
}

function sanitizeTabs(rawTabs: unknown): WorkspaceTab[] {
  const tabs = Array.isArray(rawTabs) ? rawTabs as Partial<WorkspaceTab>[] : []
  const deduped = new Map<string, WorkspaceTab>()
  deduped.set(HOME_TAB.key, HOME_TAB)
  for (const tab of tabs) {
    const rawPath = typeof tab.path === 'string' && tab.path ? tab.path : (typeof tab.key === 'string' ? tab.key : '')
    if (!rawPath) continue
    if (!isDesktopWorkspacePath(rawPath)) continue
    const normalized = buildWorkspaceTabRegistrationFromPath(rawPath)
    if (normalized.key === HOME_TAB.key) continue
    deduped.set(normalized.key, {
      key: normalized.key,
      path: normalized.path,
      title: currentTabTitle(normalized.path, typeof tab.title === 'string' && tab.title ? tab.title : normalized.path),
      closable: true,
    })
  }
  // 持久化恢复也受上限约束（2026-08-21 审计 C.3 修复）：超出裁剪掉最旧的
  const all = Array.from(deduped.values())
  if (all.length > MAX_WORKSPACE_TABS) {
    return [HOME_TAB, ...all.slice(all.length - MAX_WORKSPACE_TABS + 1)]
  }
  return all
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      activeKey: HOME_TAB.key,

      addTab: (tab) => {
        const { tabs } = get()
        if (!isDesktopWorkspacePath(tab.path)) return false
        const normalized = buildWorkspaceTabRegistrationFromPath(tab.path)
        const title = currentTabTitle(normalized.path, tab.title)
        const existing = tabs.find((t) => t.key === normalized.key)
        if (existing) {
          set({
            tabs: tabs.map((item) => (
              item.key === normalized.key
                ? { ...item, title, path: normalized.path }
                : item
            )),
            activeKey: normalized.key,
          })
          return true
        }
        // LRU 上限（2026-08-21 审计 C.3 修复）：超出 MAX_WORKSPACE_TABS 时
        // 关闭最旧的可关闭 tab（keepAlive 组件实例随之卸载），防止无限累积。
        let next = [...tabs, { ...tab, key: normalized.key, path: normalized.path, title, closable: true }]
        if (next.length > MAX_WORKSPACE_TABS) {
          const lru = next.findIndex(t => t.closable)
          if (lru !== -1) {
            next = next.filter((_, i) => i !== lru)
          }
        }
        set({
          tabs: next,
          activeKey: normalized.key,
        })
        return true
      },

      removeTab: (key, currentActiveKey) => {
        const { tabs, activeKey } = get()
        const effectiveActiveKey = currentActiveKey ?? activeKey
        if (key === HOME_TAB.key) return effectiveActiveKey
        const idx = tabs.findIndex(t => t.key === key)
        if (idx === -1) return effectiveActiveKey
        const newTabs = tabs.filter(t => t.key !== key)
        const newActive = effectiveActiveKey === key
          ? (newTabs[Math.max(0, idx - 1)]?.key ?? HOME_TAB.key)
          : effectiveActiveKey
        set({ tabs: newTabs, activeKey: newActive })
        return newActive
      },

      setActive: (key) => set({ activeKey: key }),

      closeOthers: (key) => {
        const { tabs } = get()
        set({
          tabs: tabs.filter(t => !t.closable || t.key === key),
          activeKey: key,
        })
      },

      closeAll: () => set({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }),

      syncFromLocation: (path, title) => {
        if (!isDesktopWorkspacePath(path)) return
        const normalized = buildWorkspaceTabRegistrationFromPath(path)
        const { tabs } = get()
        const existing = tabs.find((tab) => tab.key === normalized.key)
        if (!existing) {
          set({
            tabs: [
              ...tabs,
              {
                key: normalized.key,
                path: normalized.path,
                title: currentTabTitle(normalized.path, title || normalized.path),
                closable: normalized.key !== HOME_TAB.key,
              },
            ],
            activeKey: normalized.key,
          })
          return
        }
        const nextTitle = currentTabTitle(normalized.path, title || existing.title)
        set({
          tabs: tabs.map((tab) => (
            tab.key === normalized.key
              ? { ...tab, path: normalized.path, title: nextTitle }
              : tab
          )),
          activeKey: normalized.key,
        })
      },
    }),
    {
      name: 'flowcube-workspace',
      partialize: (s) => ({ tabs: s.tabs }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<WorkspaceState> | undefined) ?? {}
        return {
          ...currentState,
          tabs: sanitizeTabs(persisted.tabs),
          activeKey: HOME_TAB.key,
        }
      },
    }
  )
)
