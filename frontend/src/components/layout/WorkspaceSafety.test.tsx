// @vitest-environment jsdom
import { act, useContext, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AppLayout from '@/layouts/AppLayout'
import { TabPathContext } from './TabPathContext'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { HOME_TAB, MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { disposeWorkspaceHistoryGuard, initializeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { toast } from '@/lib/toast'

const pages = vi.hoisted(() => ({ crashPath: '', crashValue: null as unknown, mounts: new Map<string, number>(), unmounts: new Map<string, number>(), update: new Map<string, (value: string) => void>() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/router/routeRegistry', async original => ({ ...await original<typeof import('@/router/routeRegistry')>(), resolveRouteComponent: () => SyntheticPage }))
vi.mock('@/components/shared/BrandLogo', () => ({ default: () => null }))
vi.mock('@/components/shared/GlobalSearch', () => ({ default: () => null }))
vi.mock('@/components/shared/NotificationBell', () => ({ default: () => null }))
vi.mock('@/components/shared/UserMenu', () => ({ default: () => null }))
vi.mock('@/components/shared/GlobalConfirmDialog', () => ({ GlobalConfirmDialog: () => null }))
vi.mock('@/components/shared/AppToast', () => ({ AppToast: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function SyntheticPage() {
  const path = useContext(TabPathContext)
  const [draft, setDraft] = useState('')
  const [late, setLate] = useState('')
  const [filter, setFilter] = useState('原筛选')
  useDirtyGuard(path, !!draft)
  useEffect(() => {
    pages.mounts.set(path, (pages.mounts.get(path) ?? 0) + 1); pages.update.set(path, setLate)
    return () => { pages.unmounts.set(path, (pages.unmounts.get(path) ?? 0) + 1); pages.update.delete(path) }
  }, [path])
  if (pages.crashPath === path) throw pages.crashValue
  return <section data-page={path}>
    <input aria-label={`草稿 ${path}`} value={draft} onChange={event => setDraft(event.target.value)} />
    <input aria-label={`筛选 ${path}`} value={filter} onChange={event => setFilter(event.target.value)} />
    <output>{late}</output>
  </section>
}

let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let navigate: NavigateFunction
let warning: ReturnType<typeof vi.spyOn>
function Harness() {
  navigate = useNavigate(); const location = useLocation()
  return <><output data-route>{location.pathname + location.search}</output><AppLayout /></>
}
async function mount(path = '/sale/1') {
  window.history.replaceState({ idx: 0 }, '', `#${path}`)
  await act(async () => root.render(<HashRouter><Harness /></HashRouter>))
}
async function open(path: string) { await act(async () => navigate(path)) }
function route() { return host.querySelector('[data-route]')?.textContent }
function input(path: string, field = '草稿') { return host.querySelector<HTMLInputElement>(`input[aria-label="${field} ${path}"]`) }
async function enter(path: string, value: string, field = '草稿') {
  const element = input(path, field)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(text: string, role?: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>(role ? `button[role="${role}"]` : 'button')].find(item => item.textContent === text)!
  expect(button).toBeDefined(); await act(async () => button.click())
}
function fill() {
  for (let id = 1; id < MAX_WORKSPACE_TABS; id++) useWorkspaceStore.getState().addTab({ key: `/sale/${id}`, path: `/sale/${id}`, title: `SO-${id}` })
}
function dirtyAll() {
  for (const tab of useWorkspaceStore.getState().tabs) if (tab.closable) useDirtyGuardStore.getState().setDirty(tab.key, true)
}
async function productMenu() {
  const menu = [...host.querySelectorAll('nav button')].find(button => button.textContent?.startsWith('库存'))!
  await act(async () => menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const link = [...host.querySelectorAll('a')].find(item => item.textContent === '商品管理')!
  expect(link).toBeDefined(); await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}
beforeEach(() => {
  initializeWorkspaceHistoryGuard(); localStorage.clear()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null, bypassNextBlock: false })
  pages.crashPath = ''; pages.crashValue = new Error('合成单页渲染错误'); pages.mounts.clear(); pages.unmounts.clear(); pages.update.clear()
  HTMLElement.prototype.scrollIntoView = vi.fn(); vi.spyOn(console, 'error').mockImplementation(() => {})
  warning = vi.spyOn(toast, 'warning')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); disposeWorkspaceHistoryGuard(); vi.restoreAllMocks() })

test('31st menu tab evicts a clean page and preserves dirty component, filter and scroll', async () => {
  fill(); await mount(); await enter('/sale/1', '尚未保存的原草稿'); await enter('/sale/1', '已应用筛选', '筛选')
  const original = input('/sale/1')!; const scroll = original.closest<HTMLElement>('[data-workspace-scroll]')!; scroll.scrollTop = 217
  await productMenu()
  expect(route()).toBe('/products'); expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
  expect(input('/sale/1')).toBe(original); expect(original.value).toBe('尚未保存的原草稿')
  expect(input('/sale/1', '筛选')!.value).toBe('已应用筛选'); expect(scroll.scrollTop).toBe(217)
  expect(useDirtyGuardStore.getState().isTabDirty('/sale/1')).toBe(true); expect(pages.unmounts.get('/sale/1') ?? 0).toBe(0)
  await open('/sale/1'); expect(input('/sale/1')).toBe(original)
})

test('all dirty tabs reject menu registration without losing URL, draft, or exceeding limit', async () => {
  fill(); await mount(); await enter('/sale/1', '保留全部草稿'); dirtyAll()
  const before = useWorkspaceStore.getState().tabs; const original = input('/sale/1')
  await productMenu()
  expect(route()).toBe('/sale/1'); expect(useWorkspaceStore.getState().tabs).toBe(before)
  expect(input('/sale/1')).toBe(original); expect(pages.mounts.get('/products') ?? 0).toBe(0)
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('保存或关闭'))
})

test('direct navigation cannot bypass dirty capacity or mount a temporary 31st page', async () => {
  fill(); await mount(); await enter('/sale/1', '原草稿'); dirtyAll()
  const before = useWorkspaceStore.getState().tabs
  await open('/sale/30?focus=fulfillment')
  expect(route()).toBe('/sale/1'); expect(useWorkspaceStore.getState().tabs).toBe(before)
  expect(pages.mounts.get('/sale/30?focus=fulfillment') ?? 0).toBe(0); expect(input('/sale/1')!.value).toBe('原草稿')
  await open('/sale/31'); expect(route()).toBe('/sale/1'); expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
})

test('direct repeated registration stays bounded and evicts least recently visited clean page', () => {
  fill(); useWorkspaceStore.getState().syncFromLocation('/sale/1', 'SO-1'); useWorkspaceStore.getState().syncFromLocation('/sale/30', 'SO-30')
  expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/1')).toBe(true)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/2')).toBe(false)
  for (let id = 31; id <= 42; id++) useWorkspaceStore.getState().syncFromLocation(`/sale/${id}`, `SO-${id}`)
  expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
})

test('dirty registration by full query path protects its canonical tab', () => {
  fill(); useDirtyGuardStore.getState().setDirty('/sale/1?edit=1', true)
  useWorkspaceStore.getState().addTab({ key: '/sale/30', path: '/sale/30', title: 'SO-30' })
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/1')).toBe(true)
})

test('single-page crash and retry preserve another instance, draft, dirty, filter, scroll and late result', async () => {
  await mount(); await enter('/sale/1', '不受另一页影响'); await enter('/sale/1', '保留筛选', '筛选')
  const original = input('/sale/1')!; const scroll = original.closest<HTMLElement>('[data-workspace-scroll]')!; scroll.scrollTop = 183
  pages.crashPath = '/sale/2'; await open('/sale/2')
  expect(host.textContent).toContain('页面出错'); expect(input('/sale/1')).toBe(original)
  expect(useDirtyGuardStore.getState().isTabDirty('/sale/1')).toBe(true)
  await act(async () => pages.update.get('/sale/1')!('迟到的本页读取')); await open('/sale/1')
  expect(input('/sale/1')!.value).toBe('不受另一页影响'); expect(input('/sale/1', '筛选')!.value).toBe('保留筛选')
  expect(scroll.scrollTop).toBe(183); expect(host.querySelector('[data-page="/sale/1"]')!.textContent).toContain('迟到的本页读取')
  await open('/sale/2'); pages.crashPath = ''; await click('重新加载')
  expect(input('/sale/2')).not.toBeNull(); expect(input('/sale/1')).toBe(original)
  expect(pages.mounts.get('/sale/1')).toBe(1); expect(pages.unmounts.get('/sale/1') ?? 0).toBe(0)
})

test('hidden page crash stays hidden and its recovery does not remount active draft', async () => {
  await mount('/sale/2'); await open('/sale/1'); await enter('/sale/1', '当前页草稿')
  const original = input('/sale/1'); pages.crashPath = '/sale/2'
  await act(async () => pages.update.get('/sale/2')!('隐藏页回调'))
  expect(input('/sale/1')).toBe(original)
  const error = [...host.querySelectorAll('h3')].find(item => item.textContent?.includes('页面出错'))!
  expect(error.closest<HTMLElement>('[data-workspace-scroll]')!.style.display).toBe('none'); expect(route()).toBe('/sale/1')
  await open('/sale/2'); pages.crashPath = ''; await click('重新加载'); await open('/sale/1')
  expect(input('/sale/1')).toBe(original); expect(input('/sale/1')!.value).toBe('当前页草稿')
})

const nonErrorCases: Array<[string, unknown, string]> = [
  ['null', null, 'null'],
  ['undefined', undefined, 'undefined'],
  ['string', '合成字符串异常', '合成字符串异常'],
  ['number', 17, '17'],
  ['boolean', false, 'false'],
  ['object', { message: '合成对象异常' }, '合成对象异常'],
]
test.each(['活动', '隐藏'].flatMap(visibility => nonErrorCases.map(([name, value, message]) => [visibility, name, value, message] as const)))('%s页面抛出%s时安全记录并隔离，保留旁页dirty草稿、筛选、滚动与实例', async (visibility, _name, value, message) => {
  if (visibility === '隐藏') { await mount('/sale/2'); await open('/sale/1') }
  else await mount('/sale/1')
  await enter('/sale/1', '非Error旁页原草稿'); await enter('/sale/1', '原筛选保持', '筛选')
  const original = input('/sale/1')!, scroll = original.closest<HTMLElement>('[data-workspace-scroll]')!
  scroll.scrollTop = 246
  pages.crashValue = value; pages.crashPath = '/sale/2'
  if (visibility === '隐藏') await act(async () => pages.update.get('/sale/2')!('合成隐藏页回调'))
  else await open('/sale/2')
  expect(input('/sale/1')).toBe(original)
  expect(original.value).toBe('非Error旁页原草稿')
  expect(input('/sale/1', '筛选')!.value).toBe('原筛选保持'); expect(scroll.scrollTop).toBe(246)
  expect(useDirtyGuardStore.getState().isTabDirty('/sale/1')).toBe(true)
  expect(pages.mounts.get('/sale/1')).toBe(1); expect(pages.unmounts.get('/sale/1') ?? 0).toBe(0)
  const failure = host.querySelector('h3')!
  expect(failure.textContent).toBe('「销售单 #2」页面出错')
  expect(failure.closest<HTMLElement>('[data-workspace-scroll]')!.style.display).toBe(visibility === '隐藏' ? 'none' : 'block')
  expect(host.textContent).not.toContain('工作区出错')
  expect(console.error).toHaveBeenCalledWith('[TabErrorBoundary]', '销售单 #2', message, expect.any(String))
  await act(async () => pages.update.get('/sale/1')!('保留的本页迟到结果'))
  await open('/sale/2'); pages.crashPath = ''; await click('重新加载'); await open('/sale/1')
  expect(input('/sale/1')).toBe(original); expect(original.value).toBe('非Error旁页原草稿')
  expect(input('/sale/1', '筛选')!.value).toBe('原筛选保持'); expect(scroll.scrollTop).toBe(246)
  expect(useDirtyGuardStore.getState().isTabDirty('/sale/1')).toBe(true)
  expect(host.querySelector('[data-page="/sale/1"]')!.textContent).toContain('保留的本页迟到结果')
})

test('dirty close cancellation and confirmation preserve existing close and list return', async () => {
  await mount('/sale?keyword=original'); await open('/sale/1'); await enter('/sale/1', '待关闭草稿')
  const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭 销售单 #1"]')!
  await act(async () => close.click()); expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  await act(async () => useDirtyGuardStore.getState().resolveConfirm(false))
  expect(route()).toBe('/sale/1'); expect(input('/sale/1')!.value).toBe('待关闭草稿')
  await act(async () => close.click()); await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
  expect(route()).toBe('/sale?keyword=original'); expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/1')).toBe(false)
  expect(useDirtyGuardStore.getState().isTabDirty('/sale/1')).toBe(false)
})

test('close others and all keep original confirmation and selected-page behavior', async () => {
  await mount(); await enter('/sale/1', '原草稿'); await open('/sale/2')
  const menu = host.querySelector<HTMLButtonElement>('button[aria-label="标签操作"]')!
  await act(async () => menu.click()); await click('关闭其他标签', 'menuitem')
  expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  await act(async () => useDirtyGuardStore.getState().resolveConfirm(false)); expect(input('/sale/1')!.value).toBe('原草稿')
  await click('关闭其他标签', 'menuitem'); await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
  expect(useWorkspaceStore.getState().tabs.map(tab => tab.key)).toEqual([HOME_TAB.key, '/sale/2']); expect(route()).toBe('/sale/2')
  await enter('/sale/2', '第二页草稿'); await act(async () => menu.click()); await click('关闭全部标签', 'menuitem')
  await act(async () => useDirtyGuardStore.getState().resolveConfirm(false)); expect(input('/sale/2')!.value).toBe('第二页草稿')
  await click('关闭全部标签', 'menuitem'); await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
  expect(route()).toBe('/dashboard'); expect(useWorkspaceStore.getState().tabs).toEqual([HOME_TAB])
})

test('initial direct entry mounts only its accepted page without starting an unvisited home', async () => {
  await mount('/sale/1')
  expect(pages.mounts.get('/sale/1')).toBe(1)
  expect(pages.mounts.get(HOME_TAB.path) ?? 0).toBe(0)
})

test('existing tabs remain navigable at dirty capacity; saving one page admits one new tab', async () => {
  fill(); await mount(); await enter('/sale/1', '仍需保留'); dirtyAll()
  const original = input('/sale/1')
  await open('/sale/2'); await open('/sale/1')
  expect(input('/sale/1')).toBe(original)
  // 未访问的合成页只有一个守卫登记被明确保存，不改变其他草稿。
  await act(async () => useDirtyGuardStore.getState().setDirty('/sale/3', false))
  await open('/sale/30')
  expect(route()).toBe('/sale/30')
  expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/3')).toBe(false)
  expect(input('/sale/1')).toBe(original)
  expect(input('/sale/1')!.value).toBe('仍需保留')
})

test('setActive and repeated visits update eviction recency without rearranging tab display order', () => {
  fill()
  const before = useWorkspaceStore.getState().tabs.map(tab => tab.key)
  useWorkspaceStore.getState().setActive('/sale/1')
  useWorkspaceStore.getState().setActive('/sale/2')
  useWorkspaceStore.getState().syncFromLocation('/sale/1')
  expect(useWorkspaceStore.getState().tabs.map(tab => tab.key)).toEqual(before)
  useWorkspaceStore.getState().addTab({ key: '/sale/30', path: '/sale/30', title: '新标签' })
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/1')).toBe(true)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/2')).toBe(true)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/3')).toBe(false)
})

test('dirty merged child path protects the group after navigating to its other child', () => {
  useWorkspaceStore.getState().syncFromLocation('/payments/receivable?keyword=old')
  useDirtyGuardStore.getState().setDirty('/payments/receivable?keyword=old', true)
  useWorkspaceStore.getState().syncFromLocation('/reports/reconciliation/receivable?partyId=7')
  for (let id = 1; id <= MAX_WORKSPACE_TABS - 2; id++) useWorkspaceStore.getState().syncFromLocation(`/sale/${id}`)
  useWorkspaceStore.getState().syncFromLocation('/sale/30')
  const financial = useWorkspaceStore.getState().tabs.find(tab => tab.path.startsWith('/reports/reconciliation/receivable'))!
  expect(financial).toBeDefined()
  expect(financial.viewPaths).toMatchObject({ '/payments/receivable': '/payments/receivable?keyword=old', '/reports/reconciliation/receivable': '/reports/reconciliation/receivable?partyId=7' })
  expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
})

test('query-sensitive source drafts protect only their own original identity', () => {
  const a = '/returns/sale/new?sourceId=1', b = '/returns/sale/new?sourceId=2'
  useWorkspaceStore.getState().syncFromLocation(a); useWorkspaceStore.getState().syncFromLocation(b)
  useDirtyGuardStore.getState().setDirty(a, true)
  for (let id = 1; id <= MAX_WORKSPACE_TABS - 3; id++) useWorkspaceStore.getState().syncFromLocation(`/sale/${id}`)
  useWorkspaceStore.getState().syncFromLocation('/sale/30')
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === a)).toBe(true)
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === b)).toBe(false)
})

