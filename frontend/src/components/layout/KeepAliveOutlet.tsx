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
 * - 使用 React Router v6 useBlocker 拦截浏览器前进/后退等外部导航
 * - Layer1（WorkspaceTabs / AppLayout）已处理的导航通过 bypassNextBlock 标志跳过
 */

import { lazy, Suspense, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkspaceStore, PATH_TITLES, HOME_TAB } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { usePermission } from '@/hooks/usePermission'
import type { PermCode } from '@/lib/permissions'
import { TabPathContext } from './TabPathContext'

// ── 路径 → 所需权限（固定路径） ──────────────────────────────────────────────
const PATH_PERMS: Record<string, PermCode> = {
  '/dashboard':       'page:dashboard',
  '/sale':            'page:sale',
  '/sale/new':        'page:sale',
  '/purchase':        'page:purchase',
  '/products':        'page:products',
  '/categories':      'page:categories',
  '/warehouses':      'page:warehouses',
  '/inventory':          'page:inventory',
  '/inventory/overview': 'page:inventory',
  '/stockcheck':      'page:stockcheck',
  '/transfer':        'page:transfer',
  '/warehouse-tasks': 'page:warehouse-tasks',
  '/inbound-tasks':   'page:warehouse-tasks',
  '/picking-waves':   'page:warehouse-tasks',
  '/sorting-bins':    'page:warehouse-tasks',
  '/locations':       'page:warehouses',
  '/customers':       'page:customers',
  '/carriers':        'page:carriers',
  '/suppliers':       'page:suppliers',
  '/returns':         'page:returns',
  '/payments':        'page:payments',
  '/users':           'page:users',
  '/permissions':     'page:users',
  '/settings':        'page:settings',
  '/oplogs':          'page:users',
  '/reports':         'page:reports',
  '/reports/wave-performance': 'page:reports',
  '/reports/pda-anomaly':      'page:reports',
  '/reports/warehouse-ops':    'page:reports',
  '/price-lists':               'page:sale',
  '/settings/print-templates':  'page:settings',
  '/settings/printers':          'page:settings',
  '/settings/print-tenant':      'page:settings',
}

// ── 固定路径 → 组件映射（代码分割仍然有效）────────────────────────────────────
const PAGE_MAP: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  '/dashboard':       lazy(() => import('@/pages/dashboard')),
  '/sale':            lazy(() => import('@/pages/sale')),
  '/purchase':        lazy(() => import('@/pages/purchase')),
  '/products':        lazy(() => import('@/pages/products')),
  '/categories':      lazy(() => import('@/pages/categories')),
  '/warehouses':      lazy(() => import('@/pages/warehouses')),
  '/inventory':          lazy(() => import('@/pages/inventory')),
  '/inventory/overview': lazy(() => import('@/pages/inventory/overview')),
  '/stockcheck':      lazy(() => import('@/pages/stockcheck')),
  '/transfer':        lazy(() => import('@/pages/transfer')),
  '/warehouse-tasks': lazy(() => import('@/pages/warehouse-tasks')),
  '/inbound-tasks':   lazy(() => import('@/pages/inbound-tasks')),
  '/picking-waves':   lazy(() => import('@/pages/picking-waves')),
  '/sorting-bins':    lazy(() => import('@/pages/sorting-bins')),
  '/locations':       lazy(() => import('@/pages/locations')),
  '/customers':       lazy(() => import('@/pages/customers')),
  '/carriers':        lazy(() => import('@/pages/carriers')),
  '/suppliers':       lazy(() => import('@/pages/suppliers')),
  '/returns':         lazy(() => import('@/pages/returns')),
  '/payments':        lazy(() => import('@/pages/payments')),
  '/users':           lazy(() => import('@/pages/users')),
  '/permissions':     lazy(() => import('@/pages/permissions')),
  '/settings':        lazy(() => import('@/pages/settings')),
  '/oplogs':          lazy(() => import('@/pages/oplogs')),
  '/reports':         lazy(() => import('@/pages/reports')),
  '/reports/wave-performance': lazy(() => import('@/pages/reports/wave-performance')),
  '/reports/pda-anomaly':      lazy(() => import('@/pages/reports/pda-anomaly')),
  '/reports/warehouse-ops':    lazy(() => import('@/pages/reports/warehouse-ops')),
  '/price-lists':                lazy(() => import('@/pages/price-lists')),
  '/settings/print-templates':  lazy(() => import('@/pages/settings/print-templates')),
  '/settings/printers':          lazy(() => import('@/pages/settings/printers')),
  '/settings/print-tenant':     lazy(() => import('@/pages/settings/print-tenant')),
}

