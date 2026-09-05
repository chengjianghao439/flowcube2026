// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TransferIn from './transfer-in'
import TransferOut from './transfer-out'
import TransferList from './transfer'
import type { TransferOrder } from '@/api/transfer'

const state = vi.hoisted(() => ({
  list: [] as TransferOrder[], receipt: vi.fn(), container: vi.fn(), remove: vi.fn(), record: {} as Record<string, unknown>,
  order: { id: 31, orderNo: 'TR31', status: 3, statusName: '在途', fromWarehouseId: 1, toWarehouseId: 2, items: [{ id: 1, productName: '商品', quantity: 10, deductedQty: 5, receivedQty: 5 }] },
}))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: state.receipt }))
vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: state.container }))
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
vi.mock('@/hooks/usePendingRequests', () => ({ usePendingRequests: () => ({ records: [state.record], addPending: vi.fn(), removePending: state.remove }) }))
vi.mock('@/hooks/usePdaTransferIn', () => ({ usePdaTransferInDetail: () => ({ data: state.order, isLoading: false }) }))
vi.mock('@/api/transfer', () => ({ getTransferListApi: async () => ({ list: state.list }), getTransferDetailApi: async () => state.order, scanInTransferApi: vi.fn(), scanOutTransferApi: vi.fn() }))
vi.mock('@/hooks/usePdaFeedback', () => ({ usePdaFeedback: () => ({ flash: null, ok: vi.fn(), err: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/components/pda/PdaScanner', () => ({ default: () => null }))
let root: Root, host: HTMLDivElement, qc: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  state.list = []
  state.receipt.mockResolvedValue({ status: 'not_found', data: null, message: '未找到回执' })
  // 该容器已在目标仓且已上架，但没有证据证明属于当前调拨单。
  state.container.mockResolvedValue({ warehouseId: 2, containerStatus: 'stored', locationId: 88 })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
  qc.setQueryData(['pda-transfer', 31], state.order)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount(); qc.clear() }); host.remove() })

test.each(['In', 'Out'])('scan%s keeps ambiguous container state pending and queries old records by bound action', async direction => {
  state.record = { action: `transfer.scan${direction}.31`, requestAction: `transfer.scan${direction}`, requestKey: 'legacy-key', label: '调拨', createdAt: '2026-09-05', metadata: { barcode: 'I123' } }
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/transfer/31']}><Routes><Route path="/transfer/:id" element={direction === 'In' ? <TransferIn /> : <TransferOut />} /></Routes></MemoryRouter></QueryClientProvider>))
  expect(state.receipt).toHaveBeenCalledWith('legacy-key', `transfer.scan${direction}.31`)
  expect(state.remove).not.toHaveBeenCalled()
  expect(host.textContent).toContain('待确认')
  if (direction === 'In') expect(host.textContent).toContain('计划 10')
})


function LocationProbe() { return <span data-testid="location">{useLocation().pathname}</span> }
function listOrder(status: TransferOrder['status'], quantities: Array<[number, number]>): TransferOrder {
  return { id: 31, orderNo: 'TR31', status, statusName: '测试状态', fromWarehouseId: 1, fromWarehouseName: '源仓', toWarehouseId: 2, toWarehouseName: '目标仓', operatorName: '测试', createdAt: '2026-09-05',
    items: quantities.map(([quantity, deductedQty], index) => ({ id: index + 1, productId: 1, productName: '同款商品', productCode: 'P1', unit: '件', quantity, deductedQty, receivedQty: 0 })) }
}
async function renderList(order: TransferOrder) {
  state.list = [order]
  qc.setQueryData(['pda-transfers'], state.list)
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/pda/transfer']}><TransferList /><LocationProbe /></MemoryRouter></QueryClientProvider>))
}
const outboundButtons = () => Array.from(host.querySelectorAll('button')).filter(b => b.textContent === '调出仓扫码出库')
const inboundButtons = () => Array.from(host.querySelectorAll('button')).filter(b => b.textContent === '调入仓扫码入库')

test.each([
  ['普通部分出库', [[10, 5]]],
  ['同款多行有未完成行', [[3, 3], [7, 2]]],
  ['四位小数剩余最小单位', [[0.3, 0.3], [0.2001, 0.2]]],
  ['逐行余量不被其他行历史超出抵消', [[3, 4], [7, 6]]],
] as Array<[string, Array<[number, number]>]>)('在途%s 保留源仓出库入口和原入库分组', async (_label, quantities) => {
  await renderList(listOrder(3, quantities))
  expect(outboundButtons()).toHaveLength(1)
  expect(inboundButtons()).toHaveLength(1)
  await act(async () => outboundButtons()[0].click())
  expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/pda/transfer-out/31')
})

test('从待出库经过部分出库到全部出完，列表刷新持续提供正确入口', async () => {
  await renderList(listOrder(2, [[3, 0], [7, 0]]))
  expect(outboundButtons()).toHaveLength(1)
  expect(inboundButtons()).toHaveLength(0)
  await act(async () => { qc.setQueryData(['pda-transfers'], [listOrder(3, [[3, 3], [7, 2]])]); await new Promise(r => setTimeout(r, 5)) })
  expect(outboundButtons()).toHaveLength(1)
  expect(inboundButtons()).toHaveLength(1)
  await act(async () => { qc.setQueryData(['pda-transfers'], [listOrder(3, [[3, 3], [7, 7]])]); await new Promise(r => setTimeout(r, 5)) })
  expect(outboundButtons()).toHaveLength(0)
  expect(inboundButtons()).toHaveLength(1)
})

test.each([1, 4, 5] as const)('状态%s 即使明细未出完也不提供执行入口', async status => {
  await renderList(listOrder(status, [[10, 0]]))
  expect(outboundButtons()).toHaveLength(0)
  expect(inboundButtons()).toHaveLength(0)
})