test('retrying a still-failing page and closing it never remounts the other dirty draft', async () => {
  await mount(); await enter('/sale/1', '旁页保持'); const original = input('/sale/1')
  pages.crashPath = '/sale/2'; await open('/sale/2'); await click('重新加载')
  expect(input('/sale/1')).toBe(original)
  const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭 销售单 #2"]')!
  await act(async () => close.click())
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/2')).toBe(false)
  await open('/sale/1')
  expect(input('/sale/1')).toBe(original); expect(original!.value).toBe('旁页保持')
})

test('persisted tab restore stays bounded and persists neither visit order nor dirty draft state', async () => {
  fill(); useWorkspaceStore.getState().setActive('/sale/1')
  const saved = JSON.parse(localStorage.getItem('flowcube-workspace')!) as { state: Record<string, unknown> }
  expect(Object.keys(saved.state)).toEqual(['tabs'])
  localStorage.setItem('flowcube-workspace', JSON.stringify({ state: { tabs: [HOME_TAB, ...Array.from({ length: 36 }, (_, index) => ({ key: `/sale/${index + 1}`, path: `/sale/${index + 1}`, title: '原标签' }))] }, version: 0 }))
  await useWorkspaceStore.persist.rehydrate()
  expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
  expect(useWorkspaceStore.getState().activeKey).toBe(HOME_TAB.key)
  expect(useWorkspaceStore.getState().tabs[0]).toEqual(HOME_TAB)
})

