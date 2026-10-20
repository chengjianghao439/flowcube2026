// @vitest-environment jsdom
// Real picking page, scanner, useOfflineScan and Axios error interceptor; transport is synthetic.
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient from '@/api/client'
import { AppToast } from '@/components/shared/AppToast'
import { useOfflineScan } from '@/hooks/useOfflineScan'
import Page from './task'

const api = vi.hoisted(() => ({ task: vi.fn(), suggestions: vi.fn(), container: vi.fn(), undo: undefined as ReturnType<typeof useOfflineScan>['logUndo'] | undefined }))
vi.mock('@/api/warehouse-tasks', () => ({ getTaskByIdApi: api.task, getPickSuggestionsApi: api.suggestions, readyToShipApi: vi.fn() }))
vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: api.container }))
vi.mock('@/hooks/useOfflineScan', async importOriginal => {
  const original = await importOriginal<typeof import('@/hooks/useOfflineScan')>()
  return { useOfflineScan: (...args: Parameters<typeof original.useOfflineScan>) => {
    const hook = original.useOfflineScan(...args)
    api.undo = hook.logUndo
    return hook
  } }
})
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: () => ({
  run: async (execute: (key: string) => Promise<unknown>) => ({ kind: 'success', data: await execute('stable-test-key') }),
  submitBlocked: false, phase: 'idle', pendingRecord: null, confirmPending: vi.fn(), clearPending: vi.fn(), clearError: vi.fn(),
}) }))

// Undo currently has no picking-page control. Invoke logUndo from the actual page hook via a test-only control.
function UndoTrigger() {
  return <button onClick={() => api.undo?.({ taskId: 42, itemId: 501, barcode: 'I000124', prevQty: 2, newQty: 1, productName: '合成商品' })}>测试撤销日志</button>
}
let host: HTMLDivElement, root: Root, cache: QueryClient
const originalAdapter = apiClient.defaults.adapter
let failureStatus = 400, failPick = false, releaseLog: (() => void) | undefined
const calls: InternalAxiosRequestConfig[] = []
const rejection = (config: InternalAxiosRequestConfig, status: number, message: string) => new AxiosError('synthetic API rejection', 'ERR_BAD_RESPONSE', config, undefined, {
  config, status, statusText: 'Rejected', headers: {}, data: { success: false, code: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message },
})
async function settle() {
  for (let n = 0; n < 3; n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}
async function gunScan(code: string) {
  await act(async () => { for (const key of [...code, 'Enter']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
  await settle()
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); calls.length = 0; failureStatus = 400; failPick = false; releaseLog = undefined
  api.task.mockResolvedValue({ id: 42, taskNo: 'WT-SYNTHETIC', status: 2, statusName: '待拣货', items: [{ id: 501, productId: 2782, requiredQty: 10, pickedQty: 0 }] })
  api.suggestions.mockResolvedValue({ items: [{ id: 501, productId: 2782, productName: '合成商品', productCode: 'SYNTHETIC', unit: '个', requiredQty: 10, pickedQty: 0, remaining: 10,
    suggestions: [{ containerId: 917, barcode: 'I000123', remainingQty: 3, locationCode: 'A-01', containerKind: 'stock', locked: false }, { containerId: 918, barcode: 'I000124', remainingQty: 3, locationCode: 'A-02', containerKind: 'stock', locked: false }] }] })
  apiClient.defaults.adapter = async config => {
    calls.push(config)
    if (config.method !== 'post') throw new Error(`unexpected method ${config.method}`)
    if (config.url === '/scan-logs/error' || config.url === '/scan-logs/undo') {
      if (failureStatus === 0) await new Promise<void>(resolve => { releaseLog = resolve })
      throw rejection(config, failureStatus || 500, failureStatus === 400 ? '条码不能超过64个字符' : '日志保存失败，请稍后重试')
    }
    if (config.url === '/scan-logs') {
      if (failPick) throw rejection(config, 400, '合成拣货拒绝')
      return { config, status: 201, statusText: 'Created', headers: {}, data: { success: true, data: {} } }
    }
    throw new Error(`unexpected URL ${config.url}`)
  }
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/pda/task/42']}><Routes><Route path="/pda/task/:id" element={<><Page /><UndoTrigger /><AppToast placement="pda" /></>} /></Routes></MemoryRouter></QueryClientProvider>) })
  await settle()
})
afterEach(async () => {
  if (releaseLog) { await act(async () => releaseLog?.()); await settle() }
  await act(async () => root.unmount()); cache.clear(); host.remove(); apiClient.defaults.adapter = originalAdapter
})
for (const kind of ['error', 'undo']) for (const status of [400, 500]) {
  test(`${kind} API ${status}: shows one error and the next keyboard scan can pick`, async () => {
    failureStatus = status
    if (kind === 'error') await gunScan('X'.repeat(65))
    else { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '测试撤销日志')!.click()); await settle() }
    const message = status === 400 ? '条码不能超过64个字符' : '日志保存失败，请稍后重试'
    expect(document.querySelectorAll('.fc-toast')).toHaveLength(0)
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(calls.filter(config => config.url === `/scan-logs/${kind}`)).toHaveLength(1)
    await gunScan('I000123')
    expect(calls.filter(config => config.url === '/scan-logs')).toHaveLength(1)
    expect(host.textContent).toContain('✓ 已拣 合成商品 ×3')
    expect(host.querySelector('input')).toBeNull()
  })
}
test('an unresolved optional error log does not keep picking busy; a later failure still allows a new scan', async () => {
  failureStatus = 0; failPick = true
  await gunScan('I000123')
  expect(releaseLog).toBeTypeOf('function')
  const pickButton = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('I000123')) as HTMLButtonElement
  expect(pickButton.disabled).toBe(false)
  await act(async () => { releaseLog?.(); releaseLog = undefined }); await settle()
  expect(document.querySelectorAll('.fc-toast')).toHaveLength(0)
  failPick = false
  // A different barcode exercises the next real keyboard scan without changing duplicate-scan policy.
  await gunScan('I000124')
  expect(calls.filter(config => config.url === '/scan-logs')).toHaveLength(2)
  expect(host.textContent).toContain('✓ 已拣 合成商品 ×3')
})
