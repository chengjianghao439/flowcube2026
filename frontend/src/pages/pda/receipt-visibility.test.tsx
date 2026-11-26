// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import Adjustment from './adjustment'
import Check from './check'
import Putaway from './putaway'
import Receive from './receive'
import ReturnPutaway from './sale-return-putaway'

const state = vi.hoisted(() => ({ action: '', stage: '', confirm: vi.fn() }))
vi.mock('@tanstack/react-query', async orig => ({
  ...await orig<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: state.stage === 'terminal' ? { id: 24, submittedAt: '2026-10-01', status:5, statusName:'已完成', items:[] } : undefined,
    isLoading: state.stage === 'loading', isError: state.stage === 'error', refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: ({ action }: { action: string }) => ({
    pendingRecord: state.action === action ? { requestKey:'original-fixture', action, metadata:{}, label:'上次作业' } : null,
    blockedReason: state.action === action ? '结果待确认' : null,
    confirmPending: state.confirm, clearPending: vi.fn(), clearError: vi.fn(), phase:'idle',
  }),
}))

const pages: [string, ComponentType, string][] = [
  ['adjustment', Adjustment, 'warehouse.adjustment-return.24'],
  ['check', Check, 'warehouse.check-scan.24'],
  ['putaway', Putaway, 'inbound.putaway.24'],
  ['receive', Receive, 'inbound.receive.24'],
  ['return-putaway', ReturnPutaway, 'return.putaway.24'],
]
test.each(pages)('%s 读取失败和加载中仍可点击原回执', async (path, Page, action) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  for (const stage of path === 'adjustment' ? ['loading','error'] : ['loading','error','terminal']) {
    Object.assign(state, {action,stage})
    state.confirm.mockReset().mockResolvedValue({status:'pending'})
    const host = document.createElement('div'), root = createRoot(host)
    const qc = new QueryClient()
    try {
      await act(async () => {
        root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/work/24']}>
          <Routes><Route path="/work/:id" element={<Page />} /></Routes></MemoryRouter></QueryClientProvider>)
      })
      const confirm = [...host.querySelectorAll('button')].find(b => b.textContent === '确认上次结果')
      expect(confirm, stage).toBeDefined()
      await act(async () => { confirm!.click() })
      expect(state.confirm).toHaveBeenCalledTimes(1)
    } finally { await act(async () => root.unmount()); qc.clear() }
  }
})
