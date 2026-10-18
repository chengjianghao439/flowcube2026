// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import { ReceiptPanel, type ReceiptPanelHandle } from './ReceiptPanel'
import type { PaymentReceipt } from '@/api/payments'
import api from '@/api/client'
import { useAuthStore } from '@/store/authStore'

const reads = vi.hoisted(() => ({ receipts: vi.fn() }))
vi.mock('@/api/payments', async original => ({
  ...await original<typeof import('@/api/payments')>(), getReceiptsApi: reads.receipts,
}))
// 金额提交弹窗属于邻接领域；只观察本面板传入的原类型/目标/单据，不执行写入。
vi.mock('@/components/shared/payments/SettleReceiptDialog', () => ({
  SettleReceiptDialog: ({ open, onClose, type, target, receipt }: {
    open: boolean; onClose: () => void; type: number; target: string; receipt?: PaymentReceipt | null
  }) => open ? <div data-testid="settle-context">
    {`${type}:${target}:${receipt?.receiptNo ?? 'new'}`}
    <button onClick={onClose}>关闭核销夹具</button>
  </div> : null,
}))
vi.mock('@/components/shared/payments/ReceiptDetailDialog', () => ({ ReceiptDetailDialog: () => null }))

let host: HTMLDivElement, root: Root, cache: QueryClient
const adapter = api.defaults.adapter
const blockedTransport = vi.fn(async (config: InternalAxiosRequestConfig) => {
  throw new Error(`核销列表测试禁止网络：${config.url}`)
})
const variants = [
  { type: 1, target: 'record' }, { type: 2, target: 'record' },
  { type: 1, target: 'statement' }, { type: 2, target: 'statement' },
] as const
const receipt = {
  id: 7, receiptNo: 'RC-OLD-CACHE', type: 2, typeName: '收款单', partyName: '合成客户',
  amount: 100, settledAmount: 40, balance: 60, status: 2, statusName: '部分核销', paymentDate: '2026-10-15',
}
const success = (list: object[] = []) => ({ list, pagination: { total: list.length } })
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function click(text: string, scope: ParentNode = host) {
  const node = button(scope, text)
  expect(node, text).toBeTruthy()
  await act(async () => node!.click())
  await flush()
}
async function input(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function render(variant: typeof variants[number], hideToolbar = false) {
  const panel = createRef<ReceiptPanelHandle>()
  await act(async () => root.render(
    <QueryClientProvider client={cache}>
      <MemoryRouter><ReceiptPanel ref={panel} type={variant.type} target={variant.target} settlementTypes={variant.target === 'record' ? '1' : '2'} hideToolbar={hideToolbar} /></MemoryRouter>
    </QueryClientProvider>,
  ))
  await flush()
  return panel
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  reads.receipts.mockReset()
  blockedTransport.mockClear(); api.defaults.adapter = blockedTransport
  useAuthStore.setState({ user: { roleId: 1, permissions: [] } as never })
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  cache.clear(); host.remove(); api.defaults.adapter = adapter
  useAuthStore.setState({ user: null, token: null }); localStorage.clear()
  expect(blockedTransport).not.toHaveBeenCalled()
})

test.each(variants)('$type/$target 首读失败显示错误和重试，不能冒充成功空表', async variant => {
  reads.receipts.mockRejectedValue(new Error('合成核销读取失败'))
  await render(variant)
  expect(host.textContent).toContain('合成核销读取失败')
  expect(host.textContent).not.toContain('暂无数据')
  const applied = reads.receipts.mock.lastCall?.[0]
  reads.receipts.mockResolvedValue(success())
  await click('重试')
  expect(reads.receipts.mock.lastCall?.[0]).toEqual(applied)
  expect(host.textContent).not.toContain('合成核销读取失败')
  expect(host.textContent).toContain('暂无数据')
})

for (const failure of [
  { name: '403', error: { response: { status: 403, data: { message: '合成当前权限已失效' } } } },
  { name: '读取异常', error: new Error('合成刷新失败') },
]) test.each(variants)(`$type/$target 缓存后${failure.name}隐藏旧行和旧行操作，原条件重试恢复`, async variant => {
  reads.receipts.mockResolvedValue(success([{ ...receipt, type: variant.type }]))
  await render(variant)
  expect(host.textContent).toContain('RC-OLD-CACHE')
  expect(button(host, '继续核销')).toBeTruthy()
  const applied = reads.receipts.mock.lastCall?.[0]
  reads.receipts.mockRejectedValue(failure.error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['payment-receipts'] }) })
  await flush()
  expect(host.textContent).toContain(failure.name === '403' ? '合成当前权限已失效' : '合成刷新失败')
  expect(host.textContent).not.toContain('RC-OLD-CACHE')
  expect(host.textContent).not.toContain('暂无数据')
  expect(button(host, '继续核销')).toBeUndefined()
  reads.receipts.mockResolvedValue(success([{ ...receipt, receiptNo: 'RC-RETRY-NEW', type: variant.type }]))
  await click('重试')
  expect(reads.receipts.mock.lastCall?.[0]).toEqual(applied)
  expect(host.textContent).toContain('RC-RETRY-NEW')
  expect(host.textContent).not.toContain('RC-OLD-CACHE')
})

test('读取失败和重试保留已应用筛选与未应用查询草稿，父工具条登记及继续核销上下文不变', async () => {
  reads.receipts.mockResolvedValue(success([receipt]))
  const panel = await render(variants[3], true)
  await act(async () => panel.current!.openQuery()); await flush()
  let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await input(dialog.querySelector<HTMLInputElement>('[placeholder="输入收款单号"]')!, 'RC-APPLIED')
  await click('查询', dialog)
  expect(reads.receipts.mock.lastCall?.[0]).toMatchObject({ receiptNo: 'RC-APPLIED', type: '2' })
  await act(async () => panel.current!.openQuery()); await flush()
  dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const draft = dialog.querySelector<HTMLInputElement>('[placeholder="输入收款单号"]')!
  await input(draft, 'RC-UNAPPLIED')
  const applied = reads.receipts.mock.lastCall?.[0]
  reads.receipts.mockRejectedValue(new Error('合成查询在途失败'))
  await act(async () => { await cache.refetchQueries({ queryKey: ['payment-receipts'] }) }); await flush()
  expect(draft.value).toBe('RC-UNAPPLIED')
  expect(host.textContent).toContain('RC-APPLIED')
  expect(host.textContent).not.toContain('RC-OLD-CACHE')
  reads.receipts.mockResolvedValue(success([receipt]))
  await click('重试')
  expect(reads.receipts.mock.lastCall?.[0]).toEqual(applied)
  expect(draft.value).toBe('RC-UNAPPLIED')
  await click('取消', dialog)
  await act(async () => panel.current!.openRegister()); await flush()
  expect(host.querySelector('[data-testid="settle-context"]')?.textContent).toContain('2:statement:new')
  await click('关闭核销夹具')
  await click('继续核销')
  expect(host.querySelector('[data-testid="settle-context"]')?.textContent).toContain('2:statement:RC-OLD-CACHE')
})
