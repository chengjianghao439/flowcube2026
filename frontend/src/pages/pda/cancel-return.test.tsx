// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import PdaCancelReturnPage from './cancel-return'
import type { CancelReturnDetail } from '@/api/warehouse-tasks'
import { useAuthStore } from '@/store/authStore'
import { usePdaCancelReturnDetail } from '@/hooks/usePdaCancelReturn'
import { captureKitReadOwner } from '@/hooks/useKits'
import { KIT_QUERY_KEY, saveKitQuery } from '@/lib/kitOperationRecovery'
import { kitQuerySession } from '@/lib/kitRecoveryIdentity'
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  box: vi.fn(),
  query: vi.fn(),
  detailGet: vi.fn(),
  ok: vi.fn(),
  defaults: { baseURL: '/a' },
  onScan: null as null | ((s: string) => void)
}))
vi.mock('@/api/client', () => ({
  default: { defaults: mocks.defaults },
  payloadClient: { get: mocks.detailGet, post: (url: string, ...args: unknown[]) => url.endsWith('/box') ? mocks.box(url, ...args) : mocks.scan(url, ...args) }
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: mocks.query
}))
vi.mock('@/api/locations', () => ({
  getLocationByCodeApi: async () => ({ id: 6, code: 'LOC6' })
}))
const detail: CancelReturnDetail = {
  id: 80,
  taskNo: 'WT80',
  status: 2,
  cancelRequestedAt: '2026-10-01',
  warehouseId: 1,
  warehouseName: '仓一',
  customerName: 'fixture',
  containers: [
    {
      containerId: 30,
      productId: 1,
      barcode: 'I30',
      productName: '铰链',
      qty: 10,
      taskReturnQty: 1,
      remainingQty: 10,
      quantitySource: 'active_pick',
      containerKind: 'inventory',
      suggestedLocationCode: 'LOC6',
      zone: null,
      aisle: null,
      rack: null,
      level: null,
      position: null
    }
  ],
  packages: []
}
vi.mock('@/components/pda/PdaScanner', () => ({
  default: ({ onScan }: { onScan: (s: string) => void }) => {
    mocks.onScan = onScan
    return <div>scanner</div>
  }
}))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({
    flash: null,
    ok: mocks.ok,
    err: vi.fn(),
    warn: vi.fn()
  })
}))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.detailGet.mockResolvedValue(detail)
  useAuthStore
    .getState()
    .login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
})
async function mount(run: (host: HTMLElement) => Promise<void>) {
  const host = document.createElement('div'),
    root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={['/pda/cancel-return/80']}>
            <Routes>
              <Route
                path="/pda/cancel-return/:id"
                element={<PdaCancelReturnPage />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )
    )
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await run(host)
  } finally {
    act(() => root.unmount())
    cache.clear()
  }
}
test('kit cancel-return shows task share1 separately from physical barcode balance10', async () => {
  await mount(async (host) => {
    expect(host.textContent).toContain('本任务应归还 1')
    expect(host.textContent).toContain('条码账面 10')
  })
})
test('unknown row scan stores original task/container/location and queries real scoped receipt; scanlog id is not container id', async () => {
  mocks.scan.mockRejectedValue({ status: 503, code: 'NETWORK_ERROR' })
  mocks.query.mockResolvedValue({
    status: 'success',
    resourceType: 'warehouse_task',
    resourceId: 80,
    data: { id: 999, remaining: 0, packagesRemaining: 0, finalized: true }
  })
  await mount(async (host) => {
    await act(async () => mocks.onScan!('I30'))
    await act(async () => {
      mocks.onScan!('LOC6')
      await new Promise((r) => setTimeout(r, 5))
    })
    const b = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === '查询原归还回执'
    )
    expect(b).toBeTruthy()
    await act(async () => b!.click())
    expect(mocks.query).toHaveBeenCalledWith(
      expect.any(String),
      'scan-log.cancel-return.80',
      expect.objectContaining({ baseURL: '/a' })
    )
    expect(mocks.scan).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain('结果待确认')
  })
})

