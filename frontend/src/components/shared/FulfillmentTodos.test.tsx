// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { FulfillmentTodos } from './FulfillmentTodos'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
const state = vi.hoisted(() => ({ userId: 7, requests: vi.fn() }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (s: {user:{id:number}}) => unknown) => select({ user: { id: state.userId } }) }))
vi.mock('@/api/fulfillment', () => ({ getFulfillmentIssues: (...args: unknown[]) => { state.requests(...args); return Promise.resolve({ list: [{ id: 1, document_type: 'sale', document_id: 123, documentNo: 'XS-20260912-001', partyName: '示例客户', warehouseName: '北京主仓', title: '缺货', reason: '待到货', status: 'open', ownerName: null }], summary: { mine: 1, unassigned: 0, overdue: 0 }, pagination: { total: 1 } }) } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div')
let root: ReturnType<typeof createRoot>, qc: QueryClient
async function render(active = true) { await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter><SectionVisibilityContext.Provider value={active}><FulfillmentTodos /></SectionVisibilityContext.Provider></MemoryRouter></QueryClientProvider>) }); await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
function setup() { root = createRoot(host); qc = new QueryClient({defaultOptions:{queries:{retry:false}}}); state.requests.mockClear(); state.userId = 7 }
afterEach(() => { act(() => root.unmount()); qc.clear(); localStorage.clear() })
test('待办显示业务单号、往来方、仓库，跟进仍指向原单履约区域', async () => {
  setup(); await render(); expect(host.textContent).toContain('XS-20260912-001'); expect(host.textContent).toContain('示例客户'); expect(host.textContent).toContain('北京主仓')
  expect(host.querySelector('a[href="#/sale/123?focus=fulfillment"]')).not.toBeNull()
})
test('类型和状态按用户记住，关键词提交查询，切换用户不沿用他人的筛选', async () => {
  setup(); await render()
  const type = host.querySelector('select[aria-label="单据类型"]') as HTMLSelectElement
  expect(type).not.toBeNull()
  await act(async () => { type.value = 'purchase'; type.dispatchEvent(new Event('change', {bubbles:true})) })
  const keyword = host.querySelector('input[aria-label="搜索履约事项"]') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(keyword,'XS-2026'); keyword.dispatchEvent(new Event('input',{bubbles:true})) })
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(state.requests.mock.calls.at(-1)?.[3]).toEqual({documentType:'purchase',keyword:'XS-2026'})
  state.userId=8; await render(); expect((host.querySelector('select') as HTMLSelectElement).value).toBe('')
  state.userId=7; await render(); expect((host.querySelector('select') as HTMLSelectElement).value).toBe('purchase')
  expect((host.querySelector('input[aria-label="搜索履约事项"]') as HTMLInputElement).value).toBe('')
})
test('隐藏工作台后，失效通知不触发后台列表读取', async () => {
  setup(); await render(); await render(false); state.requests.mockClear()
  await act(async () => qc.invalidateQueries({ queryKey: ['fulfillment-issues'] })); expect(state.requests).not.toHaveBeenCalled()
})
