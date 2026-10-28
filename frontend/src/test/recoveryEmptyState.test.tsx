// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import RepeatSaleRecoveryPage from '@/pages/sale/RepeatSaleRecoveryPage'
import DisposalRecoveryPage from '@/pages/disposal/DisposalRecoveryPage'
import RefundRecoveryPage from '@/pages/supplier-refunds/RefundRecoveryPage'
import { useAuthStore } from '@/store/authStore'
import client, { setApiClientBaseURL } from '@/api/client'
import { REPEAT_CREATE_STORAGE } from '@/hooks/useRepeatSaleCreate'
import { DISPOSAL_EXECUTION_STORAGE } from '@/lib/disposalRecovery'
import { HANDLING_STORAGE } from '@/lib/disposalHandlingRecovery'
import { REFUND_STORAGE } from '@/lib/supplierRefundRecovery'

const originalAdapter = client.defaults.adapter
let host: HTMLDivElement, root: Root, cache: QueryClient
const network = vi.fn(async () => { throw Error('恢复空态禁止网络和业务写入') })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); network.mockClear()
  setApiClientBaseURL('/synthetic-empty')
  useAuthStore.getState().login('fixture', null, { id: 9, roleId: 2, permissions: [] } as never)
  client.defaults.adapter = network
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove()
  client.defaults.adapter = originalAdapter; localStorage.clear(); sessionStorage.clear()
  expect(network).not.toHaveBeenCalled()
})
async function render(Page: typeof RepeatSaleRecoveryPage) {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={cache}><Page /></QueryClientProvider></MemoryRouter>))
}
for (const [label, Page] of [['开单', RepeatSaleRecoveryPage], ['报废', DisposalRecoveryPage], ['退款', RefundRecoveryPage]] as const) {
  test(`${label}恢复空态说明只针对当前账号和服务器，不自动核对或重发`, async () => {
    await render(Page)
    const empty = host.querySelector('.fc-empty-state')
    expect(empty?.textContent).toContain('当前账号')
    expect(empty?.textContent).toContain('服务器')
    expect(empty?.textContent).toContain('没有待核对')
    expect(host.querySelector('input')).toBeNull()
  })
}
for (const [label, Page, key, storage] of [
  ['开单', RepeatSaleRecoveryPage, REPEAT_CREATE_STORAGE, 'session'],
  ['报废', DisposalRecoveryPage, DISPOSAL_EXECUTION_STORAGE, 'local'],
  ['退款', RefundRecoveryPage, REFUND_STORAGE, 'local'],
] as const) {
  test(`${label}记录读取失败保留错误与原存储，不冒充成功空态`, async () => {
    const store = storage === 'session' ? sessionStorage : localStorage
    store.setItem(key, '{invalid')
    await render(Page)
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    // 报废处理意图为另一个独立恢复分区，不用于证明报废执行记录为空。
    expect(host.querySelector('[role="alert"]')?.parentElement?.textContent).not.toContain('当前账号和服务器没有待核对报废请求')
    expect(store.getItem(key)).toBe('{invalid')
  })
}
test('处理意图记录失败仍单独保留错误，不把未知意图显示为空', async () => {
  localStorage.setItem(HANDLING_STORAGE, '{invalid')
  await render(DisposalRecoveryPage)
  const section = [...host.querySelectorAll('section')].find(node => node.querySelector('h2')?.textContent === '处理意图与关联结果')!
  expect(section.querySelector('[role="alert"]')).not.toBeNull()
  expect(section.querySelector('.fc-empty-state')).toBeNull()
  expect(localStorage.getItem(HANDLING_STORAGE)).toBe('{invalid')
})
