// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import SaleFormPage from './form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import type { AxiosRequestConfig } from 'axios'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { ReorderSourceButton } from './ReorderSourceButton'
const records: AxiosRequestConfig[] = []
const source = { id: 80, orderNo: 'S80', model: 'ordinary', customerId: 4, items: [{ kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 12 }, { kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 3 }] }
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/finder', () => ({ CustomerFinder: (p: { open: boolean; onConfirm: (value: { id: number; name: string; code: string }) => void }) => p.open ? <button onClick={() => p.onConfirm({ id: 4, name: '当前客户', code: 'C4' })}>重选当前客户</button> : null, ProductFinder: () => null }))
vi.mock('@/pages/sale/form/components/SaleOrderHeaderFields', () => ({ SaleOrderHeaderFields: (p: { customerName: string; warehouseId: string; remark: string; receiverAddress: string; setRemark: (v: string) => void; setWarehouseId: (v: string) => void; setWarehouseName: (v: string) => void; setCustomerFinderOpen: (v: boolean) => void }) => <div><span>客户:{p.customerName}</span><button onClick={() => p.setCustomerFinderOpen(true)}>选择客户</button><span>仓库:{p.warehouseId}</span><span>收货:{p.receiverAddress}</span><input aria-label="备注" value={p.remark} onChange={e => p.setRemark(e.target.value)} /><button onClick={() => { p.setWarehouseId('8'); p.setWarehouseName('当前仓') }}>选择当前仓</button></div> }))
vi.mock('@/pages/sale/form/components/SaleOrderItemsTable', () => ({ SaleOrderItemsTable: (p: { items: { _key: number; productName: string; unit: string; quantity: number; unitPrice: number }[]; updateItem: (k: number, f: string, v: number) => void }) => <div>{p.items.map(i => <div key={i._key}><span>{i.productName}:{i.unit}:{i.unitPrice}</span><input aria-label="数量" value={i.quantity} onChange={e => p.updateItem(i._key, 'quantity', +e.target.value)} /></div>)}</div> }))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); localStorage.clear(); records.length = 0
  setApiClientBaseURL('/a')
  useAuthStore.getState().login('fixture', null, { id: 9, roleId: 1, permissions: ['*'] } as never)
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  apiClient.defaults.adapter = async config => {
    records.push(config)
    let data: unknown
    if (config.url === '/sale/80/reorder-source') data = source
    else if (config.url === '/customers/4') data = { id: 4, code: 'C4', name: '当前客户', isActive: true }
    else if (config.url === '/products/3') data = { id: 3, code: 'P3', name: '当前商品', unit: '个', units: [{ unitName: '箱', conversionRate: 6, isBase: false }], isActive: true, allowDecimalQty: false }
    else if (config.url === '/price-lists/customer-price') data = { salePrice: 7.1234, priceLevel: 'B', source: 'price_level', priceLevelName: 'B价' }
    else if (config.url === '/carriers/active') data = []
    else throw new Error(`禁止真实网络，未stub ${config.url}`)
    return { data: { success: true, data }, status: 200, statusText: 'OK', config, headers: {} }
  }
})
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
function CurrentRoute() { const l = useLocation(); return <output data-route>{l.pathname + l.search}</output> }
async function page(path: string, run: (host: HTMLElement, show: (active: boolean) => Promise<void>) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const show = async (active: boolean) => { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={cache}><CurrentRoute /><KeepAliveSection active={active}><TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider></KeepAliveSection></QueryClientProvider></MemoryRouter>)) }
  await show(true)
  try { await flush(); await run(host, show) } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}
