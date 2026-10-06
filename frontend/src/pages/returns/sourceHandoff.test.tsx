// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import SaleReturnFormPage from './sale/form'
import PurchaseReturnFormPage from './purchase/form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore, HOME_TAB, MAX_WORKSPACE_TABS } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
const mocks = vi.hoisted(() => ({ sale: vi.fn(), purchase: vi.fn(), detail: vi.fn(), create: vi.fn(), query: vi.fn(), warning: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({ ...await importOriginal<typeof import('@/api/client')>() }))
const originalAdapter = apiClient.defaults.adapter, originalBaseURL = apiClient.defaults.baseURL
const unknownRequests: string[] = []
vi.mock('@/api/returns', () => ({ getSaleReturnSourceOrderApi: mocks.sale, getPurchaseReturnSourceOrderApi: mocks.purchase, getSaleReturnDetailApi: mocks.detail, getPurchaseReturnDetailApi: mocks.detail, createSaleReturnApi: mocks.create, createPurchaseReturnApi: mocks.create }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: mocks.query }))
vi.mock('@/components/finder', () => ({ CustomerFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (v: unknown) => void }) => open ? <button onClick={() => onConfirm({ id: 2, name: '手工客户', code: 'M' })}>选手工客户</button> : null, SupplierFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (v: unknown) => void }) => open ? <button onClick={() => onConfirm({ id: 2, name: '手工供应商', code: 'M' })}>选手工供应商</button> : null, ProductFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (v: unknown) => void }) => open ? <button onClick={() => onConfirm({ id: 2, name: '手工商品', code: 'M', unit: '件', salePrice: 4, costPrice: 4 })}>选手工商品</button> : null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: ({ onChange, disabled }: { onChange: (id: number, name: string) => void; disabled: boolean }) => <button disabled={disabled} onClick={() => onChange(2, '手工仓')}>选手工仓</button> }))
vi.mock('@/api/products', () => ({ getProductApi: () => Promise.resolve({ units: [] }) }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: mocks.warning, error: vi.fn() } }))
vi.mock('@/router/routeRegistry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/router/routeRegistry')>()
  return { ...actual, resolveRouteComponent: (path: string) => path.startsWith('/returns/sale/') ? SaleReturnFormPage : path.startsWith('/returns/purchase/') ? PurchaseReturnFormPage : null }
})
const line = { sourceItemId: 30, productId: 1, productCode: 'OLD', productName: '停用历史商品', unit: '个', quantity: 10, returnedQty: 2, remainingQty: 8, unitPrice: 8.1234, amount: 81.234 }
const source = { id: 80, orderNo: 'O80', customerId: 1, customerName: '原客户', supplierId: 1, supplierName: '原供应商', warehouseId: 1, warehouseName: '仓一', items: [line] }
const pathFor = (kind: string) => `/returns/${kind}/new?sourceId=80&sourceNo=O80`
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  unknownRequests.length = 0
  apiClient.defaults.adapter = async config => {
    unknownRequests.push(`${config.method} ${config.url}`)
    throw Error(`Unexpected source-handoff adapter request: ${config.method} ${config.url}`)
  }
  sessionStorage.clear(); localStorage.clear(); vi.resetAllMocks(); setApiClientBaseURL('/a')
  useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); useDirtyGuardStore.setState({ dirtyTabs: {} })
  mocks.sale.mockResolvedValue(source); mocks.purchase.mockResolvedValue(source); mocks.detail.mockResolvedValue(null)
})
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  setApiClientBaseURL(originalBaseURL)
  expect(unknownRequests).toEqual([])
})
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
async function change(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
  expect(button, label).toBeTruthy(); await act(async () => button!.click()); await flush()
}
async function page(kind: string, path: string, run: (host: HTMLElement, rerender: (path: string) => Promise<void>) => Promise<void>, direct = false) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Component = kind === 'sale' ? SaleReturnFormPage : PurchaseReturnFormPage
  async function rerender(next: string) {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[next]}><TabPathContext.Provider value={direct ? '' : next}><Component /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>)); await flush()
  }
  try { await rerender(path); await run(host, rerender) }
  finally { act(() => root.unmount()); host.remove(); cache.clear() }
}
test.each(['sale', 'purchase'])('%s source query opens a new form and gets authoritative historical price/remaining quantity with owned config', async kind => {
  await page(kind, pathFor(kind) + '&unitPrice=999&quantity=999', async host => {
    expect(host.textContent).toContain(kind === 'sale' ? '新建销售退货单' : '新建采购退货单')
    expect(host.textContent).toContain('停用历史商品')
    expect((host.querySelector('input[placeholder="数量"]') as HTMLInputElement).value).toBe('8')
    expect((host.querySelector('input[placeholder="单价"]') as HTMLInputElement).value).toBe('8.1234')
    expect(mocks[kind as 'sale'].mock.calls[0]).toEqual(['O80', expect.objectContaining({ baseURL: '/a', _authSessionGeneration: useAuthStore.getState().sessionGeneration })])
    expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled()
  })
})
test.each(['sale', 'purchase'])('%s direct route fallback reads source query', async kind => {
  await page(kind, pathFor(kind), async host => { expect(host.textContent).toContain('停用历史商品'); expect(mocks[kind as 'sale']).toHaveBeenCalledTimes(1) }, true)
})
test.each(['sale', 'purchase'])('%s strict carried identity rejects malformed and duplicated query without source call', async kind => {
  for (const search of ['?sourceId=80', '?sourceNo=O80', '?sourceId=0&sourceNo=O80', '?sourceId=1e2&sourceNo=O80', '?sourceId=9007199254740992&sourceNo=O80', '?sourceId=&sourceNo=O80', '?sourceId=80&sourceNo=', '?sourceId=80&sourceId=&sourceNo=O80', '?sourceId=80&sourceNo=O80&sourceNo=', '?sourceId=80&sourceNo=O80&sourceType=other']) {
    mocks[kind as 'sale'].mockClear()
    const normalized = buildWorkspaceTabRegistrationFromPath(`/returns/${kind}/new${search}`)
    await page(kind, normalized.path, async host => { expect(host.textContent).toContain('原单交接参数无效'); expect(mocks[kind as 'sale']).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled() })
    expect(normalized.key).not.toBe(`/returns/${kind}/new`)
  }
})
test.each(['sale', 'purchase'])('%s source API id/no mismatches and failures never bind or erase source input', async kind => {
  for (const response of [{ ...source, id: 81 }, { ...source, orderNo: 'O81' }, null]) {
    mocks[kind as 'sale'].mockResolvedValueOnce(response)
    await page(kind, pathFor(kind), async host => {
      expect(host.textContent).toContain('来源身份不符'); expect(host.textContent).not.toContain('停用历史商品')
      expect((host.querySelector('input[placeholder="输入原单号"]') as HTMLInputElement).value).toBe('O80')
    })
  }
  mocks[kind as 'sale'].mockRejectedValueOnce(new Error('来源失败夹具'))
  await page(kind, pathFor(kind), async host => { expect(host.textContent).toContain('来源失败夹具'); expect((host.querySelector('input[placeholder="输入原单号"]') as HTMLInputElement).value).toBe('O80') })
})
test.each(['sale', 'purchase'])('%s zero remaining comes from source API and cannot create', async kind => {
  mocks[kind as 'sale'].mockResolvedValueOnce({ ...source, items: [{ ...line, remainingQty: 0 }] })
  await page(kind, pathFor(kind), async host => { expect(mocks.warning).toHaveBeenCalledWith('该原单已无剩余可退数量'); expect(host.querySelector('input[placeholder="数量"]')).toBeNull(); await click(host, '创建退货单'); expect(mocks.create).not.toHaveBeenCalled() })
})
test.each(['sale', 'purchase'])('%s auto read cannot overwrite a remark edited while source is pending', async kind => {
  let finish!: (value: unknown) => void
  mocks[kind as 'sale'].mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await page(kind, pathFor(kind), async host => {
    await change(host.querySelector('input[placeholder="选填"]')!, '我的草稿')
    await act(async () => finish(source)); await flush()
    expect(host.textContent).not.toContain('停用历史商品'); expect((host.querySelector('input[placeholder="选填"]') as HTMLInputElement).value).toBe('我的草稿')
    expect(host.textContent).toContain('草稿已修改')
    await click(host, '载入'); expect(host.textContent).toContain('停用历史商品')
  })
})
test.each(['sale', 'purchase'])('%s late source response after clear, order switch, owner/server change or unmount is isolated', async kind => {
  for (const scenario of ['clear', 'switch', 'account', 'server', 'unmount']) {
    let finish!: (value: unknown) => void
    setApiClientBaseURL('/a')
    useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
    mocks[kind as 'sale'].mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await page(kind, pathFor(kind), async host => {
      if (scenario === 'unmount') return
      if (scenario === 'clear') await click(host, '清除')
      if (scenario === 'switch') {
        await click(host, '清除')
        await change(host.querySelector('input[placeholder="输入原单号"]')!, 'O81')
        mocks[kind as 'sale'].mockResolvedValueOnce({ ...source, id: 81, orderNo: 'O81', items: [{ ...line, productName: '另一原商品' }] })
        await click(host, '载入')
      }
      if (scenario === 'account') useAuthStore.setState({ sessionGeneration: useAuthStore.getState().sessionGeneration + 1 })
      if (scenario === 'server') setApiClientBaseURL('/b')
      await act(async () => finish(source)); await flush()
      expect(host.textContent).not.toContain('停用历史商品')
      if (scenario === 'switch') expect(host.textContent).toContain('另一原商品')
      if (scenario === 'clear') { expect((host.querySelector('input[placeholder="输入原单号"]') as HTMLInputElement).value).toBe(''); await flush(); expect(mocks[kind as 'sale'].mock.calls.filter(c => c[0] === 'O80')).toHaveLength(1) }
    })
    if (scenario === 'unmount') { await act(async () => finish(source)); await flush() }
  }
})
test.each(['sale', 'purchase'])('%s same source canonical key keeps dirty state and close removes only its original draft', async kind => {
  const registered = buildWorkspaceTabRegistrationFromPath(pathFor(kind) + '&unused=yes')
  useWorkspaceStore.getState().addTab({ ...registered, title: '原单退货' })
  await page(kind, registered.path, async host => {
    expect(useDirtyGuardStore.getState().dirtyTabs[registered.key]).toBe(true)
    mocks.create.mockResolvedValueOnce({ id: 90, returnNo: 'R90' })
    await click(host, '创建退货单')
    expect(useWorkspaceStore.getState().tabs.find(t => t.key === registered.key)).toBeUndefined()
  })
})
test.each(['sale', 'purchase'])('%s real keep-alive keeps two origins and unsourced drafts through A B A and repeat entry', async kind => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), cache = new QueryClient()
  let navigate!: NavigateFunction
  function Harness() { navigate = useNavigate(); return <KeepAliveOutlet /> }
  const a = pathFor(kind), b = `/returns/${kind}/new?sourceNo=O81&sourceId=81`, manual = `/returns/${kind}/new`
  mocks[kind as 'sale'].mockImplementation((no: string) => Promise.resolve({ ...source, id: no === 'O81' ? 81 : 80, orderNo: no }))
  const active = () => [...host.querySelectorAll<HTMLElement>('[data-workspace-scroll]')].find(e => e.style.display === 'block')!
  async function open(path: string) { await act(async () => { useWorkspaceStore.getState().addTab({ key: path, path, title: '退货' }); navigate(path) }); await flush() }
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/dashboard']}><Harness /></MemoryRouter></QueryClientProvider>)); await flush()
    await open(a); const inputA = active().querySelector<HTMLInputElement>('input[placeholder="选填"]')!; await change(inputA, 'A草稿')
    await open(b); const inputB = active().querySelector<HTMLInputElement>('input[placeholder="选填"]')!; await change(inputB, 'B草稿')
    await open(manual); await change(active().querySelector('input[placeholder="选填"]')!, '手工草稿')
    await open(a + '&irrelevant=repeat'); expect(active().querySelector('input[placeholder="选填"]')).toBe(inputA); expect(inputA.value).toBe('A草稿')
    await open(b); expect(active().querySelector('input[placeholder="选填"]')).toBe(inputB); expect(inputB.value).toBe('B草稿')
    await open(manual); expect((active().querySelector('input[placeholder="选填"]') as HTMLInputElement).value).toBe('手工草稿')
    expect(mocks[kind as 'sale']).toHaveBeenCalledTimes(2); expect(useWorkspaceStore.getState().tabs).toHaveLength(4)
  } finally { act(() => root.unmount()); cache.clear(); host.remove(); disposeWorkspaceHistoryGuard() }
})