test('ordinary plastic-box quantity remains legacy qty; row retry preserves original body and location', async () => {
  const original = detail.containers[0]
  detail.containers = [
    {
      ...original,
      quantitySource: undefined,
      taskReturnQty: undefined,
      remainingQty: undefined,
      containerKind: 'plastic_box'
    }
  ]
  mocks.scan
    .mockRejectedValueOnce({ status: 408 })
    .mockResolvedValue({
      id: 1000,
      remaining: 0,
      packagesRemaining: 0,
      finalized: false
    })
  mocks.query.mockResolvedValue({ status: 'not_found', data: null })
  try {
    await mount(async (host) => {
      expect(host.textContent).not.toContain('本任务应归还')
      expect(host.textContent).toContain('10')
      await act(async () => mocks.onScan!('I30'))
      await act(async () => {
        mocks.onScan!('LOC6')
        await new Promise((r) => setTimeout(r, 5))
      })
      const doc = JSON.parse(
        sessionStorage.getItem('flowcube-kit-query-records-v1')!
      )
      expect(doc.records[0].context).toEqual({
        taskId: 80,
        containerId: 30,
        locationId: 6
      })
      expect(JSON.stringify(doc)).not.toContain('I30')
      const retry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === '按原归还请求重试'
      )!
      await act(async () => retry.click())
      expect(mocks.scan.mock.calls[1]).toEqual(mocks.scan.mock.calls[0])
      expect(mocks.query.mock.calls[0][1]).toBe('scan-log.cancel-return.80')
    })
  } finally {
    detail.containers = [original]
  }
})
test('box unknown uses original package action/context and successful current-task receipt does not compare scanlog id to box id', async () => {
  detail.packages = [{ packageId: 40, barcode: 'L40', items: [] }]
  mocks.box.mockRejectedValue({ status: 503 })
  mocks.query.mockResolvedValue({
    status: 'success',
    resourceType: 'warehouse_task',
    resourceId: 80,
    data: {
      id: 999,
      containersRemaining: 0,
      packagesRemaining: 0,
      finalized: true
    }
  })
  try {
    await mount(async (host) => {
      await act(async () => {
        mocks.onScan!('L40')
        await new Promise((r) => setTimeout(r, 5))
      })
      const doc = JSON.parse(
        sessionStorage.getItem('flowcube-kit-query-records-v1')!
      )
      expect(doc.records[0].context).toEqual({ taskId: 80, packageId: 40 })
      const query = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === '查询原拆箱回执'
      )!
      await act(async () => query.click())
      expect(mocks.query.mock.calls[0][1]).toBe('scan-log.cancel-return-box.80')
      expect(mocks.box).toHaveBeenCalledTimes(1)
      expect(host.textContent).not.toContain('拆箱结果待确认')
    })
  } finally {
    detail.packages = []
  }
})