async function click(host: HTMLElement, label: string) {
  const b = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
  expect(b, label).toBeTruthy(); await act(async () => b!.click()); await flush()
}
test('新建query先识别pathname；当前身份导入默认0量/基本单位/当前客户报价，旧头为空', async () => {
  await page('/sale/new?sourceId=80', async host => {
    expect(host.textContent).not.toContain('销售单路由无效')
    await click(host, '载入当前客户和商品')
    expect(host.textContent).toContain('客户:当前客户'); expect(host.textContent).toContain('当前商品:个:7.1234')
    expect([...host.querySelectorAll<HTMLInputElement>('input[aria-label="数量"]')].map(i => i.value)).toEqual(['0'])
    expect(host.textContent).toContain('同一商品'); expect(host.textContent).toContain('仓库:'); expect(host.textContent).toContain('收货:')
    expect(records.filter(r => r.url === '/products/3')).toHaveLength(1)
    expect(records.filter(r => r.url?.includes('reorder-source') || r.url === '/customers/4' || r.url === '/products/3' || r.url?.includes('customer-price')).every(r => r.baseURL === '/a' && r._erpApiFallbackTried === true)).toBe(true)
  })
})
test('显式带基本量只将同商品旧仓量合为15；不把原2箱当2套或沿旧仓', async () => {
  await page('/sale/new?sourceId=80', async host => {
    const option = host.querySelector<HTMLInputElement>('input[type="checkbox"]'); expect(option).toBeTruthy()
    await act(async () => option!.click()); await click(host, '载入当前客户和商品')
    expect(host.querySelector<HTMLInputElement>('input[aria-label="数量"]')?.value).toBe('15')
  })
})
test('空/重复来源参数保持raw并拒绝，不加载合法来源或降级空白新建', async () => {
  for (const query of ['sourceId=', 'sourceId=&sourceId=80', 'sourceId=80&sourceId=80', 'sourceId=1e2']) {
    const path = buildWorkspaceTabRegistrationFromPath(`/sale/new?${query}`).path
    expect(path).toContain(query.includes('sourceId=&') ? 'sourceId=' : 'sourceId')
    await page(path, async host => { expect(host.textContent).toContain('来源参数无效'); expect(host.querySelector('input[aria-label="备注"]')).toBeNull() })
  }
  expect(records.some(r => r.url?.includes('reorder-source'))).toBe(false)
})
test('空白/不同来源/两种模型草稿有独立工作区身份', () => {
  const keys = ['/sale/new', '/sale/new?sourceId=80', '/sale/new?sourceId=81', '/sale/new-kit?sourceId=80'].map(p => buildWorkspaceTabRegistrationFromPath(p).key)
  expect(new Set(keys).size).toBe(4)
})
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
test('载入前员工已录备注，迟到资料与显式导入都不能覆盖输入', async () => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  let complete: (() => void) | undefined
  apiClient.defaults.adapter = config => config.url === '/price-lists/customer-price' ? new Promise(resolve => { records.push(config); complete = () => resolve({ data: { success: true, data: { salePrice: 7.1234, priceLevel: 'B', source: 'price_level', priceLevelName: 'B价' } }, status: 200, statusText: 'OK', config, headers: {} }) }) : adapter(config)
  await page('/sale/new?sourceId=80', async host => {
    const remark = host.querySelector<HTMLInputElement>('input[aria-label="备注"]')!
    await input(remark, '我已输入'); expect(complete).toBeTruthy()
    await act(async () => complete!()); await flush(); await click(host, '载入当前客户和商品')
    expect(remark.value).toBe('我已输入'); expect(host.querySelector('input[aria-label="数量"]')).toBeNull()
  })
})
test('实际商业新建采用准确父套当前版本；默认0套，旧版本/商业revision/旧lineKey不进预览', async () => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  apiClient.defaults.adapter = async config => {
    if (config.url !== '/sale/80/reorder-source' && config.url !== '/kits/7' && config.url !== '/kits/preview') return adapter(config)
    records.push(config)
    let data: unknown
    if (config.url.includes('reorder-source')) data = { ...source, model: 'kit-v1', items: [{ kind: 'kit', kitId: 7, originalKitVersionId: 41, quantity: 2 }] }
    else if (config.url === '/kits/7') data = { id: 7, code: 'K7', name: '当前套', isActive: true, deletedAt: null, currentVersionId: 42, revision: 9, version: { id: 42, kitId: 7, versionNo: 2, referenceUnitPrice: 123.4567, components: [{ productId: 3, productActive: true }] } }
    else data = { amount: 246.9134, commercialGroups: [], physicalItems: [], inventoryExplanation: '当前现货', readyDateExplanation: '未分配', canFulfillEntireVector: true }
    return { data: { success: true, data }, status: 200, statusText: 'OK', config, headers: {} }
  }
  await page('/sale/new-kit?sourceId=80', async host => {
    expect(host.textContent).toContain('套组成已更新')
    await click(host, '载入当前客户和商品')
    const qty = host.querySelector<HTMLInputElement>('input[aria-label="当前套数量"]')!
    expect(qty?.value).toBe('0'); expect(records.some(r => r.url === '/kits/preview')).toBe(false)
    await input(qty, '2'); await click(host, '选择当前仓')
    const r = records.find(r => r.url === '/kits/preview')!, body = JSON.parse(r.data)
    expect(body.groups[0].kitVersionId).toBe(42); expect(body.groups[0].lineKey).toBeTruthy()
    expect(body.groups[0].quantity).toBe(2); expect(body.expectedRevision).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('originalKitVersionId')
    expect(JSON.stringify(body)).not.toContain('receiver')
  })
})
test('真实KeepAlive新单隐藏期间晚到保存成功不关闭该草稿或导航其它页面', async () => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  let complete: (() => void) | undefined
  apiClient.defaults.adapter = config => config.method === 'post' && config.url === '/sale' ? new Promise(resolve => { records.push(config); complete = () => resolve({ data: { success: true, data: { id: 81, orderNo: 'S81' } }, status: 201, statusText: 'OK', config, headers: {} }) }) : adapter(config)
  await page('/sale/new?sourceId=80', async (host, show) => {
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await click(host, '载入当前客户和商品'); await click(host, '选择当前仓'); await click(host, '保存草稿')
    expect(complete).toBeTruthy(); await show(false)
    await act(async () => { complete!(); await Promise.resolve() }); await flush()
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/new?sourceId=80')
    await show(true); expect(host.querySelector<HTMLInputElement>('input[aria-label="数量"]')?.value).toBe('15')
    expect(host.textContent).toContain('查看已创建销售单')
  })
})
test('按原单入口满30拒绝，不LRU丢草稿；同源只focus已有合法query', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  const existing = buildWorkspaceTabRegistrationFromPath('/sale/new?sourceId=80&keep=old')
  useWorkspaceStore.setState({ tabs: [HOME_TAB, { ...existing, title: '新建销售', closable: true }, ...Array.from({ length: 28 }, (_, i) => ({ key: `/sale/${i + 100}`, path: `/sale/${i + 100}`, title: `旧草稿${i}`, closable: true }))], activeKey: HOME_TAB.key })
  await act(async () => root.render(<MemoryRouter><CurrentRoute /><ReorderSourceButton sourceId={80} model="ordinary" /><ReorderSourceButton sourceId={81} model="ordinary" /></MemoryRouter>))
  try {
    await act(async () => host.querySelectorAll('button')[0].click()); expect(host.querySelector('[data-route]')?.textContent).toBe(existing.path)
    const before = useWorkspaceStore.getState().tabs
    await act(async () => host.querySelectorAll('button')[1].click()); expect(useWorkspaceStore.getState().tabs).toEqual(before)
    expect(useWorkspaceStore.getState().tabs).toHaveLength(30)
  } finally { await act(async () => root.unmount()) }
})
test('当前停用商品保留可见失败行，不静默跳过或导入旧价', async () => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  apiClient.defaults.adapter = async config => config.url === '/products/3' ? { data: { success: true, data: { id: 3, name: '旧商品', isActive: false } }, status: 200, statusText: 'OK', config, headers: {} } : adapter(config)
  await page('/sale/new?sourceId=80', async host => {
    expect(host.textContent).toContain('原行 1'); expect(host.textContent).toContain('已停用')
    const importButton = [...host.querySelectorAll('button')].find(b => b.textContent === '载入当前客户和商品')!
    expect(importButton.disabled).toBe(true); expect(host.querySelector('input[aria-label="数量"]')).toBeNull()
    expect(records.some(r => r.url === '/price-lists/customer-price')).toBe(false)
  })
})
test('来源慢响应在服务器A→B→A后拒绝；不读取后续主档或覆盖员工输入', async () => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  let complete: (() => void) | undefined
  apiClient.defaults.adapter = config => config.url === '/sale/80/reorder-source' ? new Promise(resolve => { records.push(config); complete = () => resolve({ data: { success: true, data: source }, status: 200, statusText: 'OK', config, headers: {} }) }) : adapter(config)
  await page('/sale/new?sourceId=80', async host => {
    await input(host.querySelector<HTMLInputElement>('input[aria-label="备注"]')!, '旧草稿保留')
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); complete!() }); await flush()
    expect(host.textContent).toContain('服务器已变化'); expect(host.querySelector<HTMLInputElement>('input[aria-label="备注"]')?.value).toBe('旧草稿保留')
    expect(records.some(r => r.url === '/customers/4')).toBe(false)
  })
})
test.each([
  ['/sale/80/reorder-source', '/customers/4'],
  ['/products/3', '/price-lists/customer-price'],
])('隐藏时迟到 %s 不继续 %s；重新显示只接新代次', async (pausedUrl, downstreamUrl) => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  let complete: (() => void) | undefined, delayed = false
  apiClient.defaults.adapter = config => {
    if (config.url !== pausedUrl || delayed) return adapter(config)
    delayed = true; records.push(config)
    return new Promise(resolve => { complete = async () => resolve(await adapter(config)) })
  }
  await page('/sale/new?sourceId=80', async (host, show) => {
    expect(complete).toBeTruthy()
    await input(host.querySelector<HTMLInputElement>('input[aria-label="备注"]')!, '隐藏保留输入')
    await show(false); await act(async () => complete!()); await flush()
    expect(records.some(r => r.url === downstreamUrl)).toBe(false)
    await show(true); await flush()
    expect(records.some(r => r.url === downstreamUrl)).toBe(true)
    expect(host.querySelector<HTMLInputElement>('input[aria-label="备注"]')?.value).toBe('隐藏保留输入')
    expect(host.textContent).toContain('来源：S80')
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
})
test('原详情入口读取归属改变后不从旧概要另开单，即便回到原服务器', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(<MemoryRouter initialEntries={['/sale/80']}><CurrentRoute /><ReorderSourceButton sourceId={80} model="ordinary" /></MemoryRouter>))
  try {
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') })
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/80')
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1)
  } finally { await act(async () => root.unmount()) }
})
test('实际三个KeepAlive草稿隔离来源与空白；同源返回保留输入，不重载其它未访问来源', async () => {
  const paths = ['/sale/new?sourceId=80', '/sale/new', '/sale/new?sourceId=81']
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('fixture需要显式adapter')
  apiClient.defaults.adapter = async config => {
    if (config.url !== '/sale/81/reorder-source') return adapter(config)
    records.push(config); return { data: { success: true, data: { ...source, id: 81, orderNo: 'S81' } }, status: 200, statusText: 'OK', config, headers: {} }
  }
  function Workspace() {
    const l = useLocation(), navigate = useNavigate()
    return <>{paths.map((p, n) => <button key={`go${p}`} onClick={() => navigate(p)}>草稿{n}</button>)}{paths.map((p, n) => <KeepAliveSection data-draft={n} active={l.pathname + l.search === p} key={p}><TabPathContext.Provider value={p}><SaleFormPage /></TabPathContext.Provider></KeepAliveSection>)}</>
  }
  const host = document.createElement('div'), root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<MemoryRouter initialEntries={[paths[0]]}><QueryClientProvider client={cache}><Workspace /></QueryClientProvider></MemoryRouter>)); await flush()
  try {
    const first = host.querySelector<HTMLElement>('[data-draft="0"]')!
    await click(first, '载入当前客户和商品'); await input(first.querySelector<HTMLInputElement>('input[aria-label="备注"]')!, '源80输入')
    expect(records.filter(r => r.url?.includes('reorder-source'))).toHaveLength(1)
    await click(host, '草稿1'); const blank = host.querySelector<HTMLElement>('[data-draft="1"]')!
    await input(blank.querySelector<HTMLInputElement>('input[aria-label="备注"]')!, '空白输入')
    await click(host, '草稿2'); const second = host.querySelector<HTMLElement>('[data-draft="2"]')!
    await click(second, '载入当前客户和商品'); await input(second.querySelector<HTMLInputElement>('input[aria-label="备注"]')!, '源81输入')
    await click(host, '草稿0')
    expect(first.querySelector<HTMLInputElement>('input[aria-label="备注"]')?.value).toBe('源80输入')
    expect(blank.querySelector<HTMLInputElement>('input[aria-label="备注"]')?.value).toBe('空白输入')
    expect(second.querySelector<HTMLInputElement>('input[aria-label="备注"]')?.value).toBe('源81输入')
    expect(first.querySelector('input[aria-label="数量"]')).not.toBeNull(); expect(blank.querySelector('input[aria-label="数量"]')).toBeNull()
    expect(records.filter(r => r.url?.includes('reorder-source'))).toHaveLength(2)
  } finally { await act(async () => root.unmount()); cache.clear() }
})