const kitSource = { ...source, commercialModel: 'kit-v1', commercialRevision: 4, items: [{ ...line, dispatchComponentId: 40, commercialComponentId: 50, sourceQuantity: 10, sourceBudgetAmount: 81.234, kind: 'kit', kitCode: 'KA', kitName: '原套', groupId: 60, lineKey: 'A', taskId: 70, taskNo: 'WT70', confirmedAt: '2026-10-01', warehouseId: 1, warehouseName: '仓一' }] }
test('kit auto source reads actual dispatch but never selects components; same key query updates keep selection and pending identity', async () => {
  mocks.sale.mockResolvedValue(kitSource); mocks.create.mockRejectedValue({ status: 408 })
  await page('sale', pathFor('sale'), async (host, rerender) => {
    expect(host.querySelectorAll('input[aria-label="退货数量"]')).toHaveLength(0)
    await click(host, '选择 WT70 · 原套 · 停用历史商品')
    const input = host.querySelector<HTMLInputElement>('input[aria-label="退货数量"]')!
    await change(input, '2'); await rerender(pathFor('sale') + '&unrelated=yes')
    expect(host.querySelector('input[aria-label="退货数量"]')).toBe(input); expect(input.value).toBe('2')
    await click(host, '创建退货单')
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ saleOrderId: 80, saleOrderNo: 'O80', commercialModel: 'kit-v1', expectedRevision: 4, items: [{ quantity: 2, unitPrice: 8.1234, dispatchComponentId: 40 }] })
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toContain(`source-return:${pathFor('sale')}`)
    await rerender(pathFor('sale') + '&unrelated=again')
    expect(host.querySelector('input[aria-label="退货数量"]')).toBe(input); expect(host.textContent).toContain('原创建结果待确认')
  })
  const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
  mocks.sale.mockClear(); mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_return', resourceId: 90, data: { id: 90, returnNo: 'SR90' } })
  const registration = buildWorkspaceTabRegistrationFromPath(pathFor('sale')); useWorkspaceStore.getState().addTab({ ...registration, title: '草稿' })
  await page('sale', pathFor('sale') + '&unrelated=reload', async host => {
    expect(mocks.sale).not.toHaveBeenCalled(); expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
    expect(host.textContent).toContain('原创建结果待确认'); expect([...host.querySelectorAll('button')].find(b => b.textContent === '创建退货单')!.disabled).toBe(true)
    await click(host, '查询原创建结果')
    expect(useWorkspaceStore.getState().tabs.some(t => t.key === registration.key)).toBe(true); expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.sale).not.toHaveBeenCalled(); expect(host.textContent).toContain('新建销售退货单')
  })
})
test.each(['sale', 'purchase'])('%s pending automatic source cannot overwrite added manual product and quantity', async kind => {
  let finish!: (value: unknown) => void; mocks[kind as 'sale'].mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await page(kind, pathFor(kind), async host => {
    await click(host, '+ 添加商品'); await click(host, '选手工商品')
    await change(host.querySelector('input[placeholder="数量"]')!, '3')
    await act(async () => finish(source)); await flush()
    expect(host.textContent).toContain('手工商品'); expect(host.textContent).not.toContain('停用历史商品')
    expect((host.querySelector('input[placeholder="数量"]') as HTMLInputElement).value).toBe('3'); expect(host.textContent).toContain('草稿已修改')
  })
})
test.each(['sale', 'purchase'])('%s old create completion after account/server change or unmount never closes source draft', async kind => {
  for (const scenario of ['account', 'server', 'unmount']) {
    setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
    let finish!: (value: unknown) => void; mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const registration = buildWorkspaceTabRegistrationFromPath(pathFor(kind)); useWorkspaceStore.getState().addTab({ ...registration, title: '草稿' })
    await page(kind, pathFor(kind), async host => {
      await click(host, '创建退货单')
      if (scenario === 'unmount') return
      if (scenario === 'account') useAuthStore.setState({ sessionGeneration: useAuthStore.getState().sessionGeneration + 1 })
      else setApiClientBaseURL('/b')
      await act(async () => finish({ id: 90, returnNo: 'R90' })); await flush()
      expect(useWorkspaceStore.getState().tabs.some(t => t.key === registration.key)).toBe(true)
      expect(useWorkspaceStore.getState().tabs.some(t => t.path === `/returns/${kind}/90`)).toBe(false)
    })
    if (scenario === 'unmount') { await act(async () => finish({ id: 90, returnNo: 'R90' })); await flush(); expect(useWorkspaceStore.getState().tabs.some(t => t.key === registration.key)).toBe(true) }
  }
})

