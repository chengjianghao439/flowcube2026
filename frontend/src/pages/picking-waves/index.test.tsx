// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PickingWavesPage from './index'
import { getWavesApi, getWaveByIdApi } from '@/api/picking-waves'
import type { WaveQueryValues } from './WaveQueryDialog'

vi.mock('@/api/picking-waves', async (original) => ({ ...await original<typeof import('@/api/picking-waves')>(), getWavesApi: vi.fn(), getWaveByIdApi: vi.fn() }))
vi.mock('@/components/shared/DataTable', () => ({ default: ({ data }: { data: { waveNo: string }[] }) => <div>{data.map(r => r.waveNo).join(',')}</div> }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('./WaveQueryDialog', () => ({ default: ({ open, initial, onApply }: { open: boolean; initial: WaveQueryValues; onApply: (v: WaveQueryValues) => void }) => open ? <div><output>{JSON.stringify(initial)}</output><button onClick={() => onApply({ keyword: 'PW-QA', status: '2', warehouseId: 7, startDate: '2026-09-01', endDate: '2026-09-02' })}>应用测试条件</button></div> : null }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, qc: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(getWavesApi).mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 20, total: 0 } })
})
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); host.remove() })
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }
async function render(path = '/') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}><PickingWavesPage /></QueryClientProvider></MemoryRouter>)); await settle() }
async function click(label: string) { const button = [...document.querySelectorAll('button')].find(b => b.textContent === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); await settle() }

test('仓库与创建日期完整提交查询，重开保留条件，清空移除全部条件', async () => {
  await render(); await click('查询')
  expect(host.querySelector('output')!.textContent).toContain('"startDate":""')
  await click('应用测试条件')
  expect(getWavesApi).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'PW-QA', status: '2', warehouseId: 7, startDate: '2026-09-01', endDate: '2026-09-02' }))
  await click('查询'); expect(host.querySelector('output')!.textContent).toContain('"warehouseId":7')
  await click('清空')
  expect(host.querySelector('output')!.textContent).toContain('"warehouseId":null')
  expect(host.querySelector('output')!.textContent).toContain('"endDate":""')
})
test('批次列表请求失败给出重试，不能伪装成零条；重试后恢复', async () => {
  vi.mocked(getWavesApi).mockRejectedValue(new Error('模拟断网'))
  await render()
  expect(host.textContent).toContain('批次列表加载失败')
  expect(host.textContent).not.toContain('共 0')
  vi.mocked(getWavesApi).mockResolvedValue({ list: [{ waveNo: 'PW-恢复' }], pagination: { total: 1 } } as never)
  await click('重试'); expect(host.textContent).toContain('PW-恢复')
})
test('批次详情失败时显示可重试错误，不呈现待选择批次或执行动作', async () => {
  vi.mocked(getWaveByIdApi).mockRejectedValue(new Error('详情不可用'))
  await render('/?waveId=7')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('批次详情加载失败')
  expect(dialog.textContent).not.toContain('待选择批次')
  expect(dialog.textContent).not.toContain('开始拣货')
  vi.mocked(getWaveByIdApi).mockResolvedValue({ id: 7, waveNo: 'PW-详情恢复', status: 4, items: [] } as never)
  await click('重试'); expect(document.querySelector('[role="dialog"]')!.textContent).toContain('PW-详情恢复')
})
