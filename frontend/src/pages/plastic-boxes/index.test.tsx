// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PlasticBoxesPage from './index'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
import type { PlasticBox } from '@/hooks/usePlasticBoxes'
import type { FinderResult } from '@/types/finder'
vi.mock('@/api/inventory', () => ({ getPlasticBoxSourcesApi: vi.fn().mockResolvedValue({ sources: [] }), repackPlasticBoxApi: vi.fn() }))
const mocks = vi.hoisted(() => ({ failed: false, retry: vi.fn() }))
vi.mock('@/hooks/usePlasticBoxes', async (original) => ({ ...await original<typeof import('@/hooks/usePlasticBoxes')>(), usePlasticBoxMovements: () => ({ data: mocks.failed ? undefined : [], isLoading: false, isError: mocks.failed, error: mocks.failed ? new Error('模拟流水断网') : null, refetch: mocks.retry }) }))
vi.mock('@/components/finder', () => ({ ProductFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (p: FinderResult) => void }) => open ? <button onClick={() => onConfirm({ id: 7, name: '选中商品', code: 'P7' })}>确认商品</button> : null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: ({ value, onChange }: { value: number | null; onChange: (id: number, name: string) => void }) => <button onClick={() => onChange(3, '选中仓库')}>{value ? '选中仓库' : '选择仓库'}</button> }))
vi.mock('@/components/shared/BaseCrudPage', () => ({ default: (p: { onOpen?: () => void; renderForm: () => ReactNode; canSubmit?: () => boolean; renderActions: (b: PlasticBox, h: object) => ReactNode }) => <><button onClick={() => p.onOpen?.()}>新建</button>{p.renderForm()}<button id="create" disabled={p.canSubmit ? !p.canSubmit() : false}>创建</button>{p.renderActions({ id: 1, barcode: 'B1', remainingQty: 0 } as PlasticBox, {})}</> }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mocks.failed = false; mocks.retry.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlasticBoxesPage /></QueryClientProvider>)) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function click(label: string) { const b = [...document.querySelectorAll('button')].find(b => b.textContent === label); expect(b,label).toBeTruthy(); await act(async () => b!.click()) }
test('新建必须选择商品和仓库，重新新建清空上次选择', async () => {
  await click('新建')
  expect(host.querySelector<HTMLButtonElement>('#create')!.disabled).toBe(true)
  await click('点击选择商品…'); await click('确认商品'); await click('选择仓库')
  expect(host.querySelector<HTMLButtonElement>('#create')!.disabled).toBe(false)
  await click('新建')
  expect(host.textContent).not.toContain('选中商品'); expect(host.textContent).not.toContain('选中仓库')
  expect(host.querySelector<HTMLButtonElement>('#create')!.disabled).toBe(true)
})
test('流水请求失败显示错误与重试，不显示暂无流水', async () => {
  mocks.failed = true; await click('详情')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('塑料盒流水加载失败')
  expect(dialog.textContent).not.toContain('暂无流水')
  await click('重试'); expect(mocks.retry).toHaveBeenCalledOnce()
})

test('刷新后的页面详情外保留原盒与原数量恢复入口，不自动重发', async () => {
  await act(async () => root.unmount())
  act(() => useAuthStore.getState().login('test', null, { id: 91001 } as User))
  localStorage.setItem('flowcube_pc_repack_v1:91001', JSON.stringify({ version: 1, records: [{
    accountId: 91001, boxId: 4, action: 'plastic_box.repack.4', requestKey: 'pc-original',
    createdAt: '2026-10-01T00:00:00.000Z', endpoint: new URL('/api', window.location.origin).href,
    body: { perBoxQty: 20, boxCount: 2 },
  }] }))
  root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PlasticBoxesPage /></QueryClientProvider>))
  expect(host.textContent).toContain('盒 #4')
  expect(host.textContent).toContain('每箱 20 × 2 箱')
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '查询上次结果')).toBe(true)
  localStorage.removeItem('flowcube_pc_repack_v1:91001')
  act(() => useAuthStore.getState().logout())
})
