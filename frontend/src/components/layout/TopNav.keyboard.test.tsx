// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TopNav } from './TopNav'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { hasPermission, type PermissionRequirement } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'

const permissions = vi.hoisted(() => ({ granted: null as string[] | null }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({
  can: (required: PermissionRequirement) => permissions.granted === null || hasPermission(permissions.granted, required),
}) }))
vi.mock('@/pages/supplier-refunds/RefundRecoveryPage', () => ({ RefundRecoveryEntry: () => null }))
vi.mock('@/pages/disposal/DisposalRecoveryPage', () => ({ DisposalRecoveryEntry: () => null }))
vi.mock('@/pages/sale/RepeatSaleRecoveryPage', () => ({ RepeatSaleRecoveryEntry: () => null }))

let navigate: NavigateFunction
function Harness() {
  const location = useLocation()
  navigate = useNavigate()
  return <><TopNav /><output aria-label="当前地址">{location.pathname}</output></>
}

let host: HTMLDivElement
let root: Root
let user: ReturnType<typeof userEvent.setup>

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  permissions.granted = null
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  user = userEvent.setup()
  await act(async () => root.render(<MemoryRouter initialEntries={['/dashboard']}><Harness /></MemoryRouter>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [] })
})

const saleTrigger = () => within(host).getByRole('button', { name: '销售' })
const saleMenu = () => within(host).getByRole('menu', { name: '销售' })

test.each(['{Enter}', '[Space]', '{ArrowDown}', '{ArrowUp}'])('销售导航用 %s 开启并进入，Escape 关闭并回到触发器', async key => {
  const trigger = saleTrigger()
  trigger.focus()
  await act(async () => user.keyboard(key))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(trigger.getAttribute('aria-controls')).toBe(saleMenu().id)
  const links = within(saleMenu()).getAllByRole('menuitem')
  expect(document.activeElement).toBe(key === '{ArrowUp}' ? links.at(-1) : links[0])

  await act(async () => user.keyboard('{Escape}'))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(within(host).queryByRole('menu', { name: '销售' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('在销售导航中用方向键移动并可用 Enter 打开当前链接', async () => {
  const trigger = saleTrigger()
  trigger.focus()
  await act(async () => user.keyboard('{ArrowDown}'))
  const links = within(saleMenu()).getAllByRole<HTMLAnchorElement>('menuitem')
  await act(async () => user.keyboard('{End}'))
  expect(document.activeElement).toBe(links.at(-1))
  await act(async () => user.keyboard('{ArrowDown}'))
  expect(document.activeElement).toBe(links[0])
  await act(async () => user.keyboard('{ArrowDown}'))
  expect(document.activeElement).toBe(links[1])
  await act(async () => user.keyboard('{Home}{Enter}'))
  expect(within(host).getByLabelText('当前地址').textContent).toBe('/sale')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(links[0].getAttribute('aria-current')).toBe('page')
  expect(document.activeElement).toBe(trigger)
})

test('Tab 会离开已经打开的销售导航', async () => {
  const trigger = saleTrigger()
  trigger.focus()
  await act(async () => user.keyboard('{ArrowDown}'))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await act(async () => user.tab())
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(within(host).getByRole('button', { name: '库存' }))
})

test('鼠标仍可悬停后选择，悬停状态可用 Escape 关闭且不会移走外部焦点', async () => {
  const trigger = saleTrigger()
  const dashboard = within(host).getByRole('link', { name: '仪表盘' })
  dashboard.focus()
  await act(async () => user.hover(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(dashboard)

  await act(async () => user.keyboard('{Escape}'))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(dashboard)

  await act(async () => user.unhover(trigger))
  await act(async () => user.hover(trigger))
  await act(async () => user.click(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await act(async () => user.click(within(saleMenu()).getByRole('menuitem', { name: '销售订单' })))
  expect(within(host).getByLabelText('当前地址').textContent).toBe('/sale')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

test('悬停展开后首次鼠标点击保持打开，再点击同一入口收起', async () => {
  const trigger = saleTrigger()
  await act(async () => user.hover(trigger))
  await act(async () => user.click(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await act(async () => user.click(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

test('键盘进入菜单后点同一触发器会收起并回焦', async () => {
  const trigger = saleTrigger()
  trigger.focus()
  await act(async () => user.keyboard('{ArrowDown}'))
  expect(document.activeElement).toBe(within(saleMenu()).getAllByRole('menuitem')[0])
  await act(async () => user.click(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
})

test('从菜单反向 Tab 回到触发器时收起', async () => {
  const trigger = saleTrigger()
  trigger.focus()
  await act(async () => user.keyboard('{ArrowDown}'))
  await act(async () => user.tab({ shift: true }))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
})

test('通过顶栏以外的入口换页时收起菜单并保留外部焦点', async () => {
  const trigger = saleTrigger()
  const dashboard = within(host).getByRole('link', { name: '仪表盘' })
  dashboard.focus()
  await act(async () => user.hover(trigger))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await act(async () => navigate('/refunds'))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(dashboard)
})

test('仅能进入补货建议时使用该页面名称作为顶栏链接', async () => {
  permissions.granted = [PERMISSIONS.REPORT_VIEW]
  await act(async () => navigate('/reports/replenishment'))
  const link = within(host).getByRole('link', { name: '采购建议' })
  expect(link.getAttribute('href')).toBe('/reports/replenishment')
  expect(within(host).queryByRole('link', { name: '采购' })).toBeNull()
})

test('短窗口系统菜单按触发器位置预留滚动空间，视口变化后重算', async () => {
  const trigger = within(host).getByRole('button', { name: '系统' })
  vi.stubGlobal('innerHeight', 600)
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ bottom: 91 } as DOMRect)
  trigger.focus()
  await act(async () => user.keyboard('{ArrowDown}'))
  const menu = within(host).getByRole('menu', { name: '系统' })
  expect(menu.style.getPropertyValue('--topnav-menu-height')).toBe('497px')
  await act(async () => user.keyboard('{End}'))
  expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem').at(-1))

  vi.stubGlobal('innerHeight', 480)
  act(() => window.dispatchEvent(new Event('resize')))
  expect(menu.style.getPropertyValue('--topnav-menu-height')).toBe('377px')
})