test.each(['sale', 'purchase'])('%s matching redundant sourceType reuses the same source draft, while wrong/duplicate types stay rejectable', kind => {
  const plain = buildWorkspaceTabRegistrationFromPath(pathFor(kind))
  const redundant = buildWorkspaceTabRegistrationFromPath(pathFor(kind) + `&sourceType=${kind}`)
  expect(redundant).toEqual(plain)
  for (const type of [`&sourceType=${kind}&sourceType=`, '&sourceType=', '&sourceType=other']) {
    const invalid = buildWorkspaceTabRegistrationFromPath(pathFor(kind) + type)
    expect(invalid.key).not.toBe(plain.key)
    expect(new URLSearchParams(invalid.path.split('?')[1]).getAll('sourceType')).toEqual(new URLSearchParams(type).getAll('sourceType').sort())
  }
})
test('ordinary sales creation keeps source input frozen until original request finishes', async () => {
  let finish!: (value: unknown) => void; mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await page('sale', pathFor('sale'), async host => {
    await click(host, '创建退货单')
    expect(host.querySelector('input[placeholder="输入原单号"]')!.matches(':disabled')).toBe(true)
    await act(async () => finish({ id: 90, returnNo: 'R90' })); await flush()
  })
})
test.each(['sale', 'purchase'])('%s pending automatic source preserves a manually selected party', async kind => {
  let finish!: (value: unknown) => void; mocks[kind as 'sale'].mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await page(kind, pathFor(kind), async host => {
    await click(host, kind === 'sale' ? '点击选择客户…' : '点击选择供应商…')
    await click(host, kind === 'sale' ? '选手工客户' : '选手工供应商')
    await act(async () => finish(source)); await flush()
    expect(host.textContent).toContain(kind === 'sale' ? '手工客户' : '手工供应商'); expect(host.textContent).not.toContain('停用历史商品')
  })
})

