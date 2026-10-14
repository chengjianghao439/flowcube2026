import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PATH_TITLES, resolveRouteTitle, isRegisteredErpRoute } from '@/router/routeDefinitions'
import { getMergedPageView } from '@/router/mergedPageGroups'
import { buildWorkspaceTabRegistrationFromPath, mergeWorkspaceViewPaths, normalizeWorkspacePath } from '@/router/workspaceRouteMeta'
import { useDirtyGuardStore } from './dirtyGuardStore'
import { toast } from '@/lib/toast'
export { PATH_TITLES } from '@/router/routeDefinitions'

export interface WorkspaceTab {
  key: string        // 唯一标识，对列表页即路径本身
  title: string
  path: string
  closable: boolean
  viewPaths?: Record<string, string>
}

export const HOME_TAB: WorkspaceTab = {
  key: '/dashboard',
  title: '仪表盘',
  path: '/dashboard',
  closable: false,
}

/** 工作区标签上限（2026-08-21 审计 C.3 修复）：keepAlive 组件实例永久累积，
 *  无上限会让内存/DOM 随使用时长单调增长。只驱逐最近最少访问的无草稿标签。 */
export const MAX_WORKSPACE_TABS = 30
export const WORKSPACE_CAPACITY_MESSAGE = '打开的页面已达上限，请先保存或关闭一个页面。'

function isDesktopWorkspacePath(path: string) {
  return !(path === '/pda' || path.startsWith('/pda/'))
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeKey: string
  /** 本次工作区访问顺序，最早在前；不跨刷新持久化。 */
  recentKeys: string[]
  /** 添加标签，若已存在则激活并返回 true */
  addTab: (tab: Omit<WorkspaceTab, 'closable'>) => boolean
  /** 关闭标签，返回关闭后应激活的 key */
  removeTab: (key: string, currentActiveKey?: string) => string
  setActive: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
  syncFromLocation: (path: string, title?: string) => boolean
  /**
   * 只改标签标题，不改变激活态。
   * 详情页数据到位后用它把路由兜底名（如「销售单 #3260」）换成真实业务单号；
   * 不能改用 addTab —— 那会 setActive，数据晚到时会把用户从别的标签拽回来。
   */
  updateTabTitle: (path: string, title: string) => void
}

function visitedKeys(tabs: WorkspaceTab[], recentKeys: string[], activeKey: string) {
  const keys = new Set(tabs.map(tab => tab.key))
  const recent = recentKeys.filter(key => keys.has(key) && key !== activeKey)
  const known = new Set(recent)
  return [...tabs.filter(tab => tab.key !== activeKey && !known.has(tab.key)).map(tab => tab.key), ...recent, ...(keys.has(activeKey) ? [activeKey] : [])]
}

/** 脏登记可能带 query 或合并页子路径，按原路由身份保护整个标签。 */
function isDirtyTab(tab: WorkspaceTab) {
  return Object.entries(useDirtyGuardStore.getState().dirtyTabs).some(([path, dirty]) => (
    dirty && buildWorkspaceTabRegistrationFromPath(path).key === tab.key
  ))
}

function evictionCandidates(tabs: WorkspaceTab[], recentKeys: string[]) {
  const ordered = visitedKeys(tabs, recentKeys, '')
  return ordered.map(key => tabs.find(item => item.key === key)).filter((item): item is WorkspaceTab => !!item && item.closable && !isDirtyTab(item))
}

function admitTab(tabs: WorkspaceTab[], recentKeys: string[], tab: WorkspaceTab): WorkspaceTab[] | null {
  const candidates = evictionCandidates(tabs, recentKeys)
  const removeCount = Math.max(0, tabs.length + 1 - MAX_WORKSPACE_TABS)
  if (candidates.length < removeCount) {
    toast.warning(WORKSPACE_CAPACITY_MESSAGE)
    return null
  }
  const removeKeys = new Set(candidates.slice(0, removeCount).map(item => item.key))
  return [...tabs.filter(item => !removeKeys.has(item.key)), tab]
}

