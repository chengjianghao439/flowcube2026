// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WorkspaceTabs } from './WorkspaceTabs'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { DirtyGuardDialog } from '@/components/shared/DirtyGuardDialog'
import { resolveRouteTitle } from '@/router/routeDefinitions'

let host: HTMLDivElement, root: Root
function LocationObserver() {
  const location = useLocation()
  const fullPath = location.pathname + location.search
  useEffect(() => {
    useWorkspaceStore.getState().syncFromLocation(fullPath, resolveRouteTitle(location.pathname))
  }, [fullPath, location.pathname])
  return <output data-location>{fullPath}</output>
}
async function render(path = '/sale?keyword=原筛选') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <WorkspaceTabs /><LocationObserver /><DirtyGuardDialog />
  </MemoryRouter>))
}
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
const tab = (title: string) => tabs().find(item => item.textContent?.trim() === title)!
// Router/store canonicalize query encoding; compare the retained user-visible value.
const location = () => decodeURI(host.querySelector('[data-location]')?.textContent ?? '')
const namedButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)!
async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.focus()
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  })
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // JSDOM lacks the browser scrolling API; navigation, stores and dirty dialog stay real.
  Element.prototype.scrollIntoView = vi.fn()
  useWorkspaceStore.setState({ tabs: [HOME_TAB,
    { key: '/sale', path: '/sale?keyword=原筛选', title: '销售订单', closable: true },
    { key: '/products', path: '/products?keyword=商品筛选', title: '商品管理', closable: true },
  ], activeKey: '/sale' })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null, bypassNextBlock: false })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null, bypassNextBlock: false })
})

