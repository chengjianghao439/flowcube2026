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
import { ApiClientError } from '@/api/client'
import Page from './putaway'

const api = vi.hoisted(() => ({ task: vi.fn(), container: vi.fn(), location: vi.fn(), suggestion: vi.fn(), putaway: vi.fn() }))

vi.mock('@/api/inbound-tasks', () => ({
  getInboundTaskByIdApi: api.task,
  putawayInboundApi: api.putaway,
}))

vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: api.container }))
vi.mock('@/api/locations', () => ({ getLocationByCodeApi: api.location }))
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  payloadClient: { get: api.suggestion },
}))
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: ({ onConfirmed }: { onConfirmed?: (data: unknown, ctx: { recovered: boolean; requestKey: string }) => unknown }) => ({
  run: async (execute: (key: string) => Promise<unknown>) => {
    const requestKey = 'scan-test-key'
    const data = await execute(requestKey)
    await onConfirmed?.(data, { recovered: false, requestKey })
    return { kind: 'success', data }
  },
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

let qc: QueryClient
let host: HTMLDivElement
let root: Root | null = null

async function mountPage(task: Record<string, unknown>) {
  api.task.mockResolvedValue(task)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
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

test('收货中已收容器可以原扫码上架，仍能继续收货', async () => {
  await mountPage(TASK)
  expect(host.textContent).toContain('扫描库存条码')
  await scan('I000917')
  await scan('R000804')
  expect(api.putaway).toHaveBeenCalledWith(1979, expect.objectContaining({ containerId: 917 }), 'scan-test-key')
})

test('收货中实收已全上架只能说明继续收货，不能称整单完成', async () => {
  await mountPage({ ...TASK, putawayStatus: { key: 'completed', label: '已上架' }, putawaySummary: { waitingContainers: 0, storedContainers: 3 } })
  expect(host.textContent).toContain('已收到的货已全部上架，仍可继续收货')
  expect(host.textContent).not.toContain('该订单上架已完成')
  expect(host.textContent).not.toContain('扫描库存条码')
})

test('还没开始收货时不提短装结案（结案要求已有实收数量），只提示先收货', async () => {
  await mountPage({ ...TASK, status: 1, statusName: '待收货', putawaySummary: { waitingContainers: 0, storedContainers: 0 } })

  expect(host.textContent).toContain('尚未收货')
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

test('上架页与拣货页统一：默认等硬件扫码，只有点手动输入按钮才弹键盘', async () => {
  await mountPage({ ...TASK, status: 3 })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  expect(document.activeElement?.tagName).not.toBe('INPUT')

  const scanArea = host.querySelector<HTMLElement>('[data-testid="pda-scan-area"]')
  expect(scanArea).not.toBeNull()
  await act(async () => { scanArea!.click() })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
  const manualButton = [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')
  expect(manualButton).not.toBeUndefined()
  await act(async () => { manualButton!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')
  expect(input).not.toBeNull()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
  expect(document.activeElement).toBe(input)

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, 'I000917')
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(api.container).toHaveBeenCalledWith('I000917', { skipGlobalError: true })
  expect(host.textContent).toContain('测试商品')
  expect(api.putaway).not.toHaveBeenCalled()

  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')!.click() })
  const locationInput = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  expect(locationInput.getAttribute('aria-label')).toContain('库位编码')
  api.location.mockResolvedValueOnce(null)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(locationInput, 'H000001')
    locationInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { locationInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBe(locationInput)
  expect(locationInput.value).toBe('H000001')
  expect(api.putaway).not.toHaveBeenCalled()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(locationInput, 'R000804')
    locationInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { locationInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(api.putaway).toHaveBeenCalledWith(1979, { containerId: 917, locationId: 804, deviatedFromSuggestion: undefined, suggestedLocationCode: undefined }, 'scan-test-key')
})

test.each(['库存条码不存在或已失效', '没有库存查询权限', '请求超时，请重试'])(
  '库存扫码接口失败必须在页面显示原因：%s', async message => {
    api.container.mockRejectedValueOnce({ response: { data: { message } } })
    await mountPage({ ...TASK, status: 3 })
    await scan('I000917')
    expect(api.container).toHaveBeenCalledWith('I000917', { skipGlobalError: true })
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
  expect(host.textContent).toContain('测试商品，建议库位 LOC-A01，扫描库位条码或输入库位编码')
  expect(host.textContent).toContain('R000123')
  expect(api.putaway).not.toHaveBeenCalled()
  await scan('R000804')
  expect(api.putaway).toHaveBeenCalledWith(1979, { containerId: 917, locationId: 804, deviatedFromSuggestion: undefined, suggestedLocationCode: undefined }, 'scan-test-key')
  expect(host.textContent).toContain('已上架到库位 LOC-A01')
})

test.each(['H000001', 'WRONG-CODE'])('库位查询拒绝 %s 后说明支持的标识并允许录入库位编码', async code => {
  await mountPage(TASK)
  await scan('I000917')
  api.location.mockRejectedValueOnce(new ApiClientError({ status: 404, message: `库位编码 ${code} 不存在` }))
  await scan(code)
  expect(host.textContent).toContain('未找到库位，请扫描本仓库位条码（如 R000123）或输入库位编码')
  expect(api.putaway).not.toHaveBeenCalled()

  await scan('LOC-A01')
  expect(api.location).toHaveBeenLastCalledWith('LOC-A01')
  expect(api.putaway).toHaveBeenCalledExactlyOnceWith(1979, expect.objectContaining({ containerId: 917, locationId: 804 }), 'scan-test-key')
})

test('其他仓库位被上架接口拒绝后保持库位步骤，可扫本仓库位重试', async () => {
  api.suggestion.mockResolvedValueOnce({ suggestions: [] })
  await mountPage(TASK)
  await scan('I000917')
  api.location.mockResolvedValueOnce({ id: 900, code: 'OTHER-A01' })
  api.putaway.mockRejectedValueOnce(new ApiClientError({ status: 400, message: '库位与库存条码不在同一仓库' }))
  await scan('R000900')
  expect(host.textContent).toContain('库位与库存条码不在同一仓库')
  expect(host.textContent).toContain('使用本仓的库位标签（如 R000123）')
  expect(host.textContent).not.toContain('已上架到库位')

  await scan('R000804')
  expect(api.putaway.mock.calls.map(([, payload]) => payload.locationId)).toEqual([900, 804])
  expect(host.textContent).toContain('已上架到库位 LOC-A01')
})

test('偏离推荐库位需有意复扫，重复上报不会提前提交', async () => {
  await mountPage(TASK)
  await scan('I000917')
  api.location.mockResolvedValue({ id: 805, code: 'LOC-A02' })
  const start = Date.now()
  const now = vi.spyOn(Date, 'now').mockReturnValue(start)
  try {
    await scan('R000805')
    expect(host.textContent).toContain('确认放到库位 LOC-A02 请再扫一次')
    expect(api.putaway).not.toHaveBeenCalled()
    await scan('R000805')
    expect(api.putaway).not.toHaveBeenCalled()

    now.mockReturnValue(start + 350)
    await scan('R000805')
    expect(api.putaway).toHaveBeenCalledExactlyOnceWith(1979, {
      containerId: 917, locationId: 805, deviatedFromSuggestion: true, suggestedLocationCode: 'LOC-A01',
    }, 'scan-test-key')
  } finally {
    now.mockRestore()
  }
})

test('先上架首箱导致扫码组件卸载，再收一箱仍从库存条码开始', async () => {
  await mountPage({ ...TASK, putawaySummary: { waitingContainers: 1, storedContainers: 0 } })
  await scan('I000917')
  let finishRefresh!: () => void
  const refreshGate = new Promise<void>(resolve => { finishRefresh = resolve })
  const invalidate = qc.invalidateQueries.bind(qc)
  vi.spyOn(qc, 'invalidateQueries').mockImplementation(async (...args) => {
    await invalidate(...args)
    if (args[0]?.queryKey?.[0] === 'pda-inbound-task') await refreshGate
  })
  api.task.mockResolvedValue({ ...TASK, putawaySummary: { waitingContainers: 0, storedContainers: 1 } })
  await scan('R000804')
  await vi.waitFor(() => expect(host.textContent).toContain('暂无待上架货物'))
  await act(async () => finishRefresh())

  const next = { ...TASK, putawaySummary: { waitingContainers: 1, storedContainers: 1 } }
  api.task.mockResolvedValue(next)
  api.container.mockResolvedValue({ containerId: 918, productName: '第二箱', inboundTaskId: 1979, containerStatus: 'waiting_putaway' })
  await act(async () => { qc.setQueryData(['pda-inbound-task', 1979], next) })
  await vi.waitFor(() => expect(host.querySelector('[data-testid="pda-scan-area"]')).not.toBeNull())
  await scan('I000918')
  expect(api.container).toHaveBeenCalledWith('I000918', { skipGlobalError: true })
  expect(api.putaway).toHaveBeenCalledTimes(1)
  await scan('R000804')
  expect(api.putaway.mock.calls.map(([, payload]) => payload.containerId)).toEqual([917, 918])
})

test('上架请求结果未知时保留原箱和库位步骤', async () => {
  await mountPage(TASK)
  await scan('I000917')
  api.putaway.mockRejectedValueOnce(new Error('上架结果待确认'))
  await scan('R000804')
  expect(host.textContent).toContain('上架结果待确认')
  const draft = JSON.parse(sessionStorage.getItem('pda_flow_inbound-putaway-1979')!)
  expect(draft).toMatchObject({ stepId: 'scan-location', context: { containerId: 917 } })
})
