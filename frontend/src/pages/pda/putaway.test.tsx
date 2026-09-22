// @vitest-environment jsdom
//
// PDA 上架页的「还不能上架」分支回归（2026-09-16）。
//
// 「收满才能上架」是服务端强制的规则（documentStatusRules 的 putaway.from=[3]）：
// 任务必须全部明细收满、或由 ERP 走「短装结案」把剩余未收量作罢，才会进入待上架(3)。
// 页面这一层负责在进不去的时候说清出路——状态 1 还没收过货，短装结案要求已有实收数量，
// 这时不能给这条指引。
//
// 扫码回归保留真实 PdaScanner、usePdaFlow 和视觉反馈，仅替换网络边界。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './putaway'

const api = vi.hoisted(() => ({ task: vi.fn(), container: vi.fn(), location: vi.fn(), suggestion: vi.fn(), putaway: vi.fn() }))

vi.mock('@/api/inbound-tasks', () => ({
  getInboundTaskByIdApi: api.task,
  putawayInboundApi: api.putaway,
}))

vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: api.container }))
vi.mock('@/api/locations', () => ({ getLocationByCodeApi: api.location }))
vi.mock('@/api/client', () => ({ payloadClient: { get: api.suggestion } }))
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: () => ({
  run: async (execute: (key: string) => Promise<unknown>) => ({ kind: 'success', data: await execute('scan-test-key') }),
  submitBlocked: false, phase: 'idle',
}) }))

const TASK = {
  id: 1979,
  taskNo: 'IT20260902015',
  status: 2,
  statusName: '收货中',
  submittedAt: '2026-09-02T16:12:00',
  warehouseId: 1,
  warehouseName: '北京主仓',
  supplierName: '某供应商',
  purchaseOrderNo: 'PO20260902018',
  printStatus: { key: 'queued', label: '待派发' },
  putawayStatus: { key: 'waiting', label: '待上架' },
  putawaySummary: { waitingContainers: 3, storedContainers: 0 },
  items: [{ id: 2281, productId: 2782, orderedQty: 100, receivedQty: 32 }],
}

let host: HTMLDivElement
let root: Root | null = null

async function mountPage(task: Record<string, unknown>) {
  api.task.mockResolvedValue(task)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/putaway/1979']}>
          <Routes><Route path="/putaway/:id" element={<Page />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  sessionStorage.clear()
  api.container.mockResolvedValue({ containerId: 917, productName: '测试商品', inboundTaskId: 1979, containerStatus: 'waiting_putaway' })
  api.suggestion.mockResolvedValue({ suggestions: [{ locationId: 804, locationCode: 'LOC-A01' }] })
  api.location.mockResolvedValue({ id: 804, code: 'LOC-A01' })
  api.putaway.mockResolvedValue(undefined)
  root = null
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  host?.remove()
})

test('收货中（未收满）不给上架界面，并指出收满或短装结案两条出路', async () => {
  await mountPage(TASK)

  expect(host.textContent).toContain('收货尚未完成')
  expect(host.textContent).toContain('全部收满后才能上架')
  expect(host.textContent, '供应商少发货是短装，要给出结案这条出路').toContain('短装结案')
  expect(host.textContent, '不应渲染扫码上架界面').not.toContain('扫描库存条码')
})

test('还没开始收货时不提短装结案（结案要求已有实收数量），只提示先收货', async () => {
  await mountPage({ ...TASK, status: 1, statusName: '待收货', putawaySummary: { waitingContainers: 0, storedContainers: 0 } })

  expect(host.textContent).toContain('收货尚未完成')
  expect(host.textContent).toContain('还没有开始收货')
  expect(host.textContent, '未收货时短装结案不适用').not.toContain('短装结案')
})

async function scan(code: string) {
  await act(async () => {
    for (const key of [...code, 'Enter']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
  })
}

test.each(['库存条码不存在或已失效', '没有库存查询权限', '请求超时，请重试'])(
  '库存扫码接口失败必须在页面显示原因：%s', async message => {
    api.container.mockRejectedValueOnce({ response: { data: { message } } })
    await mountPage({ ...TASK, status: 3 })
    await scan('I000917')
    expect(api.container).toHaveBeenCalledWith('I000917')
    expect(host.textContent).toContain(message)
    expect(api.putaway).not.toHaveBeenCalled()
  },
)

test.each([
  [{ containerStatus: 'stored', inboundTaskId: 1979 }, '该库存条码不是待上架状态'],
  [{ containerStatus: 'waiting_putaway', inboundTaskId: 1980 }, '该库存条码不属于当前收货单'],
])('库存状态或归属校验失败必须可见', async (container, message) => {
  api.container.mockResolvedValueOnce({ containerId: 917, ...container })
  await mountPage({ ...TASK, status: 3 })
  await scan('I000917')
  expect(host.textContent).toContain(message)
  expect(api.putaway).not.toHaveBeenCalled()
})

test('库存扫码成功显示商品与推荐库位；仅扫库位才提交上架', async () => {
  await mountPage({ ...TASK, status: 3 })
  await scan('I000917')
  expect(host.textContent).toContain('测试商品')
  expect(host.textContent).toContain('LOC-A01')
  expect(api.putaway).not.toHaveBeenCalled()
  await scan('R000804')
  expect(api.putaway).toHaveBeenCalledWith(1979, { containerId: 917, locationId: 804, deviatedFromSuggestion: undefined, suggestedLocationCode: undefined }, 'scan-test-key')
  expect(host.textContent).toContain('已上架到 LOC-A01')
})