test.each(['sale', 'purchase'])('%s carried source identity failure blocks manual inputs from silently submitting that source number', async kind => {
  mocks[kind as 'sale'].mockResolvedValueOnce({ ...source, id: 81 })
  await page(kind, pathFor(kind), async host => {
    await click(host, kind === 'sale' ? '点击选择客户…' : '点击选择供应商…'); await click(host, kind === 'sale' ? '选手工客户' : '选手工供应商')
    await click(host, '选手工仓'); await click(host, '+ 添加商品'); await click(host, '选手工商品')
    await click(host, '创建退货单'); expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledWith('请先载入并核对原单，或清除来源后按手工退货填写')
  })
})

test.each(['sale', 'purchase'])('%s sourceType alone remains an invalid partial handoff distinct from manual draft', async kind => {
  const registration = buildWorkspaceTabRegistrationFromPath(`/returns/${kind}/new?sourceType=${kind}`)
  expect(registration.key).not.toBe(`/returns/${kind}/new`)
  await page(kind, registration.path, async host => { expect(host.textContent).toContain('原单交接参数无效'); expect(mocks[kind as 'sale']).not.toHaveBeenCalled() })
})

test.each(['sale', 'purchase'])('%s explicit source clear preserves the legacy manual flow without inventing original id/no', async kind => {
  await page(kind, pathFor(kind), async host => {
    await click(host, '清除'); expect(host.textContent).toContain('旧系统退货')
    await click(host, kind === 'sale' ? '点击选择客户…' : '点击选择供应商…'); await click(host, kind === 'sale' ? '选手工客户' : '选手工供应商')
    await click(host, '选手工仓'); await click(host, '+ 添加商品'); await click(host, '选手工商品')
    mocks.create.mockRejectedValueOnce({ status: 400 }); await click(host, '创建退货单')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0][`${kind}OrderId`]).toBeUndefined(); expect(mocks.create.mock.calls[0][0][`${kind}OrderNo`]).toBeUndefined()
    expect(mocks[kind as 'sale']).toHaveBeenCalledTimes(1)
  })
})

