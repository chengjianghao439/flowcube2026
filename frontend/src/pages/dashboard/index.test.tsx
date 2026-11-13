// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DashboardLayout } from '@/types/dashboard'
import { PERMISSIONS } from '@/lib/permission-codes'
import { BoardSalesActions } from '@/components/dashboard/widgets/OperationalWidgets'
import DashboardPage from './index'

const state = vi.hoisted(() => ({ saved: { widgets: [] } as DashboardLayout, save: vi.fn(), permissions: null as Set<string> | null }))
vi.mock('@/hooks/useDashboard', () => ({
  useDashboardLayout: () => ({ data: state.saved, isLoading: false }),
  useSaveDashboardLayout: () => ({ mutateAsync: state.save, isPending: false }),
  useLowStock: () => ({ data: [] }),
  useDashboardSummary: () => ({ data: { pendingPurchaseOrders: 3 }, isLoading: false }),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (permission: string) => state.permissions === null || state.permissions.has(permission) }) }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: () => {} }))
vi.mock('@/components/dashboard/registry', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/dashboard/registry')>()
  return { ...original, WIDGET_MAP: Object.fromEntries(Object.entries(original.WIDGET_MAP).map(([id, def]) => [id, { ...def, Component: () => <span>{def.title}</span> }])) }
})

let host: HTMLDivElement, root: Root
const ids = () => [...host.querySelectorAll('[data-widget-id]')].map(el => el.getAttribute('data-widget-id'))
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent?.trim() === text)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.save.mockReset().mockImplementation(async (layout: DashboardLayout) => { state.saved = structuredClone(layout); return state.saved })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); state.permissions = null })

test('采购权限能查看待处理采购，销售卡片仅对有销售查看权限的岗位显示', async () => {
  state.saved = { widgets: ['kpi-pending-sale', 'kpi-pending-purchase'].map(id => ({ id, visible: true, w: 1 })) }
  state.permissions = new Set([PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.PURCHASE_ORDER_VIEW])
  const draw = () => act(async () => root.render(<MemoryRouter><DashboardPage /></MemoryRouter>))
  await draw()
  expect(ids()).toEqual(['kpi-pending-purchase'])
  state.permissions.add(PERMISSIONS.SALE_ORDER_VIEW)
  await draw()
  expect(ids()).toEqual(['kpi-pending-sale', 'kpi-pending-purchase'])
})

test('仅可查看采购的账号打开业务待办即可看到采购内容', async () => {
  state.permissions = new Set([PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.PURCHASE_ORDER_VIEW])
  await act(async () => root.render(<MemoryRouter><BoardSalesActions /></MemoryRouter>))
  expect(host.textContent).toContain('待处理采购')
  expect(host.textContent).not.toContain('销售查看权限')
  expect(host.textContent).not.toContain('状态总览')
})

test('保存的跨分区顺序及指标/业务卡交错顺序在展示页原样生效', async () => {
  const order = ['system-version', 'board-workbench', 'kpi-pending-sale', 'fun-year', 'chart-sale-trend']
  state.saved = { widgets: order.map(id => ({ id, visible: true, w: id === 'system-version' ? 4 : 2 })) }
  await act(async () => root.render(<MemoryRouter initialEntries={['/dashboard']}><DashboardPage /></MemoryRouter>))
  expect(ids()).toEqual(order)
  expect(host.querySelector('[data-widget-id="system-version"]')?.className).toContain('lg:col-span-4')
})

test('系统版本从末尾拖到开头，保存及重新挂载后均保持第一张', async () => {
  state.saved = { widgets: ['kpi-pending-sale', 'board-workbench', 'system-version'].map(id => ({ id, visible: true, w: 2 })) }
  await act(async () => root.render(<MemoryRouter initialEntries={['/dashboard']}><DashboardPage /></MemoryRouter>))
  await click('编辑仪表盘')
  act(() => host.querySelector('[data-widget-id="system-version"]')!.dispatchEvent(new Event('dragstart', { bubbles: true })))
  act(() => host.querySelector('[data-widget-id="kpi-pending-sale"]')!.dispatchEvent(new Event('dragenter', { bubbles: true })))
  act(() => host.querySelector('[data-widget-id="system-version"]')!.dispatchEvent(new Event('dragend', { bubbles: true })))
  expect(ids()[0]).toBe('system-version')
  await click('保存')
  expect(state.save).toHaveBeenCalledTimes(1)
  expect(state.saved.widgets[0].id).toBe('system-version')
  expect(ids()[0]).toBe('system-version')
  await act(async () => root.render(<MemoryRouter initialEntries={['/dashboard']}><DashboardPage key="reopened" /></MemoryRouter>))
  expect(ids()[0]).toBe('system-version')
})

test('用户空布局保持空；主动载入推荐只是预览，原保存才写', async () => {
  state.saved = { widgets: [] }
  await act(async () => root.render(<MemoryRouter><DashboardPage /></MemoryRouter>))
  expect(ids()).toEqual([]); expect(state.save).not.toHaveBeenCalled()
  await click('编辑仪表盘'); await click('载入推荐')
  expect(ids()[0]).toBe('board-workbench'); expect(state.save).not.toHaveBeenCalled()
  await click('保存'); expect(state.save).toHaveBeenCalledOnce()
})
test('预览全部卡片明确标出布局预览，取消恢复原布局', async () => {
  state.saved = { widgets: [{ id: 'system-version', visible: true, w: 2 }] }
  state.permissions = new Set([PERMISSIONS.DASHBOARD_VIEW])
  await act(async () => root.render(<MemoryRouter><DashboardPage /></MemoryRouter>))
  expect(ids()).toEqual(['system-version'])
  await click('预览全部卡片')
  expect(host.textContent).toContain('布局预览')
  expect(host.textContent).toContain('保存后应用，取消返回原布局')
  expect(ids()).not.toContain('kpi-pending-sale')
  await click('取消')
  expect(ids()).toEqual(['system-version'])
  expect(state.save).not.toHaveBeenCalled()
})