function restoreOriginal(box = false) {
  saveKitQuery({
    version: 1, draftId: 'original', scope: box ? 'pda-cancel-return-box:80' : 'pda-cancel-return:80',
    sessionId: kitQuerySession(), userId: 5, baseURL: '/a', requestKey: 'owned-original-key',
    action: box ? 'scan-log.cancel-return-box.80' : 'scan-log.cancel-return.80',
    kind: box ? 'cancel-return-box' : 'cancel-return-row', resourceType: 'warehouse_task', resourceId: 80,
    context: box ? { taskId: 80, packageId: 40 } : { taskId: 80, containerId: 30, locationId: 6 }
  })
}
async function clickText(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!
  expect(button, text).toBeTruthy()
  await act(async () => { button.click(); await new Promise(r => setTimeout(r, 5)) })
}
test.each(['loading-row', '403-row', '403-box'] as const)('durable original query remains reachable with %s detail and never enables scanning', async state => {
  const box = state.endsWith('box')
  restoreOriginal(box)
  if (state.startsWith('loading')) mocks.detailGet.mockImplementation(() => new Promise(() => {}))
  else mocks.detailGet.mockRejectedValue({ status: 403 })
  mocks.query.mockResolvedValue({
    status: 'success', resourceType: 'warehouse_task', resourceId: 80,
    data: box ? { id: 999, containersRemaining: 0, packagesRemaining: 0, finalized: true } : { id: 999, remaining: 0, packagesRemaining: 0, finalized: true }
  })
  await mount(async host => {
    expect(host.textContent).not.toContain('scanner')
    await clickText(host, box ? '查询原拆箱回执' : '查询原归还回执')
    expect(mocks.query).toHaveBeenCalledWith('owned-original-key', box ? 'scan-log.cancel-return-box.80' : 'scan-log.cancel-return.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.ok).toHaveBeenCalledWith(expect.stringContaining('当前扫码保持'))
    expect(JSON.parse(sessionStorage.getItem(KIT_QUERY_KEY)!).records).toHaveLength(0)
    expect(host.textContent).not.toContain('scanner')
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.box).not.toHaveBeenCalled()
  })
})
test('detail403 and failed receipt query keep original identity and a usable query-only retry', async () => {
  restoreOriginal()
  mocks.detailGet.mockRejectedValue({ status: 403 })
  mocks.query.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({ status: 'not_found', data: null })
  await mount(async host => {
    const original = sessionStorage.getItem(KIT_QUERY_KEY)
    await clickText(host, '查询原归还回执')
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(original)
    await clickText(host, '查询原归还回执')
    expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(original)
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原归还请求重试')!.disabled).toBe(true)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.scan).not.toHaveBeenCalled()
  })
})
test('owned PDA detail rejects refresh while server differs before GET and never selects foreign body', async () => {
  mocks.scan.mockRejectedValue({ status: 503 })
  await mount(async host => {
    expect(host.textContent).toContain('本任务应归还 1')
    mocks.defaults.baseURL = '/b'
    await clickText(host, '刷新')
    expect(mocks.detailGet).toHaveBeenCalledTimes(1)
    mocks.defaults.baseURL = '/a'
    await act(async () => { mocks.onScan!('I31'); mocks.onScan!('LOC6'); await Promise.resolve() })
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('B-WT80')
  })
})
test.each(['foreign-id', 'owner-left'] as const)('owned GET rejects %s response and never exposes its scanner/body', async scenario => {
  let finish!: (value: CancelReturnDetail) => void
  mocks.detailGet.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await mount(async host => {
    expect(mocks.detailGet.mock.calls[0][1]).toEqual(expect.objectContaining({ baseURL: '/a' }))
    await act(async () => {
      if (scenario === 'owner-left') mocks.defaults.baseURL = '/b'
      finish({ ...detail, id: scenario === 'foreign-id' ? 81 : 80, taskNo: 'ForeignWT', containers: [{ ...detail.containers[0], containerId: 31, barcode: 'I31', taskReturnQty: 7 }] })
      await new Promise(r => setTimeout(r, 5))
    })
    expect(host.textContent).not.toContain('ForeignWT')
    expect(host.textContent).not.toContain('scanner')
    expect(mocks.scan).not.toHaveBeenCalled()
  })
})
test('GET begun at A stays fixed to A through B then A before response and chooses only A body', async () => {
  let finish!: (value: CancelReturnDetail) => void
  mocks.detailGet.mockResolvedValueOnce(detail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mocks.scan.mockRejectedValue({ status: 503 })
  await mount(async host => {
    await clickText(host, '刷新')
    expect(mocks.detailGet.mock.calls[1][1]).toEqual(expect.objectContaining({ baseURL: '/a' }))
    await act(async () => { mocks.defaults.baseURL = '/b'; await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { mocks.defaults.baseURL = '/a'; await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { finish(detail); await new Promise(r => setTimeout(r, 5)) })
    await act(async () => mocks.onScan!('I31'))
    await act(async () => { mocks.onScan!('LOC6'); await Promise.resolve() })
    expect(mocks.scan).not.toHaveBeenCalled()
    await act(async () => mocks.onScan!('I30'))
    await act(async () => { mocks.onScan!('LOC6'); await new Promise(r => setTimeout(r, 5)) })
    expect(mocks.scan).toHaveBeenCalledTimes(1)
    expect(mocks.scan.mock.calls[0][1]).toEqual({ taskId: 80, containerId: 30, barcode: 'I30', locationId: 6 })
    expect(mocks.scan.mock.calls[0][2]).toEqual(expect.objectContaining({ baseURL: '/a' }))
  })
})
test('owned detail query caches same task separately by original server while default hook keeps old key and API default', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ownerA = captureKitReadOwner(), ownerB = { ...ownerA, baseURL: '/b' }
  function Probe({ owner }: { owner?: typeof ownerA }) {
    const query = usePdaCancelReturnDetail(80, owner)
    return <span>{query.data?.taskNo ?? 'waiting'}</span>
  }
  async function render(owner?: typeof ownerA) {
    await act(async () => { root.render(<QueryClientProvider client={cache}><Probe owner={owner} /></QueryClientProvider>); await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  }
  try {
    await render(ownerA)
    expect(host.textContent).toBe('WT80')
    mocks.defaults.baseURL = '/b'
    mocks.detailGet.mockResolvedValue({ ...detail, taskNo: 'B-WT80' })
    await render(ownerB)
    expect(host.textContent).toBe('B-WT80')
    expect(mocks.detailGet.mock.calls[1][1]).toEqual(expect.objectContaining({ baseURL: '/b' }))
    mocks.defaults.baseURL = '/a'
    mocks.detailGet.mockResolvedValue(detail)
    await render()
    expect(mocks.detailGet.mock.calls[2]).toEqual(['/warehouse-tasks/80/cancel-return-detail'])
    expect(cache.getQueryData(['pda-cancel-return-detail', 80])).toEqual(detail)
  } finally { act(() => root.unmount()); cache.clear() }
})
test('detail403 retains legacy missing-identity manual block without adopting a receipt or enabling scanner', async () => {
  localStorage.setItem('pda_pending_request_confirmations', JSON.stringify({
    version: 2, userId: 5,
    records: [{ action: 'warehouse.cancel-return.80', requestKey: 'legacy-key', label: 'legacy', createdAt: '2026-10-01' }]
  }))
  mocks.detailGet.mockRejectedValue({ status: 403 })
  try {
    await mount(async host => {
      expect(host.textContent).toContain('历史归还记录缺少原服务器与会话身份')
      expect(host.textContent).toContain('legacy-key')
      expect(host.textContent).not.toContain('查询原归还回执')
      expect(host.textContent).not.toContain('scanner')
      expect(mocks.scan).not.toHaveBeenCalled()
      expect(mocks.query).not.toHaveBeenCalled()
    })
  } finally { localStorage.removeItem('pda_pending_request_confirmations') }
})