/** 旧快捷入口与持久化标题同步新名称，不改其他单据的自定义标题。 */
function currentTabTitle(path: string, fallback: string): string {
  const base = path.split(/[?#]/)[0]
  const merged = getMergedPageView(path)
  if (merged?.group.tabTitle === 'group') return merged.group.title
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
      viewPaths: mergeWorkspaceViewPaths(normalized.path, deduped.get(normalized.key)?.viewPaths, deduped.get(normalized.key)?.path, tab.viewPaths),
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
      recentKeys: [HOME_TAB.key],

      addTab: (tab) => {
        const { tabs, recentKeys } = get()
        if (!isDesktopWorkspacePath(tab.path)) return false
        const normalized = buildWorkspaceTabRegistrationFromPath(tab.path)
        const title = currentTabTitle(normalized.path, tab.title)
        const existing = tabs.find((t) => t.key === normalized.key)
        if (existing) {
          set({
            tabs: tabs.map((item) => (
              item.key === normalized.key
                ? { ...item, title, path: normalized.path, viewPaths: mergeWorkspaceViewPaths(normalized.path, item.viewPaths, item.path, tab.viewPaths) }
                : item
            )),
            activeKey: normalized.key,
            recentKeys: visitedKeys(tabs, recentKeys, normalized.key),
          })
          return true
        }
        const next = admitTab(tabs, recentKeys, { ...tab, key: normalized.key, path: normalized.path, title, closable: true, viewPaths: mergeWorkspaceViewPaths(normalized.path, tab.viewPaths) })
        if (!next) return false
        set({
          tabs: next,
          activeKey: normalized.key,
          recentKeys: visitedKeys(next, recentKeys, normalized.key),
        })
        return true
      },

      removeTab: (key, currentActiveKey) => {
        const { tabs, activeKey, recentKeys } = get()
        const effectiveActiveKey = currentActiveKey ?? activeKey
        if (key === HOME_TAB.key) return effectiveActiveKey
        const idx = tabs.findIndex(t => t.key === key)
        if (idx === -1) return effectiveActiveKey
        const newTabs = tabs.filter(t => t.key !== key)
        const newActive = effectiveActiveKey === key
          ? (newTabs[Math.max(0, idx - 1)]?.key ?? HOME_TAB.key)
          : effectiveActiveKey
        set({ tabs: newTabs, activeKey: newActive, recentKeys: visitedKeys(newTabs, recentKeys, newActive) })
        return newActive
      },

      setActive: (key) => {
        const { tabs, recentKeys } = get()
        if (tabs.some(tab => tab.key === key)) set({ activeKey: key, recentKeys: visitedKeys(tabs, recentKeys, key) })
      },

      closeOthers: (key) => {
        const { tabs, recentKeys } = get()
        const kept = tabs.filter(t => !t.closable || t.key === key)
        set({
          tabs: kept,
          activeKey: key,
          recentKeys: visitedKeys(kept, recentKeys, key),
        })
      },

      closeAll: () => set({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [HOME_TAB.key] }),

      syncFromLocation: (path, title) => {
        if (!isDesktopWorkspacePath(path)) return false
        const normalized = buildWorkspaceTabRegistrationFromPath(path)
        const { tabs, recentKeys } = get()
        const existing = tabs.find((tab) => tab.key === normalized.key)
        if (!existing) {
          const next = admitTab(tabs, recentKeys, {
            key: normalized.key,
            path: normalized.path,
            title: currentTabTitle(normalized.path, title || normalized.path),
            closable: normalized.key !== HOME_TAB.key,
            viewPaths: mergeWorkspaceViewPaths(normalized.path),
          })
          if (!next) return false
          set({
            tabs: next,
            activeKey: normalized.key,
            recentKeys: visitedKeys(next, recentKeys, normalized.key),
          })
          return true
        }
        const fallbackTitle = resolveRouteTitle(normalized.path) ?? normalized.path
        // 详情页用业务单号调过 updateTabTitle 后，路由兜底名不得再覆盖回来：
        // KeepAliveOutlet 每次路由变化都会拿「销售单 #3260」重设标题，而它的 effect 晚于
        // 子组件执行——不挡一下，数据已缓存的场景（切走再切回）标签就又变回主键了。
        // 地址变了（切到另一张单）时照旧用新兜底名，随后由页面再换成新单号。
        const keepPageTitle = existing.path.split(/[?#]/)[0] === normalized.path.split(/[?#]/)[0]
          && !!existing.title && existing.title !== fallbackTitle
        const nextTitle = currentTabTitle(normalized.path, keepPageTitle ? existing.title : (title || existing.title))
        const viewPaths = mergeWorkspaceViewPaths(normalized.path, existing.viewPaths, existing.path)
        const unchanged = existing.path === normalized.path && existing.title === nextTitle
          && Object.keys(existing.viewPaths ?? {}).length === Object.keys(viewPaths ?? {}).length
          && Object.entries(viewPaths ?? {}).every(([key, value]) => existing.viewPaths?.[key] === value)
        set({
          tabs: unchanged ? tabs : tabs.map((tab) => (
            tab.key === normalized.key
              ? { ...tab, path: normalized.path, title: nextTitle, viewPaths }
              : tab
          )),
          activeKey: normalized.key,
          recentKeys: visitedKeys(tabs, recentKeys, normalized.key),
        })
        return true
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
        const tabs = sanitizeTabs(persisted.tabs)
        return {
          ...currentState,
          tabs,
          activeKey: HOME_TAB.key,
          recentKeys: tabs.map(tab => tab.key),
        }
      },
    }
  )
)

/** 历史遍历消费前的只读预检，登录/PDA/未知地址仍由原路由负责。 */
export function canOpenWorkspacePath(path: string) {
  const pathname = normalizeWorkspacePath(path)
  if (!isDesktopWorkspacePath(path) || !isRegisteredErpRoute(pathname)) return true
  const { tabs, recentKeys } = useWorkspaceStore.getState()
  const key = buildWorkspaceTabRegistrationFromPath(path).key
  return tabs.some(tab => tab.key === key) || tabs.length < MAX_WORKSPACE_TABS
    || evictionCandidates(tabs, recentKeys).length >= tabs.length + 1 - MAX_WORKSPACE_TABS
}
