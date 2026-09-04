// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import Page from './sale-return-receive'
const boundary = vi.hoisted(() => ({ task: vi.fn(), confirmed: {} as Record<string, (value: object) => void> }))
vi.mock('@/api/returns', () => ({ getReturnTaskByIdApi: boundary.task }))
vi.mock('@/hooks/usePdaFeedback', () => ({ usePdaFeedback: () => ({ flash: null, ok: vi.fn(), err: vi.fn() }) }))
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: ({ action, onConfirmed }: { action: string; onConfirmed: (value: object) => void }) => {
  boundary.confirmed[action] = onConfirmed
  return { phase: 'idle' }
} }))
let host: HTMLDivElement
let root: Root
let qc: QueryClient
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  boundary.task.mockResolvedValue({ id: 31, taskNo: 'RT31', status: 3, warehouseId: 2, submittedAt: '2026-09-04', items: [] })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/receive/31']}><Routes><Route path="/receive/:id" element={<Page />} /></Routes></MemoryRouter></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
})
afterEach(async () => { await act(async () => { root.unmount(); qc.clear() }); host.remove() })

test.each(['return.receive.31', 'return.check.31'])('%s receipt exposes new labels and explicit missing-printer guidance', async action => {
  await act(async () => boundary.confirmed[action]({ taskId: 31, status: 4,
    containers: [{ containerId: 917, barcode: 'I000918', qty: 4, status: 4 }], printJobIds: [], noPrinterCount: 1,
  }))
  expect(host.textContent).toContain('I000918')
  expect(host.textContent).toContain('数量 4')
  expect(host.textContent).toContain('未找到可用标签打印机')
})
