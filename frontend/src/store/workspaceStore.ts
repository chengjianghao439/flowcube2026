import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
export { PATH_TITLES } from '@/router/routeRegistry'

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

function sanitizeTabs(rawTabs: unknown): WorkspaceTab[] {
  const tabs = Array.isArray(rawTabs) ? rawTabs as Partial<WorkspaceTab>[] : []
  const deduped = new Map<string, WorkspaceTab>()
  deduped.set(HOME_TAB.key, HOME_TAB)
  for (const tab of tabs) {
    const rawPath = typeof tab.path === 'string' && tab.path ? tab.path : (typeof tab.key === 'string' ? tab.key : '')
    if (!rawPath) continue
    const normalized = buildWorkspaceTabRegistrationFromPath(rawPath)
    if (normalized.key === HOME_TAB.key) continue
    deduped.set(normalized.key, {
      key: normalized.key,
      path: normalized.path,
      title: typeof tab.title === 'string' && tab.title ? tab.title : normalized.path,
      closable: true,
    })
  }
  return Array.from(deduped.values())
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      activeKey: HOME_TAB.key,

      addTab: (tab) => {
        const { tabs } = get()
        const normalized = buildWorkspaceTabRegistrationFromPath(tab.path)
        const title = tab.title
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
        set({
          tabs: [...tabs, { ...tab, key: normalized.key, path: normalized.path, title, closable: true }],
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
                title: title || normalized.path,
                closable: normalized.key !== HOME_TAB.key,
              },
            ],
            activeKey: normalized.key,
          })
          return
        }
        const nextTitle = title || existing.title
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
