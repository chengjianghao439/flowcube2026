// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { OrderDetailSections } from './OrderDetailSections'
vi.mock('./DocumentActivityPanel', () => ({ DocumentActivityPanel: ({ view, id }: { view: string; id: number }) => <div>记录 {id} {view}</div> }))
let host: HTMLDivElement
let root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState({}, '', '/') })
function tab(name: string) { return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(el => el.textContent === name) }
test('默认订单信息，切换进度保留未保存内容，操作记录单独展示', () => {
  act(() => root.render(<OrderDetailSections type="purchase" id={12}><input defaultValue="草稿" /></OrderDetailSections>))
  host.querySelector('input')!.value = '未保存的内容'
  expect(tab('收货进度')).toBeTruthy()
  act(() => tab('收货进度')!.click())
  expect(host.textContent).toContain('记录 12 progress')
  act(() => tab('订单信息')!.click())
  expect(host.querySelector('input')!.value).toBe('未保存的内容')
  act(() => tab('操作记录')!.click())
  expect(host.textContent).toContain('记录 12 log')
})
test('收货保留库存条码但不展示打印记录，无装箱环节，切换单据重置页签', () => {
  act(() => root.render(<OrderDetailSections type="inbound" id={1}>单据一</OrderDetailSections>))
  // 2026-09-14 用户决定：收货订单只显示任务进度，不展示打印记录（补打只在打印记录页）
  expect(tab('库存条码')).toBeTruthy()
  expect(tab('条码打印')).toBeUndefined()
  expect(tab('装箱进度')).toBeUndefined()
  act(() => tab('操作记录')!.click())
  act(() => root.render(<OrderDetailSections type="inbound" id={2}>单据二</OrderDetailSections>))
  expect(tab('收货信息')!.getAttribute('aria-selected')).toBe('true')
})
test('待办链接唤回已打开的原单进度，其他单据不改变当前页签', () => {
  act(() => root.render(<OrderDetailSections type="purchase" id={12}><input defaultValue="草稿" /></OrderDetailSections>))
  const navigate = (id: number) => act(() => { window.history.replaceState({}, '', `/#/purchase/${id}?focus=fulfillment`); window.dispatchEvent(new HashChangeEvent('hashchange')) })
  navigate(13)
  expect(tab('订单信息')!.getAttribute('aria-selected')).toBe('true')
  navigate(12)
  expect(tab('收货进度')!.getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('input')!.value).toBe('草稿')
})

test('采购接收本标签路径并保留原输入，全局另单hash不改选择', () => {
  const render = (path: string) => act(() => root.render(<TabPathContext.Provider value={path}><OrderDetailSections type="purchase" id={12}><input defaultValue="草稿" /></OrderDetailSections></TabPathContext.Provider>))
  render('/purchase/12')
  host.querySelector('input')!.value = '等待供应商答复'
  act(() => { window.history.replaceState({}, '', '/#/purchase/12?focus=fulfillment'); window.dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(tab('订单信息')!.getAttribute('aria-selected')).toBe('true')
  render('/purchase/12?focus=fulfillment')
  expect(tab('收货进度')!.getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('input')!.value).toBe('等待供应商答复')
})
test('收货旧打印focus安全进入现有收货进度，避免选择不存在页签', () => {
  act(() => root.render(<TabPathContext.Provider value="/inbound-tasks/12?focus=print"><OrderDetailSections type="inbound" id={12}>本单</OrderDetailSections></TabPathContext.Provider>))
  expect(tab('收货进度')!.getAttribute('aria-selected')).toBe('true')
  expect(host.textContent).toContain('记录 12 progress')
})
