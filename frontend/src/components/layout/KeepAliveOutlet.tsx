/**
 * KeepAliveOutlet — 多标签 keep-alive 渲染引擎
 *
 * 核心原理：
 * - 所有已打开标签页的组件同时挂载到 DOM
 * - 非激活标签用 CSS display:none 隐藏，保留组件实例和内存状态
 * - 激活标签正常显示，切换时无重新挂载、无重复请求
 * - URL 变化时自动同步到 workspace store（支持浏览器前进/后退）
 * - 懒激活：Tab 首次成为 active 时才渲染，之后持续保留
 *
 * 动态路由支持：
 * - PATH_PATTERNS 中注册的正则模式可匹配动态路径（如 /sale/new、/sale/:id）
 * - 每个 TabPanel 通过 TabPathContext 把自己的路径传给页面组件
 *   （页面组件用 useContext(TabPathContext) 读取，无需依赖 useLocation）
 *
 * Dirty Guard（Layer 2 兜底）：
 * - 监听 popstate，浏览器前进/后退若离开有未保存内容的激活 tab 会确认
 * - 工作区切换标签、顶栏导航不拦截（KeepAlive 保留草稿）
 */

import { Suspense, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { usePermission } from '@/hooks/usePermission'
import {
  normalizeWorkspacePath as normalizePath,
  getWorkspaceFullPath as getFullPath,
  buildWorkspaceTabRegistration,
  buildWorkspaceTabRegistrationFromPath,
} from '@/router/workspaceRouteMeta'
import {
  PATH_TITLES,
  isRegisteredErpRoute,
  resolveRouteComponent,
  resolveRoutePermission,
  resolveRouteTitle,
} from '@/router/routeRegistry'
import { getHashRouterWindowLocation } from '@/router/hashLocation'
import { TabPathContext } from './TabPathContext'

// ── 加载占位 ──────────────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
      <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      加载中...
    </div>
  )
}

// ── 单个标签面板 ──────────────────────────────────────────────────────────────
interface TabPanelProps {
  tabKey: string
  path: string
  isActive: boolean
}

function TabPanel({ tabKey, path, isActive }: TabPanelProps) {
  // 首次激活前不渲染，激活后永久保留（keep-alive 核心）
  const mountedRef = useRef(false)
  if (isActive) mountedRef.current = true
  if (!mountedRef.current) return null

  const Comp = resolveComponent(path)

  return (
    // TabPathContext 向下传递该 Tab 自己的路径，供动态路由页面读取
    <TabPathContext.Provider value={path}>
      <div
        key={tabKey}
        style={{ display: isActive ? 'block' : 'none' }}
        className="h-full overflow-y-auto"
      >
        <div className="p-6">
          {Comp ? (
            <Suspense fallback={<PageLoader />}>
              <Comp />
            </Suspense>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              页面 &ldquo;{path}&rdquo; 未注册
            </div>
          )}
        </div>
      </div>
    </TabPathContext.Provider>
  )
}

