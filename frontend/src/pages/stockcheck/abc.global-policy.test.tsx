// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AbcClassPage from './abc'
const state = vi.hoisted(() => ({ allowed: false, save: vi.fn(), can: true }))
vi.mock('@/hooks/useGlobalPolicyWriteCapability', () => ({ useGlobalPolicyWriteCapability: () => ({ allowed: state.allowed, isAllowed: () => state.allowed, isError: false, refetch: vi.fn() }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => state.can }) }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/exportDownload', () => ({ downloadExport: vi.fn() }))
vi.mock('@/components/shared/DataTable', () => ({ default: () => null }))
vi.mock('@/api/stockcheck', () => ({ getCycleRulesApi: async () => ({ rules: [{ abcClass: 'A', intervalDays: 10, batchLimit: 50, enabled: true }] }), getAbcListApi: async () => [], getCoverageApi: async () => [], recomputeAbcApi: vi.fn(), saveCycleRulesApi: state.save }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, client: QueryClient
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><AbcClassPage /></QueryClientProvider>)); await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
async function click(text: string) { await act(async () => button(text)!.click()); await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
beforeEach(async () => { state.allowed = false; state.can = true; state.save.mockReset(); state.save.mockResolvedValue({}); host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); await render(); await click('分批盘点规则') })
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove() })
test('warehouse 0 is read-only without exact global capability even with original management permission', () => {
  expect(host.textContent).toContain('10')
  expect(button('编辑规则')).toBeUndefined()
  expect(host.querySelector('.desktop-page-description')?.textContent).toBe('全局默认只读；仅不限仓管理账号可修改。')
  expect(host.textContent?.match(/全局默认只读/g)).toHaveLength(1)
  expect(host.querySelector('table input')).toBeNull()
})
test('global capability plus original permission permits explicit edit/save and returns to read-only', async () => {
  state.allowed = true; await render(); await click('编辑规则')
  expect(host.querySelector('.desktop-page-description')?.textContent).toContain('编辑全局默认规则')
  await click('保存修改')
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 0 }), expect.anything())
  expect(host.querySelector('table input')).toBeNull()
})
test('revoking capability during edit prevents save and keeps controls read-only', async () => {
  state.allowed = true; await render(); await click('编辑规则')
  state.allowed = false; await render()
  expect(button('保存修改')).toBeUndefined(); expect(host.querySelector('table input')).toBeNull()
  expect(state.save).not.toHaveBeenCalled()
})