test('capacity-blocked browser back restores the actual original history entry and keeps forward history', async () => {
  await mount('/sale/30?focus=old'); await open('/sale/1'); await enter('/sale/1', '历史跳转保留')
  await act(async () => { fill(); useWorkspaceStore.getState().setActive('/sale/1'); dirtyAll() })
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === '/sale/30')).toBe(false)
  const original = input('/sale/1'), before = { url: window.location.href, state: window.history.state }
  await act(async () => {
    window.history.back()
    for (let i = 0; i < 50 && (window.location.href !== before.url || !warning.mock.calls.length); i++) await new Promise(resolve => setTimeout(resolve, 5))
  })
  // 修前确认会遍历到容量不允许的目标，再replace为原路径，实际idx已被改写。
  if (useDirtyGuardStore.getState().pendingConfirm) await act(async () => {
    useDirtyGuardStore.getState().resolveConfirm(true)
    await new Promise(resolve => setTimeout(resolve, 30))
  })
  expect(useDirtyGuardStore.getState().pendingConfirm).toBeNull()
  expect(window.location.href).toBe(before.url); expect(window.history.state).toEqual(before.state)
  expect(route()).toBe('/sale/1'); expect(input('/sale/1')).toBe(original)
  expect(pages.mounts.get('/sale/30?focus=old')).toBe(1)
  // 腾一个干净位置后，原后退条目与随后前进条目仍可到达。
  await act(async () => useDirtyGuardStore.getState().setDirty('/sale/3', false))
  await act(async () => {
    window.history.back()
    for (let i = 0; i < 50 && !useDirtyGuardStore.getState().pendingConfirm; i++) await new Promise(resolve => setTimeout(resolve, 5))
  })
  expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  await act(async () => {
    useDirtyGuardStore.getState().resolveConfirm(true)
    for (let i = 0; i < 50 && window.location.hash !== '#/sale/30?focus=old'; i++) await new Promise(resolve => setTimeout(resolve, 5))
  })
  expect(route()).toBe('/sale/30?focus=old')
  await act(async () => {
    window.history.forward()
    for (let i = 0; i < 50 && window.location.href !== before.url; i++) await new Promise(resolve => setTimeout(resolve, 5))
  })
  expect(window.location.href).toBe(before.url); expect(window.history.state).toEqual(before.state)
  expect(input('/sale/1')).toBe(original)
})