// ── 主渲染器 ──────────────────────────────────────────────────────────────────
export function KeepAliveOutlet() {
  const location = useLocation()
  const navigate = useNavigate()
  const { tabs, syncFromLocation } = useWorkspaceStore()
  const { can } = usePermission()
  const locationRegistration = buildWorkspaceTabRegistration(location.pathname, location.search)
  const activeKey = locationRegistration.key

  /**
   * Dirty Guard — Layer 2：兜底拦截浏览器前进/后退
   *
   * 注意：useBlocker 仅支持 Data Router；项目使用 HashRouter + popstate 实现离开确认。
   *
   * 工作流程：
   * 1. popstate 触发时 URL 已变，用 replaceState 恢复原 URL
   * 2. 检查当前激活 tab 是否 dirty
   * 3. dirty → 弹确认框 → 确认后 navigate(targetPath)
   * 4. 非 dirty → 直接放行（replaceState 到 targetPath）
   */
  const locationPathRef = useRef(getFullPath(location.pathname, location.search))
  useEffect(() => {
    locationPathRef.current = getFullPath(location.pathname, location.search)
  }, [location.pathname, location.search])

  useEffect(() => {
    const handlePopState = () => {
      const targetLocation = getHashRouterWindowLocation()
      const targetPathname = getFullPath(targetLocation.pathname, targetLocation.search)
      const currentPathname = locationPathRef.current

      if (targetPathname === currentPathname) return

      const store     = useDirtyGuardStore.getState()
      const activeKey = buildWorkspaceTabRegistrationFromPath(currentPathname).key

      if (!store.isTabDirty(activeKey)) return

      // 恢复原 URL，让用户感知到"被拦截了"
      window.history.replaceState(null, '', currentPathname)

      store.showConfirm(
        '当前内容尚未保存，确定离开吗？',
        () => navigate(targetPathname),
      )
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  // 仅挂载一次；pathnameRef / navigate 通过引用访问，始终最新
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * URL → workspace 同步 + 权限拦截
   * 触发场景：浏览器前进/后退、侧边栏 href 导航、外部 navigate() 调用
   */
  useEffect(() => {
    const path = getFullPath(location.pathname, location.search)
    const rawPathname = path.split(/[?#]/)[0] || '/'
    const normalizedPath = normalizePath(path)
    const tabRegistration = buildWorkspaceTabRegistration(location.pathname, location.search)

    if (path !== tabRegistration.path) {
      navigate(tabRegistration.path, { replace: true })
      return
    }

    if (normalizedPath === '/' || normalizedPath === '/dashboard') {
      syncFromLocation(HOME_TAB.path, HOME_TAB.title)
      return
    }

    if (!isKnownPath(normalizedPath)) return

    // 权限拦截
    const requiredPerm = resolvePermission(normalizedPath)
    if (requiredPerm && !can(requiredPerm)) {
      navigate('/403', { replace: true })
      return
    }

    // 如果 tab 已存在（由导航发起方提前 addTab），则只激活；
    // 否则用 PATH_TITLES 或动态默认标题注册新 tab。
    const patternCfg = PATH_PATTERNS.find(p => p.pattern.test(normalizedPath))
    const title = PATH_TITLES[normalizedPath] ?? patternCfg?.defaultTitle(normalizedPath) ?? normalizedPath
    syncFromLocation(tabRegistration.path, title)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  const currentPath = getFullPath(location.pathname, location.search)
  const normalizedCurrentPath = normalizePath(currentPath)
  if (normalizedCurrentPath !== '/' && normalizedCurrentPath !== '/dashboard' && !isKnownPath(normalizedCurrentPath)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card-base w-full max-w-xl p-6 text-center">
          <h2 className="text-lg font-semibold text-foreground">页面不存在</h2>
          <p className="mt-2 text-sm text-muted-foreground">当前地址未注册为 ERP 页面：{currentPath}</p>
        </div>
      </div>
    )
  }

  const renderTabs = tabs.some((tab) => tab.key === activeKey) || normalizedCurrentPath === '/' || normalizedCurrentPath === '/dashboard'
    ? tabs
    : [
        ...tabs,
        {
          key: locationRegistration.key,
          path: locationRegistration.path,
          title: PATH_TITLES[normalizedCurrentPath]
            ?? PATH_PATTERNS.find((p) => p.pattern.test(normalizedCurrentPath))?.defaultTitle(normalizedCurrentPath)
            ?? normalizedCurrentPath,
          closable: locationRegistration.key !== HOME_TAB.key,
        },
      ]

  return (
    <div className="relative h-full w-full">
      {renderTabs.map(tab => (
        <TabPanel
          key={tab.key}
          tabKey={tab.key}
          path={tab.path}
          isActive={activeKey === tab.key}
        />
      ))}
    </div>
  )
}
