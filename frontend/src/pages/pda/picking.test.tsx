// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaPickingPage from './picking'

const api = vi.hoisted(() => ({ tasks: vi.fn(), skus: vi.fn(), start: vi.fn(), detail: vi.fn() }))
vi.mock('@/api/warehouse-tasks', () => ({
  getMyTasksApi: api.tasks,
  getMyTaskSkuSummaryApi: api.skus,
  startPickingApi: api.start,
  getTaskByIdApi: api.detail,
}))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

const task = (id: number, status: 1 | 2, saleOrderNo: string) => ({
  id, status, taskNo: `WT${id}`, saleOrderNo, customerName: `客户${id}`,
  warehouseName: '主仓', statusName: status === 1 ? '待拣货' : '拣货中',
  priority: 2, priorityName: '普通', itemCount: 1,
  totalRequired: 3.5, totalPicked: 1.25,
})
const sku = (overrides: Record<string, unknown> = {}) => ({
  productId: 1001, productCode: 'P1001', productName: '测试商品名称',
  articleNumber: 'A-22', spec: 'M-18', color: '银色', unit: '个',
  totalRequired: 20.5, totalPicked: 8.25, orderCount: 2, taskIds: [1, 2],
  ...overrides,
})

function CurrentRoute() {
  return <p>当前路径：{useLocation().pathname}</p>
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.tasks.mockReset().mockResolvedValue([task(1, 1, 'SO001'), task(2, 2, 'SO002')])
  api.skus.mockReset().mockResolvedValue([sku()])
  api.start.mockReset().mockResolvedValue(null)
  api.detail.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => {
    root.render(<QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/pda/picking']}>
        <Routes>
          <Route path="/pda/picking" element={<PdaPickingPage />} />
          <Route path="/pda/task/:id" element={<CurrentRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>)
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}

test('商品卡完整显示已有特征、剩余量、单位和关联订单数', async () => {
  await mount()
  expect(host.textContent).toContain('P1001')
  expect(host.textContent).toContain('测试商品名称')
  expect(host.textContent).toContain('型号：M-18')
  expect(host.textContent).toContain('颜色：银色')
  expect(host.textContent).toContain('供应商型号：A-22')
  expect(host.textContent).toContain('还需拣 12.25 个')
  expect(host.textContent).toContain('已拣 8.25 / 共需 20.5 个')
  expect(host.textContent).toContain('涉及 2 单')
})

test('跨任务商品先选择任务，再进入选中的拣货任务', async () => {
  await mount()
  const choose = host.querySelector<HTMLButtonElement>('button[aria-label="选择 P1001 的拣货任务"]')
  expect(choose).not.toBeNull()
  await act(async () => { choose!.click() })
  expect(host.textContent).toContain('SO001')
  expect(host.textContent).toContain('SO002')
  expect(host.textContent).not.toContain('当前路径：')
  const secondTask = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('SO002'))
  await act(async () => { secondTask!.click() })
  expect(host.textContent).toContain('当前路径：/pda/task/2')
  expect(api.start).not.toHaveBeenCalled()
})

test('单任务待拣商品沿用启动任务流程', async () => {
  api.skus.mockResolvedValue([sku({ orderCount: 1, taskIds: [1] })])
  await mount()
  const enter = host.querySelector<HTMLButtonElement>('button[aria-label="进入 P1001 的拣货任务"]')
  expect(enter).not.toBeNull()
  await act(async () => { enter!.click(); await Promise.resolve() })
  expect(api.start).toHaveBeenCalledWith(1)
  expect(host.textContent).toContain('当前路径：/pda/task/1')
})

test('同一销售单关联两个拣货任务时仍要先选择任务', async () => {
  api.tasks.mockResolvedValue([task(1, 1, 'SO001'), task(2, 2, 'SO001')])
  api.skus.mockResolvedValue([sku({ orderCount: 1, taskIds: [1, 2] })])
  await mount()
  expect(host.textContent).toContain('涉及 1 单')
  const choose = host.querySelector<HTMLButtonElement>('button[aria-label="选择 P1001 的拣货任务"]')
  expect(choose).not.toBeNull()
  await act(async () => { choose!.click() })
  expect([...host.querySelectorAll('button')].filter(button => button.textContent?.includes('SO001'))).toHaveLength(2)
})

test('超过任务池列表上限的关联任务仍可按任务 ID 进入', async () => {
  api.skus.mockResolvedValue([sku({
    orderCount: 2, taskIds: [1, 51],
    taskOptions: [task(1, 1, 'SO001'), task(51, 2, 'SO051')],
  })])
  api.detail.mockResolvedValue({ id: 51, status: 2 })
  await mount()
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="选择 P1001 的拣货任务"]')!.click() })
  const missingTask = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('SO051'))
  expect(missingTask).toBeDefined()
  await act(async () => { missingTask!.click(); await Promise.resolve() })
  expect(api.detail).toHaveBeenCalledWith(51, { skipGlobalError: true })
  expect(host.textContent).toContain('当前路径：/pda/task/51')
})

test('订单列表的数量保留两位以内有效小数', async () => {
  await mount()
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '订单列表')!.click() })
  expect(host.textContent).toContain('1.25 / 3.5')
})

test('启动拣货失败只在页面显示具体原因', async () => {
  api.skus.mockResolvedValue([sku({ orderCount: 1, taskIds: [1] })])
  api.start.mockRejectedValue(new Error('任务状态已变化，请刷新后重试'))
  await mount()
  const enter = host.querySelector<HTMLButtonElement>('button[aria-label="进入 P1001 的拣货任务"]')!
  await act(async () => { enter.click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(host.textContent).toContain('任务状态已变化，请刷新后重试')
})
