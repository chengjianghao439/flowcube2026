// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RefundDetailDialog from './RefundDetailDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = vi.hoisted(() => ({
  statusCalls: [] as Array<{ key: string; action: string }>,
  execCalls: [] as Array<{ id: number; requestKey: string }>,
  receiptStatus: 'success' as 'pending' | 'success' | 'failed' | 'not_found',
  failWith: null as unknown,
  toasts: [] as string[],
}))

vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/shared/StatusBadge', () => ({ SoftStatusLabel: ({ label }: { label: string }) => <span>{label}</span> }))
vi.mock('@/components/shared/payments/BackfillRequestDialog', () => ({ BackfillRequestDialog: () => null }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: (m: string) => fixture.toasts.push(m), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/confirm', () => ({ confirmAction: ({ onConfirm }: { onConfirm?: () => void }) => onConfirm?.() }))
vi.mock('@/api/refund', () => ({
  getRefundListApi: async () => ({ list: [] }),
  getRefundDetailApi: async (id: number) => ({
    id, refundNo: `RF-${id}`, saleOrderNo: 'SL-1', customerName: '验收客户',
    amount: 1, status: 2, statusName: '已确认', refundDate: '2026-09-29',
  }),
  createRefundApi: async () => ({}), submitRefundApi: async () => ({}),
  cancelRefundApi: async () => ({}),
  executeRefundApi: async (id: number, requestKey: string) => {
    fixture.execCalls.push({ id, requestKey })
    if (fixture.failWith) throw fixture.failWith
    return { id }
  },
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: async (key: string, action: string) => {
    fixture.statusCalls.push({ key, action })
    return { status: fixture.receiptStatus, data: null, message: '' }
  },
}))

const hosts: HTMLDivElement[] = []
const roots: Array<ReturnType<typeof createRoot>> = []
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
let closeCount = 0

async function renderInto(root: ReturnType<typeof createRoot>, id: number) {
  await act(async () => root.render(
    <QueryClientProvider client={qc}>
      <RefundDetailDialog open onClose={() => { closeCount++ }} id={id} />
    </QueryClientProvider>,
  ))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function mount(id: number) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host); roots.push(root)
  await renderInto(root, id)
  return { host, root, rerender: (n: number) => renderInto(root, n) }
}

// Radix Dialog 渲染在 Portal（body）里，查询要用 document 而不是渲染容器
const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))!

afterEach(() => {
  // Radix Portal 会往 body 追加节点；失败时也要卸载，避免污染下一例
  roots.splice(0).forEach(r => { try { r.unmount() } catch { /* 已卸载 */ } })
  hosts.splice(0).forEach(h => h.remove())
  qc.clear()
  fixture.statusCalls.length = 0; fixture.execCalls.length = 0; fixture.toasts.length = 0
  fixture.receiptStatus = 'success'; fixture.failWith = null; closeCount = 0
})

it('★ 退款「查询上次结果」要按本次退款单 ID 定位；切到另一张后查询上一张成功不得关掉当前详情', async () => {
  // 前端在详情里**已知 refund.id**，查询若仍传 base action，服务端前缀解析在同键多条时不唯一
  // ⇒ 返回 not_found（两笔其实都已成功）；同键只有一条时又把**上一张**的回执当成「本次成功」并关窗。
  const { root, rerender } = await mount(7)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button('执行退款').click())
  expect(document.body.textContent).toContain('没有收到')
  expect(fixture.execCalls).toHaveLength(1)

  await rerender(8)                                  // 切到另一张（未提交）
  const before = closeCount
  await act(async () => button('查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  // 查询必须带本次单 ID（否则同键多条查不到）
  expect(fixture.statusCalls.at(-1)!.action).toBe('refund.execute.7')
  // 当前看的是 8：不得关详情
  expect(closeCount).toBe(before)
  expect(document.body.textContent).toContain('RF-8')
  // 成功提示必须点出被确认的是哪一张（原 A = 7），否则在 8 的界面上只报「已成功」会被误读
  expect(fixture.toasts.some(t => t.includes('RF-7'))).toBe(true)
  await act(async () => root.unmount())
})

it('★ 同键先 A 后 B 都未确认，再查最后一张 B：action/label/toast 必须定位 B，且 B 正常收尾', async () => {
  const { root, rerender } = await mount(7)
  fixture.failWith = Object.assign(new Error('Network Error'), { code: 'NETWORK_ERROR' })
  await act(async () => button('执行退款').click())
  expect(fixture.execCalls).toHaveLength(1)

  await rerender(8)                                  // 未确认期间切到 B 并提交（同键，不换键）
  await act(async () => button('执行退款').click())
  expect(fixture.execCalls).toHaveLength(2)
  expect(fixture.execCalls[1].requestKey).toBe(fixture.execCalls[0].requestKey)

  await act(async () => button('查询上次结果').click())
  await act(async () => { await Promise.resolve() })

  // 最后一次提交是 B(8)：查询按 8 定位，提示点名 B，且当前就是 B ⇒ 正常关详情
  expect(fixture.statusCalls.at(-1)!.action).toBe('refund.execute.8')
  expect(fixture.toasts.some(t => t.includes('RF-8'))).toBe(true)
  expect(closeCount).toBe(1)
  await act(async () => root.unmount())
})