test.each(['sale', 'purchase'])('%s carried identity remains mandatory after whitespace or another source number is typed', async kind => {
  for (const nextNo of ['O80 ', 'O81']) {
    mocks[kind as 'sale'].mockResolvedValueOnce({ ...source, id: 81 })
    await page(kind, pathFor(kind), async host => {
      expect(host.textContent).toContain('来源身份不符')
      await click(host, kind === 'sale' ? '点击选择客户…' : '点击选择供应商…'); await click(host, kind === 'sale' ? '选手工客户' : '选手工供应商')
      await click(host, '选手工仓'); await click(host, '+ 添加商品'); await click(host, '选手工商品')
      await change(host.querySelector('input[placeholder="输入原单号"]')!, nextNo)
      mocks.create.mockRejectedValueOnce({ status: 400 }); await click(host, '创建退货单')
      expect(mocks.create).not.toHaveBeenCalled()
      mocks[kind as 'sale'].mockResolvedValueOnce({ ...source, id: 81, orderNo: nextNo.trim() })
      await click(host, '载入'); expect(host.textContent).toContain('来源身份不符')
      await click(host, '创建退货单'); expect(mocks.create).not.toHaveBeenCalled()
    })
  }
})
test.each([['sale', false, 'response'], ['purchase', false, 'response'], ['sale', true, 'response'], ['sale', false, 'invalidation'], ['purchase', false, 'invalidation'], ['sale', true, 'invalidation']] as const)('%s kit=%s background A creation at %s retains B and records A success without repeat submission', async (kind, kit, timing) => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let navigate!: NavigateFunction, finish!: (value: unknown) => void, finishRefresh!: () => void
  if (timing === 'invalidation') vi.spyOn(cache, 'invalidateQueries').mockImplementationOnce(() => new Promise<void>(resolve => { finishRefresh = resolve }))
  function Harness() { navigate = useNavigate(); return <KeepAliveOutlet /> }
  const a = pathFor(kind), b = `/returns/${kind}/new?sourceId=81&sourceNo=O81`
  mocks[kind].mockImplementation((no: string) => Promise.resolve({ ...(kit ? kitSource : source), id: no === 'O81' ? 81 : 80, orderNo: no }))
  mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const active = () => [...host.querySelectorAll<HTMLElement>('[data-workspace-scroll]')].find(e => e.style.display === 'block')!
  async function open(path: string) { await act(async () => { useWorkspaceStore.getState().addTab({ key: path, path, title: '退货' }); navigate(path) }); await flush() }
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/dashboard']}><Harness /></MemoryRouter></QueryClientProvider>)); await flush()
    await open(a); if (kit) await click(active(), '选择 WT70 · 原套 · 停用历史商品')
    await click(active(), '创建退货单'); const originalKey = mocks.create.mock.calls[0][1]
    if (timing === 'invalidation') { await act(async () => finish({ id: 90, returnNo: 'R90' })); await flush(); expect(finishRefresh).toBeTypeOf('function') }
    await open(b); const inputB = active().querySelector<HTMLInputElement>('input[placeholder="选填"]')!; await change(inputB, 'B当前草稿')
    await act(async () => timing === 'invalidation' ? finishRefresh() : finish({ id: 90, returnNo: 'R90' })); await flush()
    expect(useWorkspaceStore.getState().activeKey).toBe(buildWorkspaceTabRegistrationFromPath(b).key)
    expect(active().querySelector('input[placeholder="选填"]')).toBe(inputB); expect(inputB.value).toBe('B当前草稿')
    expect(useWorkspaceStore.getState().tabs.some(t => t.path === `/returns/${kind}/90`)).toBe(false)
    await open(a); expect(active().textContent).toContain('R90')
    const clear = [...active().querySelectorAll('button')].find(button => button.textContent === '清除')!
    expect(clear.matches(':disabled')).toBe(true); await act(async () => clear.click())
    expect((active().querySelector('input[placeholder="输入原单号"]') as HTMLInputElement).value).toBe('O80')
    const create = [...active().querySelectorAll('button')].find(button => button.textContent === '创建退货单')!
    expect(create.disabled).toBe(true); await act(async () => create.click()); expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][1]).toBe(originalKey)
    expect(useDirtyGuardStore.getState().dirtyTabs[buildWorkspaceTabRegistrationFromPath(a).key]).not.toBe(true)
    await click(active(), '查看已创建退货单'); expect(useWorkspaceStore.getState().activeKey).toBe(`/returns/${kind}/90`)
  } finally { act(() => root.unmount()); cache.clear(); host.remove(); disposeWorkspaceHistoryGuard() }
})

