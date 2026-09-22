import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PATH_TITLES, resolveRouteTitle } from '@/router/routeDefinitions'
import { getMergedPageView } from '@/router/mergedPageGroups'
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
  /**
   * 只改标签标题，不改变激活态。
   * 详情页数据到位后用它把路由兜底名（如「销售单 #3260」）换成真实业务单号；
   * 不能改用 addTab —— 那会 setActive，数据晚到时会把用户从别的标签拽回来。
   */
  updateTabTitle: (path: string, title: string) => void
}

/** 旧快捷入口与持久化标题同步新名称，不改其他单据的自定义标题。 */
function currentTabTitle(path: string, fallback: string): string {
  const base = path.split(/[?#]/)[0]
  if (['/payments/payable','/payments/receivable','/reports/reconciliation/payable','/reports/reconciliation/receivable'].includes(base)) return PATH_TITLES[base]
  // 合并页（采购建议 / 报表中心 / 仓库运营）用**子页名**做标签，而不是组合名：
  // 组内切换虽只更新同一个标签，但标签一直叫「报表中心」会让用户看不出当前在看哪个子页。
  return getMergedPageView(path)?.view.label
    ?? (base === '/reports/role-workbench' ? '待办中心' : PATH_TITLES[base] ?? fallback)
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
        const fallbackTitle = resolveRouteTitle(normalized.path) ?? normalized.path
        // 详情页用业务单号调过 updateTabTitle 后，路由兜底名不得再覆盖回来：
        // KeepAliveOutlet 每次路由变化都会拿「销售单 #3260」重设标题，而它的 effect 晚于
        // 子组件执行——不挡一下，数据已缓存的场景（切走再切回）标签就又变回主键了。
        // 地址变了（切到另一张单）时照旧用新兜底名，随后由页面再换成新单号。
        const keepPageTitle = existing.path.split(/[?#]/)[0] === normalized.path.split(/[?#]/)[0]
          && !!existing.title && existing.title !== fallbackTitle
        const nextTitle = currentTabTitle(normalized.path, keepPageTitle ? existing.title : (title || existing.title))
        set({
          tabs: tabs.map((tab) => (
            tab.key === normalized.key
              ? { ...tab, path: normalized.path, title: nextTitle }
              : tab
          )),
          activeKey: normalized.key,
        })
      },

      updateTabTitle: (path, title) => {
        if (!isDesktopWorkspacePath(path) || !title) return
        const normalized = buildWorkspaceTabRegistrationFromPath(path)
        const { tabs } = get()
        if (!tabs.some(t => t.key === normalized.key)) return
        set({ tabs: tabs.map(t => (t.key === normalized.key ? { ...t, title } : t)) })
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
