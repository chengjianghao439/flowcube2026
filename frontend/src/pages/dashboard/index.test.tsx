// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DashboardLayout } from '@/types/dashboard'
import DashboardPage from './index'

const state = vi.hoisted(() => ({ saved: { widgets: [] } as DashboardLayout, save: vi.fn() }))
vi.mock('@/hooks/useDashboard', () => ({
  useDashboardLayout: () => ({ data: state.saved, isLoading: false }),
  useSaveDashboardLayout: () => ({ mutateAsync: state.save, isPending: false }),
  useLowStock: () => ({ data: [] }),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
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
afterEach(() => { act(() => root.unmount()); host.remove() })

test('保存的跨分区顺序及指标/业务卡交错顺序在展示页原样生效', async () => {
  const order = ['system-version', 'board-workbench', 'kpi-pending-sale', 'fun-year', 'chart-sale-trend']
  state.saved = { widgets: order.map(id => ({ id, visible: true, w: id === 'system-version' ? 4 : 2 })) }
  await act(async () => root.render(<DashboardPage />))
  expect(ids()).toEqual(order)
  expect(host.querySelector('[data-widget-id="system-version"]')?.className).toContain('lg:col-span-4')
})

test('系统版本从末尾拖到开头，保存及重新挂载后均保持第一张', async () => {
  state.saved = { widgets: ['kpi-pending-sale', 'board-workbench', 'system-version'].map(id => ({ id, visible: true, w: 2 })) }
  await act(async () => root.render(<DashboardPage />))
  await click('编辑仪表盘')
  act(() => host.querySelector('[data-widget-id="system-version"]')!.dispatchEvent(new Event('dragstart', { bubbles: true })))
  act(() => host.querySelector('[data-widget-id="kpi-pending-sale"]')!.dispatchEvent(new Event('dragenter', { bubbles: true })))
  act(() => host.querySelector('[data-widget-id="system-version"]')!.dispatchEvent(new Event('dragend', { bubbles: true })))
  expect(ids()[0]).toBe('system-version')
  await click('保存')
  expect(state.save).toHaveBeenCalledTimes(1)
  expect(state.saved.widgets[0].id).toBe('system-version')
  expect(ids()[0]).toBe('system-version')
  await act(async () => root.render(<DashboardPage key="reopened" />))
  expect(ids()[0]).toBe('system-version')
})
