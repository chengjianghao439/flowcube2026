// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import CarriersPage from './index'
import type { Carrier } from '@/types/carriers'
const api = vi.hoisted(() => ({ createCarrierApi: vi.fn().mockResolvedValue({ id: 7 }), updateCarrierApi: vi.fn(), getCarriersApi: vi.fn(), deleteCarrierApi: vi.fn() }))
vi.mock('@/api/carriers', () => api)
vi.mock('@/components/shared/BaseCrudPage', () => ({ default: (props: { onOpen: (row: Carrier | null) => void; renderForm: (row: Carrier | null) => React.ReactNode; submitForm: (row: Carrier | null) => Promise<unknown> }) => <div><button onClick={() => props.onOpen(null)}>新建</button>{props.renderForm(null)}<button onClick={() => void props.submitForm(null)}>提交</button></div> }))
vi.mock('@/components/ui/select', () => ({ Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => <div><select aria-label="选择平台" value={value} onChange={e => onValueChange(e.target.value)}><option value="">未设置</option><option value="sf">顺丰</option></select>{children}</div>, SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectValue: () => null, SelectContent: () => null, SelectItem: () => null }))
test('未启用自动下单也能选择并保存平台，绑定页无需重新指定', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const client = new QueryClient()
  try {
    await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><CarriersPage /></QueryClientProvider></MemoryRouter>))
    expect(host.textContent).toContain('快递公司 / 对接平台')
    const platform = [...host.querySelectorAll('select')].find(s => s.parentElement?.parentElement?.textContent?.includes('快递公司 / 对接平台'))!
    await act(async () => { platform.value = 'sf'; platform.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '提交')!.click())
    expect(api.createCarrierApi).toHaveBeenCalledWith(expect.objectContaining({ platformCode: 'sf', waybillEnabled: false }), expect.anything())
  } finally { await act(async () => root.unmount()); host.remove(); client.clear() }
})
