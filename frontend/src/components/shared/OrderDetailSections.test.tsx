// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
test('收货有容器和打印，无装箱环节，切换单据重置页签', () => {
  act(() => root.render(<OrderDetailSections type="inbound" id={1}>单据一</OrderDetailSections>))
  expect(tab('条码打印')).toBeTruthy()
  expect(tab('装箱进度')).toBeUndefined()
  act(() => tab('操作记录')!.click())
  act(() => root.render(<OrderDetailSections type="inbound" id={2}>单据二</OrderDetailSections>))
  expect(tab('订单信息')!.getAttribute('aria-selected')).toBe('true')
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