// ── 动态路由：模块级惰性加载（注意：必须在组件外声明，防止每次渲染重新 lazy） ──
const SaleFormPage           = lazy(() => import('@/pages/sale/form'))
const PurchaseFormPage       = lazy(() => import('@/pages/purchase/form'))
const InboundTaskDetailPage  = lazy(() => import('@/pages/inbound-tasks/detail'))
const PrintTemplateEditorPage = lazy(() => import('@/pages/settings/print-templates/editor'))
const PdaWavePage            = lazy(() => import('@/pages/pda/wave'))

// ── 动态路径模式配置 ──────────────────────────────────────────────────────────
interface PathPattern {
  pattern: RegExp
  perm: PermCode
  component: React.LazyExoticComponent<React.ComponentType>
  defaultTitle: (path: string) => string
}

const PATH_PATTERNS: PathPattern[] = [
  {
    pattern: /^\/sale\/(new|\d+)$/,
    perm: 'page:sale',
    component: SaleFormPage,
    defaultTitle: (path) => path === '/sale/new' ? '新建销售单' : `销售单 #${path.split('/').pop()}`,
  },
  {
    pattern: /^\/purchase\/(new|\d+)$/,
    perm: 'page:purchase',
    component: PurchaseFormPage,
    defaultTitle: (path) => path === '/purchase/new' ? '新建采购单' : `采购单 #${path.split('/').pop()}`,
  },
  {
    pattern: /^\/inbound-tasks\/\d+$/,
    perm: 'page:warehouse-tasks',
    component: InboundTaskDetailPage,
    defaultTitle: (path) => `入库任务 #${path.split('/').pop()}`,
  },
  {
    pattern: /^\/settings\/print-templates\/(new|\d+)$/,
    perm: 'page:settings',
    component: PrintTemplateEditorPage,
    defaultTitle: (path) => path.endsWith('/new') ? '新建打印模板' : '编辑打印模板',
  },
  {
    pattern: /^\/wave-scan$/,
    perm: 'page:warehouse-tasks',
    component: PdaWavePage,
    defaultTitle: () => '波次扫码',
  },
]

/** 根据路径解析对应的页面组件（固定路径优先，其次匹配模式） */
function resolveComponent(path: string): React.LazyExoticComponent<React.ComponentType> | undefined {
  if (PAGE_MAP[path]) return PAGE_MAP[path]
  return PATH_PATTERNS.find(p => p.pattern.test(path))?.component
}

/** 根据路径解析权限 code */
function resolvePermission(path: string): PermCode | undefined {
  if (PATH_PERMS[path]) return PATH_PERMS[path]
  return PATH_PATTERNS.find(p => p.pattern.test(path))?.perm
}

/** 路径是否已注册（固定 + 动态） */
function isKnownPath(path: string): boolean {
  if (PATH_TITLES[path]) return true
  return PATH_PATTERNS.some(p => p.pattern.test(path))
}

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
  const { tabs, activeKey, addTab } = useWorkspaceStore()
  const { can } = usePermission()

  /**
   * Dirty Guard — Layer 2：兜底拦截浏览器前进/后退
   *
   * 注意：useBlocker 仅支持 Data Router（createBrowserRouter），
   * 项目使用组件式 BrowserRouter，改用 popstate 事件监听实现相同效果。
   *
   * 工作流程：
   * 1. popstate 触发时 URL 已变，用 replaceState 恢复原 URL
   * 2. 检查当前激活 tab 是否 dirty
   * 3. dirty → 弹确认框 → 确认后 navigate(targetPath)
   * 4. 非 dirty → 直接放行（replaceState 到 targetPath）
   */
  const pathnameRef = useRef(location.pathname)
  useEffect(() => {
    pathnameRef.current = location.pathname
  }, [location.pathname])

  useEffect(() => {
    const handlePopState = () => {
      const targetPathname  = window.location.pathname
      const currentPathname = pathnameRef.current

      if (targetPathname === currentPathname) return

      const store     = useDirtyGuardStore.getState()
      const activeKey = useWorkspaceStore.getState().activeKey

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
    const path = location.pathname

    if (path === '/' || path === '/dashboard') {
      useWorkspaceStore.getState().setActive(HOME_TAB.key)
      return
    }

    if (!isKnownPath(path)) return  // 未注册路径，忽略

    // 权限拦截
    const requiredPerm = resolvePermission(path)
    if (requiredPerm && !can(requiredPerm)) {
      navigate('/403', { replace: true })
      return
    }

    // 如果 tab 已存在（由导航发起方提前 addTab），则只激活；
    // 否则用 PATH_TITLES 或动态默认标题注册新 tab。
    const existingTab = useWorkspaceStore.getState().tabs.find(t => t.key === path)
    if (!existingTab) {
      const patternCfg = PATH_PATTERNS.find(p => p.pattern.test(path))
      const title = PATH_TITLES[path] ?? patternCfg?.defaultTitle(path) ?? path
      addTab({ key: path, title, path })
    } else {
      useWorkspaceStore.getState().setActive(path)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  return (
    <div className="relative h-full w-full">
      {tabs.map(tab => (
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
