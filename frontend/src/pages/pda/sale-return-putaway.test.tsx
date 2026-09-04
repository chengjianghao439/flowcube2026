// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './sale-return-putaway'

const api = vi.hoisted(() => ({ task: vi.fn(), container: vi.fn(), location: vi.fn(), putaway: vi.fn(), ok: vi.fn(), err: vi.fn() }))
vi.mock('@/api/returns', () => ({ getReturnTaskByIdApi: api.task, getReturnPutawayContainerApi: api.container, getReturnPutawayLocationApi: api.location, putawayReturnApi: api.putaway }))
vi.mock('@/hooks/usePdaFeedback', () => ({ usePdaFeedback: () => ({ flash: null, ok: api.ok, err: api.err }) }))
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: ({ onConfirmed }: { onConfirmed: () => void }) => ({
  run: async (execute: (key: string) => Promise<unknown>) => { const data = await execute('stable-key'); onConfirmed(); return { kind: 'success', data } },
  submitBlocked: false, phase: 'idle',
}) }))

let root: Root
let host: HTMLDivElement
let qc: QueryClient
let navigate: NavigateFunction
function PageWithNavigation() {
  navigate = useNavigate()
  return <Page />
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  api.task.mockResolvedValue({ id: 31, taskNo: 'RT31', status: 4, warehouseId: 2, items: [] })
  api.container.mockImplementation(async (_id, barcode) => ({ containerId: 917, barcode, status: 4, taskId: 31, warehouseId: 2 }))
  api.location.mockResolvedValue({ id: 804, code: 'LOC-A01', status: 1, warehouseId: 2 })
  api.putaway.mockResolvedValue({ taskId: 31 })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/putaway/31']}><Routes><Route path="/putaway/:id" element={<PageWithNavigation />} /></Routes></MemoryRouter></QueryClientProvider>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
})
afterEach(async () => { await act(async () => { root.unmount(); qc.clear() }); host.remove() })
async function scan(code: string) {
  await act(async () => {
    for (const key of [...code, 'Enter']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

test.each([['I000123', 'R000456'], ['CNT000123', 'LOC-A01']])('%s then %s submits backend primary keys instead of barcode numbers', async (container, location) => {
  await scan(container)
  expect(api.container).toHaveBeenCalledWith(31, container)
  await scan(location)
  expect(api.location).toHaveBeenCalledWith(31, location)
  expect(api.putaway).toHaveBeenCalledWith(31, { containerId: 917, locationId: 804 }, 'stable-key')
  expect(api.ok).toHaveBeenCalledWith(expect.stringContaining('上架成功'))
})

test('invalid task container shows error and stays at container step', async () => {
  api.container.mockRejectedValueOnce(new Error('容器不属于当前退货任务'))
  await scan('I000123')
  expect(api.err).toHaveBeenCalledWith('容器不属于当前退货任务')
  await scan('R000456')
  expect(api.location).not.toHaveBeenCalled()
  expect(api.putaway).not.toHaveBeenCalled()
})

test('invalid location never submits, valid rescan still works', async () => {
  await scan('I000123')
  api.location.mockRejectedValueOnce(new Error('库位和退货任务不在同一仓库'))
  await scan('R000456')
  expect(api.err).toHaveBeenCalledWith('库位和退货任务不在同一仓库')
  expect(api.putaway).not.toHaveBeenCalled()
  await scan('LOC-A01')
  expect(api.putaway).toHaveBeenCalledOnce()
})

test('failed putaway is caught and shown, rather than an unhandled rejection', async () => {
  api.putaway.mockRejectedValueOnce(new Error('容器不是待上架状态'))
  await scan('I000123')
  await scan('R000456')
  expect(api.err).toHaveBeenCalledWith('容器不是待上架状态')
  expect(api.ok).not.toHaveBeenCalledWith(expect.stringContaining('上架成功'))
})

test('in-flight container lookup blocks another scan before React rerenders', async () => {
  let resolveLookup!: (value: object) => void
  api.container.mockReturnValueOnce(new Promise(resolve => { resolveLookup = resolve }))
  await scan('I000123')
  await scan('CNT000456')
  expect(api.container).toHaveBeenCalledOnce()
  await act(async () => { resolveLookup({ containerId: 917, barcode: 'I000123', taskId: 31, warehouseId: 2, status: 4 }) })
})

test('pending container list shows the new split barcode and quantity while still requiring a scan', async () => {
  await act(async () => {
    qc.setQueryData(['pda-return-task', 31], { id: 31, taskNo: 'RT31', status: 4, warehouseId: 2, items: [],
      pendingPutawayContainers: [{ id: 917, barcode: 'I000918', qty: 4, productName: '测试商品', productId: 8 }],
    })
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(host.textContent).toContain('I000918')
  expect(host.textContent).toContain('4')
  expect(api.putaway).not.toHaveBeenCalled()
  await scan('R000456')
  expect(api.location).not.toHaveBeenCalled()
})

test('a late write receipt from the previous task does not clear the newly scanned task container', async () => {
  let finishPrevious!: (value: object) => void
  api.putaway.mockReturnValueOnce(new Promise(resolve => { finishPrevious = resolve }))
  await scan('I000123')
  await scan('R000456')
  api.task.mockImplementation(async id => ({ id, taskNo: `RT${id}`, status: 4, warehouseId: 2, items: [] }))
  api.container.mockImplementation(async (id, barcode) => ({ containerId: 918, barcode, status: 4, taskId: id, warehouseId: 2 }))
  await act(async () => navigate('/putaway/32'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  await scan('I000918')
  expect(host.textContent).toContain('I000918')
  await act(async () => finishPrevious({ taskId: 31, containerId: 917 }))
  expect(host.textContent).toContain('I000918')
  await scan('LOC-A01')
  expect(api.putaway).toHaveBeenLastCalledWith(32, { containerId: 918, locationId: 804 }, 'stable-key')
})
