// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import RefundDetailDialog from './RefundDetailDialog'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'

const fixture = vi.hoisted(() => ({ detail: vi.fn(), execute: vi.fn(), confirm: null as null | (() => void) }))
vi.mock('@/api/refund', async original => ({ ...await original<typeof import('@/api/refund')>(), getRefundDetailApi: fixture.detail, executeRefundApi: fixture.execute }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/lib/confirm', () => ({ confirmAction: ({ onConfirm }: { onConfirm: () => void }) => { fixture.confirm = onConfirm } }))
const refund = (id: number) => ({ id, refundNo: `RF-${id}`, saleOrderNo: 'SL-1', customerName: '验收客户', amount: 1, status: 2, statusName: '已确认', refundDate: '2026-10-08' })
const button = (text: string) => [...document.querySelectorAll('button')].find(button => button.textContent === text)
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.detail.mockReset(); fixture.execute.mockReset(); fixture.confirm = null })

async function page(run: (cache: QueryClient, render: (id: number, open?: boolean, active?: boolean) => Promise<void>) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  async function render(id: number, open = true, active = true) {
    await act(async () => root.render(<QueryClientProvider client={cache}><SectionVisibilityContext.Provider value={active}><RefundDetailDialog open={open} id={id} onClose={() => {}} /></SectionVisibilityContext.Provider></QueryClientProvider>)); await flush()
  }
  try { await run(cache, render) }
  finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}

test('详情首次失败能重试恢复，失败时无资金写动作', async () => {
  fixture.detail.mockRejectedValue(new Error('详情失败夹具'))
  await page(async (_, render) => {
    await render(7)
    expect(document.body.textContent).toContain('详情失败夹具')
    expect(button('执行退款')).toBeUndefined()
    expect(button('取消退款单')).toBeUndefined()
    expect(button('重试')).toBeTruthy()
    fixture.detail.mockResolvedValue(refund(7))
    await act(async () => button('重试')!.click()); await flush()
    expect(document.body.textContent).toContain('RF-7')
    expect(button('执行退款')).toBeTruthy()
  })
})

test.each(['error', 'fetching', 'switched', 'switched-back', 'recovered', 'hidden', 'section-hidden'])('已打开确认在 %s 后不能按旧详情执行退款', async scenario => {
  fixture.detail.mockImplementation(async (id: number) => refund(id))
  await page(async (cache, render) => {
    await render(7)
    await act(async () => button('执行退款')!.click())
    expect(fixture.confirm).toBeTruthy()
    if (scenario === 'hidden') await render(7, false)
    else if (scenario === 'section-hidden') await render(7, true, false)
    else if (scenario.startsWith('switched')) {
      await render(8)
      if (scenario === 'switched-back') await render(7)
    }
    else {
      fixture.detail.mockImplementation(() => scenario === 'fetching' ? new Promise(() => {}) : Promise.reject(new Error('刷新失败夹具')))
      await act(async () => { void cache.refetchQueries({ queryKey: ['refund-orders', 7] }) }); await flush()
      expect(button('执行退款')).toBeUndefined()
      if (scenario === 'recovered') {
        fixture.detail.mockResolvedValue(refund(7))
        await act(async () => { await cache.refetchQueries({ queryKey: ['refund-orders', 7] }) }); await flush()
        expect(button('执行退款')).toBeTruthy()
      }
    }
    await act(async () => fixture.confirm?.()); await flush()
    expect(fixture.execute).not.toHaveBeenCalled()
  })
})