test.each([['sale', false], ['purchase', false], ['sale', true]] as const)('%s kit=%s successful A replaces its own full-workspace slot without evicting older dirty B', async (kind, kit) => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let navigate!: NavigateFunction, finish!: (value: unknown) => void
  function Harness() { navigate = useNavigate(); return <KeepAliveOutlet /> }
  const a = pathFor(kind), b = `/returns/${kind}/new?sourceId=81&sourceNo=O81`
  mocks[kind].mockImplementation((no: string) => Promise.resolve({ ...(kit ? kitSource : source), id: no === 'O81' ? 81 : 80, orderNo: no }))
  mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const active = () => [...host.querySelectorAll<HTMLElement>('[data-workspace-scroll]')].find(e => e.style.display === 'block')!
  async function open(path: string) { await act(async () => { useWorkspaceStore.getState().addTab({ key: path, path, title: '退货' }); navigate(path) }); await flush() }
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/dashboard']}><Harness /></MemoryRouter></QueryClientProvider>)); await flush()
    await open(b); const inputB = active().querySelector<HTMLInputElement>('input[placeholder="选填"]')!; await change(inputB, '最旧但未保存的B')
    await open(a); if (kit) await click(active(), '选择 WT70 · 原套 · 停用历史商品')
    await act(async () => {
      for (let i = useWorkspaceStore.getState().tabs.length; i < MAX_WORKSPACE_TABS; i++) useWorkspaceStore.getState().addTab({ key: `/sale/${100 + i}`, path: `/sale/${100 + i}`, title: '保留页面' })
      useWorkspaceStore.getState().setActive(buildWorkspaceTabRegistrationFromPath(a).key)
    }); await flush()
    expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
    await click(active(), '创建退货单'); await act(async () => finish({ id: 90, returnNo: 'R90' })); await flush()
    expect(useWorkspaceStore.getState().tabs.some(t => t.key === buildWorkspaceTabRegistrationFromPath(b).key)).toBe(true)
    expect(useWorkspaceStore.getState().activeKey).toBe(`/returns/${kind}/90`); expect(useWorkspaceStore.getState().tabs).toHaveLength(MAX_WORKSPACE_TABS)
    expect(useWorkspaceStore.getState().tabs.some(t => t.key === buildWorkspaceTabRegistrationFromPath(a).key)).toBe(false)
    await open(b); expect(active().querySelector('input[placeholder="选填"]')).toBe(inputB); expect(inputB.value).toBe('最旧但未保存的B')
    expect(useDirtyGuardStore.getState().dirtyTabs[buildWorkspaceTabRegistrationFromPath(b).key]).toBe(true)
  } finally { act(() => root.unmount()); cache.clear(); host.remove(); disposeWorkspaceHistoryGuard() }
})
