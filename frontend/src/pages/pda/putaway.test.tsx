// @vitest-environment jsdom
//
// PDA 上架页的「还不能上架」分支回归（2026-09-16）。
//
// 「收满才能上架」是服务端强制的规则（documentStatusRules 的 putaway.from=[3]）：
// 任务必须全部明细收满、或由 ERP 走「短装结案」把剩余未收量作罢，才会进入待上架(3)。
// 页面这一层负责在进不去的时候说清出路——状态 1 还没收过货，短装结案要求已有实收数量，
// 这时不能给这条指引。
//
// 该分支在 PutawayRunner 之前 return，因此无需 mock 流程引擎与扫码组件。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './putaway'

const api = vi.hoisted(() => ({ task: vi.fn() }))

vi.mock('@/api/inbound-tasks', () => ({
  getInboundTaskByIdApi: api.task,
}))

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
  api.task.mockReset()
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
