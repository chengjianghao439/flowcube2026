// @vitest-environment jsdom
//
// PDA 收货订单列表：卡片按钮与跳转目标只看任务状态（1/2 收货、3 待上架），
// 不看「有没有容器在等上架」——每收一箱就会有待上架容器，多商品单收到一半时
// 若按后者判断，卡片会变成「扫码上架」，剩下没收完的商品连入口都没有
// （2026-09-15 生产 IN20260914001）。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './inbound'

const api = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@/api/inbound-tasks', () => ({
  getInboundTasksApi: api.list,
}))

const TASK = {
  id: 7,
  taskNo: 'IN20260914001',
  status: 2,
  statusName: '收货中',
  submittedAt: '2026-09-14T16:12:00',
  warehouseId: 1,
  warehouseName: '主仓',
  supplierName: '某供应商',
  purchaseOrderNo: 'PC20260914001',
  receiptStatus: { key: 'receiving', label: '收货中' },
  printStatus: { key: 'queued', label: '待派发' },
  putawayStatus: { key: 'waiting', label: '待上架' },
  putawaySummary: { waitingContainers: 1, storedContainers: 0 },
  orderedQty: 12,
  receivedQty: 12,
  items: [{ id: 7, orderedQty: 12, receivedQty: 12 }],
}

let host: HTMLDivElement
let root: Root | null = null

async function mountPage(task: Record<string, unknown> = TASK) {
  api.list.mockResolvedValue({ list: [task], pagination: { page: 1, pageSize: 500, total: 1 } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/pda/inbound']}>
          <Routes>
            <Route path="/pda/inbound" element={<Page />} />
            <Route path="/pda/receive/:id" element={<div>收货录入页</div>} />
            <Route path="/pda/putaway/:id" element={<div>上架扫码页</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))
  if (!found) throw new Error(`未找到按钮：${text}`)
  return found as HTMLButtonElement
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.list.mockReset()
  root = null
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  host?.remove()
})

test('收到一半（有待上架容器但任务仍是收货中）仍给「开始收货」入口', async () => {
  await mountPage()

  expect(buttonByText('开始收货'), '不应被判定成已进入上架阶段').toBeTruthy()
  expect(host.textContent).not.toContain('扫码上架')

  await act(async () => { buttonByText('开始收货').click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(host.textContent, '应进收货录入页而不是上架页').toContain('收货录入页')
})

test('全部收满（任务已推进到待上架）才把入口换成「扫码上架」', async () => {
  await mountPage({
    ...TASK,
    status: 3,
    statusName: '待上架',
    receiptStatus: { key: 'printed_waiting_putaway', label: '待上架' },
  })

  expect(buttonByText('扫码上架')).toBeTruthy()
  expect(host.textContent).not.toContain('开始收货')

  await act(async () => { buttonByText('扫码上架').click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(host.textContent, '应进上架扫码页').toContain('上架扫码页')
})