test('标签栏有 tablist、可聚焦 tab 按钮，关闭按钮独立且键盘可达', async () => {
  await render()
  expect(host.querySelector('[role="tablist"][aria-label="工作区标签"]')).not.toBeNull()
  expect(tabs().map(item => item.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
  expect(tabs().map(item => item.tabIndex)).toEqual([-1, 0, -1])
  expect(tab('销售订单').getAttribute('aria-selected')).toBe('true')
  expect(tabs().some(item => item.querySelector('button'))).toBe(false)
  expect(namedButton('关闭 销售订单').tabIndex).toBe(0)
  expect(namedButton('关闭 商品管理').tabIndex).toBe(0)
})

test('tablist 只包含或拥有标签，关闭按钮不冒充其允许子角色', async () => {
  await render()
  const list = host.querySelector<HTMLElement>('[role="tablist"]')!
  expect(list.querySelectorAll('button:not([role="tab"])')).toHaveLength(0)
  const owned = (list.getAttribute('aria-owns') ?? '').split(' ').filter(Boolean).map(id => document.getElementById(id))
  expect([...list.querySelectorAll('[role="tab"]'), ...owned]).toEqual(tabs())
})

test('左右/Home/End 循环选择并聚焦，保留原 query 且切换不弹脏守卫', async () => {
  await render()
  await act(async () => useDirtyGuardStore.getState().setDirty('/sale', true))
  await key(tab('销售订单'), 'ArrowRight')
  expect(location()).toBe('/products?keyword=商品筛选')
  expect(document.activeElement).toBe(tab('商品管理'))
  expect(tab('商品管理').tabIndex).toBe(0)
  await key(tab('商品管理'), 'ArrowRight')
  expect(location()).toBe('/dashboard')
  await key(tab('仪表盘'), 'End')
  expect(document.activeElement).toBe(tab('商品管理'))
  await key(tab('商品管理'), 'Home')
  expect(document.activeElement).toBe(tab('仪表盘'))
  await key(tab('仪表盘'), 'ArrowLeft')
  expect(location()).toBe('/products?keyword=商品筛选')
  await key(tab('商品管理'), 'ArrowLeft')
  expect(location()).toBe('/sale?keyword=原筛选')
  expect(useDirtyGuardStore.getState().pendingConfirm).toBeNull()
  expect(useDirtyGuardStore.getState().isTabDirty('/sale')).toBe(true)
})

test.each(['Enter', ' '])('%s 在聚焦标签时选择原路径', async value => {
  await render()
  await key(tab('商品管理'), value)
  expect(location()).toBe('/products?keyword=商品筛选')
  expect(document.activeElement).toBe(tab('商品管理'))
})

test('Delete 关闭脏标签须原守卫；取消保留标签、路径和脏状态', async () => {
  await render()
  await act(async () => useDirtyGuardStore.getState().setDirty('/sale', true))
  await key(tab('销售订单'), 'Delete')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(useWorkspaceStore.getState().tabs).toHaveLength(3)
  await click(namedButton('继续编辑'))
  await settle()
  expect(useWorkspaceStore.getState().tabs).toHaveLength(3)
  expect(location()).toBe('/sale?keyword=原筛选')
  expect(useDirtyGuardStore.getState().isTabDirty('/sale')).toBe(true)
  expect(document.activeElement).toBe(tab('销售订单'))
})

test('Delete 确认关闭活动详情后回所属列表并聚焦，不关闭其他标签', async () => {
  useWorkspaceStore.getState().addTab({ key: '/sale/42', path: '/sale/42', title: 'SO42' })
  await render('/sale/42')
  await act(async () => useDirtyGuardStore.getState().setDirty('/sale/42', true))
  await key(tab('SO42'), 'Delete')
  expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  await click(namedButton('确定离开'))
  await settle()
  expect(location()).toBe('/sale')
  expect(useWorkspaceStore.getState().tabs.map(item => item.key)).toEqual(['/dashboard', '/sale', '/products'])
  expect(document.activeElement).toBe(tab('销售订单'))
})

test('独立关闭按钮关闭非活动标签时保留活动路径，仪表盘不能 Delete', async () => {
  await render()
  await click(namedButton('关闭 商品管理'))
  expect(location()).toBe('/sale?keyword=原筛选')
  expect(useWorkspaceStore.getState().tabs.map(item => item.key)).toEqual(['/dashboard', '/sale'])
  await key(tab('仪表盘'), 'Delete')
  expect(useWorkspaceStore.getState().tabs.map(item => item.key)).toEqual(['/dashboard', '/sale'])
  expect(useDirtyGuardStore.getState().pendingConfirm).toBeNull()
})

test('标签操作菜单支持键盘打开、Escape 关闭并回到触发按钮', async () => {
  await render()
  const trigger = namedButton('标签操作')
  await key(trigger, 'ArrowDown'); await settle()
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(namedButton('关闭其他标签'))
  await key(namedButton('关闭其他标签'), 'ArrowDown')
  expect(document.activeElement).toBe(namedButton('关闭全部标签'))
  await key(namedButton('关闭全部标签'), 'ArrowUp')
  expect(document.activeElement).toBe(namedButton('关闭其他标签'))
  await key(namedButton('关闭其他标签'), 'End')
  expect(document.activeElement).toBe(namedButton('关闭全部标签'))
  await key(namedButton('关闭全部标签'), 'Home')
  expect(document.activeElement).toBe(namedButton('关闭其他标签'))
  await key(document.querySelector<HTMLElement>('[role="menuitem"]')!, 'Escape'); await settle()
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('关闭其他/全部沿原脏守卫，取消不删除；确认全部回仪表盘', async () => {
  await render()
  await act(async () => useDirtyGuardStore.getState().setDirty('/products', true))
  await key(namedButton('标签操作'), 'ArrowDown'); await settle()
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await click(namedButton('关闭其他标签'))
  expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  await click(namedButton('继续编辑')); await settle()
  expect(useWorkspaceStore.getState().tabs).toHaveLength(3)
  await key(namedButton('标签操作'), 'ArrowDown'); await settle()
  await click(namedButton('关闭全部标签'))
  await click(namedButton('确定离开')); await settle()
  expect(useWorkspaceStore.getState().tabs).toEqual([HOME_TAB])
  expect(location()).toBe('/dashboard')
})
