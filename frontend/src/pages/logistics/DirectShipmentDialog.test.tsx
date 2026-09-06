// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DirectShipmentDialog } from './DirectShipmentDialog'
import type { LogisticsWaybill } from '@/types/logistics'
const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({}), success: vi.fn() }))
vi.mock('@/api/logistics', () => ({ updateWaybillShipmentApi: mocks.save }))
vi.mock('@/lib/toast', () => ({ toast: { success: mocks.success, error: vi.fn() } }))
test('件数只读且不录重量；保存只提交寄收件和产品，不能覆写打包事实', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const contact = { name: '测试', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路1号' }
  const waybill = { id: 7, platformCode: 'deppon', freightType: 1, shipment: { sender: contact, receiver: contact, productCode: 'DJBK', deliveryType: '3', cargoName: '配件', packages: [{ id: 1 }, { id: 2 }] } } as LogisticsWaybill
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><DirectShipmentDialog waybill={waybill} onClose={() => {}} onSaved={() => {}} /></QueryClientProvider>))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('本批 2 件')
    expect(dialog.textContent).toContain('重量由快递员称重确认')
    expect(Array.from(dialog.querySelectorAll('label')).some(n => /重量|件数/.test(n.textContent || ''))).toBe(false)
    const save = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === '保存并提交下单')!
    await act(async () => { save.click(); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(mocks.save).toHaveBeenCalledOnce()
    const sent = mocks.save.mock.calls[0][1]
    expect(sent.freightType).toBe(1)
    expect(sent.productCode).toBe('DJBK')
    expect(sent).not.toHaveProperty('weight')
    expect(sent).not.toHaveProperty('packages')
    expect(sent).not.toHaveProperty('packageCount')
  } finally { act(() => root.unmount()); client.clear(); host.remove() }
})
