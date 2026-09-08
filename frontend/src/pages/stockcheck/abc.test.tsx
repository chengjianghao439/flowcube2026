// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AbcClassPage from './abc'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rules: vi.fn(), save: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: mocks.guard }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/exportDownload', () => ({ downloadExport: vi.fn() }))
vi.mock('@/components/shared/DataTable', () => ({ default: () => <div /> }))
vi.mock('@/api/stockcheck', () => ({ getCycleRulesApi: mocks.rules, getAbcListApi: async () => [], getCoverageApi: async () => [], saveCycleRulesApi: mocks.save, recomputeAbcApi: async () => ({}) }))

let host: HTMLDivElement
let root: Root
let qc: QueryClient
const rule = { abcClass: 'A', intervalDays: 10, batchLimit: 50, enabled: true, isOverride: false }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.save.mockReset(); mocks.save.mockResolvedValue({}); mocks.guard.mockClear(); mocks.rules.mockResolvedValue({ rules: [{ ...rule }] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { root.render(<QueryClientProvider client={qc}><AbcClassPage /></QueryClientProvider>) })
  await click('分批盘点规则')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove() })
async function click(text: string) { await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click() }) }
function input() { return [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(e => !e.closest('[hidden]'))! }
function edit(value = '17') { act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value); input().dispatchEvent(new Event('input', { bubbles: true })) }) }
test('规则有未保存变更时切到其他页签仍保留关闭保护', async () => {
  edit(); await click('按期盘点率')
  expect(mocks.guard.mock.lastCall?.[1]).toBe(true)
  await click('分批盘点规则'); expect(input().value).toBe('17')
})
test('规则后台数据刷新不得覆盖尚未保存的编辑', async () => {
  edit()
  await act(async () => { qc.setQueryData(['cycle-rules', 0], { rules: [{ ...rule, intervalDays: 30 }] }); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(input().value).toBe('17'); expect(mocks.guard.mock.lastCall?.[1]).toBe(true)
})

test('保存期间继续编辑，成功回执不能清掉后续草稿或关闭保护', async () => {
  let finish!: (result: object) => void
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  edit(); await click('保存规则'); edit('23')
  mocks.rules.mockResolvedValue({ rules: [{ ...rule, intervalDays: 17 }] })
  await act(async () => { finish({}); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(input().value).toBe('23'); expect(mocks.guard.mock.lastCall?.[1]).toBe(true)
})
test('成功保存原草稿后清除关闭保护', async () => {
  mocks.rules.mockResolvedValue({ rules: [{ ...rule, intervalDays: 17 }] })
  edit(); await click('保存规则')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(input().value).toBe('17'); expect(mocks.guard.mock.lastCall?.[1]).toBe(false)
})
