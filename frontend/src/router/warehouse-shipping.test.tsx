// @vitest-environment jsdom
import { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildTopNavSections, resolveRoutePermission, routeRegistry } from './routeDefinitions'
import { resolveRouteComponent } from './routeRegistry'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useAuthStore } from '@/store/authStore'

const state = vi.hoisted(() => ({ electron: false }))
vi.mock('@/lib/platform', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/platform')>(),
  isElectronRuntime: () => state.electron,
}))
const PATH = '/warehouse-shipping'
const SHIP = PERMISSIONS.WAREHOUSE_TASK_SHIP
let host: HTMLDivElement
let root: Root
const previousAuth = useAuthStore.getState()
function permissions(held: string[]) {
  useAuthStore.setState({ user: { id: 301, username: 'shipping-fixture', realName: '作业员', roleId: 81, roleName: '仓库作业员', permissions: held } })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.electron = false
  permissions([SHIP])
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useAuthStore.setState(previousAuth, true)
})
async function renderPage() {
  const Page = resolveRouteComponent(PATH)
  expect(Page, '发货菜单必须指向真实已注册页面').toBeDefined()
  if (!Page) return
  // 等真实页面模块就绪，避免把 Suspense 的暂态当作业务结果。
  await import('@/pages/warehouse-shipping')
  await act(async () => { root.render(<MemoryRouter><Suspense fallback="加载中"><Page /></Suspense></MemoryRouter>) })
}
test('仅有仓库发货权限也能在仓储菜单找到已注册入口', () => {
  const sections = buildTopNavSections(perm => hasPermission([SHIP], perm, 81))
  const warehouse = sections.find(section => section.kind === 'menu' && section.label === '仓储')
  expect(warehouse?.kind === 'menu' ? warehouse.children : []).toContainEqual(expect.objectContaining({ path: PATH, label: '仓库发货' }))
  expect(routeRegistry.find(route => route.path === PATH)).toMatchObject({ title: '仓库发货', permission: SHIP })
  expect(resolveRoutePermission(PATH)).toBe(SHIP)
})
test('无发货权限时菜单隐藏，注册页面仍明确要求发货权限', () => {
  const paths = buildTopNavSections(perm => hasPermission([PERMISSIONS.INVENTORY_VIEW], perm, 81))
    .flatMap(section => section.kind === 'menu' ? section.children.map(child => child.path) : [section.path])
  expect(paths).not.toContain(PATH)
  expect(resolveRoutePermission(PATH)).toBe(SHIP)
  expect(hasPermission([], resolveRoutePermission(PATH)!, 81)).toBe(false)
})
test('浏览器入口新开真实PDA出库页并说明设备绑定要求', async () => {
  await renderPage()
  expect(host.querySelector('h1')?.textContent).toBe('仓库发货')
  const link = host.querySelector<HTMLAnchorElement>('a[href="#/pda/ship"]')
  expect(link?.textContent).toBe('打开 PDA 出库确认')
  expect(link?.target).toBe('_blank')
  expect(link?.rel).toContain('noopener')
  expect(host.textContent).toContain('已绑定')
})
test('撤销发货权限后移除PDA入口', async () => {
  await renderPage()
  await act(async () => permissions([]))
  expect(host.querySelector('a[href="#/pda/ship"]')).toBeNull()
})
test('桌面壳禁止新窗口时只提供真实设备操作说明', async () => {
  state.electron = true
  await renderPage()
  expect(host.querySelector('a[href="#/pda/ship"]')).toBeNull()
  expect(host.textContent).toContain('PDA 工作台')
  expect(host.textContent).toContain('出库确认')
})