test('R9真实报价隐藏恢复后不能应用旧价，保持草稿并可主动重新报价', async () => {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('exact adapter required')
  const unknown: string[] = []
  let quotes = 0, resolveOld!: () => void
  apiClient.defaults.adapter = async c => {
    if (c.method !== 'get' || !['/sale/80/reorder-source', '/customers/4', '/products/3', '/price-lists/customer-price', '/carriers/active'].includes(c.url!)) {
      unknown.push(c.method + ' ' + c.url); throw Error('unexpected R9 read')
    }
    if (c.url === '/price-lists/customer-price') {
      quotes++
      if (quotes === 2) {
        records.push(c)
        await new Promise<void>(r => { resolveOld = r })
        return { data: { success: true, data: { salePrice: 99, priceLevel: 'OLD', source: 'price_level' } }, status: 200, statusText: 'OK', config: c, headers: {} }
      }
    }
    return adapter(c)
  }
  try {
    await page('/sale/new?sourceId=80', async (host, show) => {
      await click(host, '载入当前客户和商品')
      await input(host.querySelector<HTMLInputElement>('[aria-label="数量"]')!, '3')
      await click(host, '选择客户'); await click(host, '重选当前客户'); expect(resolveOld).toBeTruthy()
      await show(false); await show(true); await act(async () => resolveOld()); await flush()
      expect(host.textContent).toContain('当前商品:个:7.1234')
      expect(host.textContent).not.toContain('当前商品:个:99')
      expect(host.querySelector<HTMLInputElement>('[aria-label="数量"]')!.value).toBe('3')
      await click(host, '重选当前客户'); expect(quotes).toBe(3)
      expect(host.textContent).toContain('当前商品:个:7.1234')
    })
  } finally { apiClient.defaults.adapter = adapter; expect(unknown).toEqual([]) }
})
