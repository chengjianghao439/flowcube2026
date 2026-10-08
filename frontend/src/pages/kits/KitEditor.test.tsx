// @vitest-environment jsdom
// 真实编辑器、分类/供应商/商品查找器和 AppDialog；只替代 API 边界。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import KitEditor from './KitEditor'
import { savedKit } from './kitFixtures.test-data'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'

const api = vi.hoisted(() => {
  let baseURL = '/api'
  const listeners = new Set<() => void>()
  return { detail: vi.fn(), create: vi.fn(), update: vi.fn(), categories: vi.fn(), suppliers: vi.fn(), products: vi.fn(), settings: vi.fn(), defaults: { get baseURL() { return baseURL }, set baseURL(value: string) { baseURL = value; listeners.forEach(listener => listener()) } }, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
})
vi.mock('@/api/kits', () => ({ getKitApi: api.detail, createKitApi: api.create, updateKitApi: api.update, deleteKitApi: vi.fn() }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults }, subscribeApiClientBaseURL: api.subscribe, getApiClientBaseURL: () => api.defaults.baseURL }))
vi.mock('@/api/categories', () => ({ getCategoryTreeApi: api.categories }))
vi.mock('@/api/suppliers', () => ({ getSuppliersApi: api.suppliers }))
vi.mock('@/api/products', () => ({ getProductsForFinderApi: api.products }))
vi.mock('@/api/settings', () => ({ getSettingsApi: api.settings }))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.resetAllMocks(); api.defaults.baseURL = '/api'
  api.detail.mockResolvedValue(structuredClone(savedKit))
  api.create.mockResolvedValue(structuredClone(savedKit)); api.update.mockResolvedValue(structuredClone(savedKit))
  api.categories.mockResolvedValue([{ id: 2, name: '五金配件', status: 1, children: [] }, { id: 22, name: '新分类', status: 1, children: [] }])
  api.suppliers.mockResolvedValue({ list: [{ id: 3, name: '配件供应商', code: 'S3', isActive: true }, { id: 33, name: '新供应商', code: 'S33', isActive: true }], pagination: { total: 2 } })
  api.products.mockResolvedValue({ list: [{ id: 13, code: 'P13', name: '新组件', unit: '个', allowDecimalQty: false, categoryName: '五金配件', supplierName: '配件供应商' }], pagination: { total: 1 } })
  api.settings.mockResolvedValue({ map: { price_rate_a: { value: '5' }, price_rate_b: { value: '15' }, price_rate_c: { value: '25' }, price_rate_d: { value: '35' } } })
  useAuthStore.setState({ token: 'unit-test-only', sessionGeneration: 10, user: { id: 5, username: 'fixture', realName: '测试', roleId: 5, roleName: '测试', permissions: [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.PRODUCT_CREATE, PERMISSIONS.PRODUCT_UPDATE] } })
})
async function mount(id: number | 'new', run: (client: QueryClient) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><KitEditor id={id} onClose={() => {}} /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 15)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="配件名称"]')).toBeTruthy())
    await run(client)
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)) })
    client.clear(); host.remove()
  }
}
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!
const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await act(async () => { button(label).click(); await new Promise(resolve => setTimeout(resolve, 15)) }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function change(label: string, value: string) {
  const target = input(label); expect(target, label).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value); target.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function chooseCategory() { await click('点击选择分类…'); await vi.waitFor(() => expect(button('五金配件')).toBeTruthy()); await click('五金配件') }
async function chooseSupplier() {
  await click('点击选择供应商…')
  await vi.waitFor(() => expect(document.querySelector('[role="row"][aria-selected]')).toBeTruthy())
  await act(async () => { document.querySelector<HTMLElement>('[role="row"][aria-selected]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
}
async function fillProfile() {
  await change('配件名称', '新成套配件'); await chooseCategory(); await chooseSupplier()
  await change('单位', '组'); await change('型号', 'H-20'); await change('颜色', '黑色')
  await change('供应商型号', 'SUP20'); await change('进价', '10'); await change('备注', '员工资料')
}
async function addComponent() {
  await click('添加组件')
  await vi.waitFor(() => expect(Array.from(document.querySelectorAll('tbody tr')).some(r => r.textContent?.includes('新组件'))).toBe(true))
  await act(async () => { Array.from(document.querySelectorAll('tbody tr')).find(r => r.textContent?.includes('新组件'))!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect(input('新组件每套基本量')?.value).toBe('1')
}
test('新建无需编码，真实商品及分类/供应商回填；空档由进价生成且明确零原样提交', async () => {
  await mount('new', async () => {
    expect(input('配件编码').readOnly).toBe(true); expect(input('配件编码').value).toBe('')
    expect(input('配件编码').placeholder).toContain('自动生成'); expect(input('单位').value).toBe('套')
    await fillProfile(); await addComponent(); await change('价格B', '0')
    expect(input('价格A').placeholder).toBe('10.50'); expect(input('价格D').placeholder).toBe('13.50')
    expect(document.body.textContent).toContain('价格A +5%')
    await click('创建配件')
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.create.mock.calls[0][0]).toEqual({ name: '新成套配件', isActive: true, categoryId: 2, supplierId: 3, unit: '组', spec: 'H-20', color: '黑色', articleNumber: 'SUP20', costPrice: 10, remark: '员工资料', salePriceB: 0, components: [{ productId: 13, baseQty: 1 }] })
  })
})
test('未完成必填资料阻止创建，进价零不合法', async () => {
  await mount('new', async () => {
    await change('配件名称', '新套'); await click('创建配件')
    expect(api.create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('分类')
    await fillProfile(); await addComponent(); await change('进价', '0'); await click('创建配件')
    expect(api.create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('大于零')
  })
})
test('已有编码只读，四档DTO回填；资料和零售价修改不发送组成及编码', async () => {
  api.detail.mockResolvedValue({ ...savedKit, salePriceA: 110, salePriceB: 120, salePriceC: 130, salePriceD: 140 })
  await mount(7, async () => {
    expect(input('配件编码').readOnly).toBe(true); expect(input('配件编码').value).toBe('K7')
    expect(input('价格A').value).toBe('110'); expect(input('价格B').value).toBe('120'); expect(input('价格D').value).toBe('140')
    await change('型号', '新型号'); await change('价格C', '0'); await change('价格B', ''); await click('保存修改')
    expect(api.update.mock.calls[0][1]).toMatchObject({ spec: '新型号', salePriceB: null, salePriceC: 0, revision: 3 })
    for (const key of ['salePriceA', 'referenceUnitPrice', 'salePriceD']) expect(api.update.mock.calls[0][1]).not.toHaveProperty(key)
    expect(api.update.mock.calls[0][1]).not.toHaveProperty('code'); expect(api.update.mock.calls[0][1]).not.toHaveProperty('components')
  })
})
test('后台详情刷新保留元资料、价格和原revision草稿', async () => {
  await mount(7, async client => {
    await change('型号', '我的型号'); await change('进价', '81.1234'); await change('价格D', '0')
    api.detail.mockResolvedValue({ ...savedKit, spec: '别人型号', costPrice: 99, salePriceD: 999, revision: 9 })
    await act(async () => { await client.invalidateQueries({ queryKey: ['kits'] }) })
    expect(input('型号').value).toBe('我的型号'); expect(input('进价').value).toBe('81.1234'); expect(input('价格D').value).toBe('0')
    await click('保存修改'); expect(api.update.mock.calls[0][1]).toMatchObject({ spec: '我的型号', costPrice: 81.1234, salePriceD: 0, revision: 3 })
  })
})
test.each(['分类', '供应商'])('未知提交锁定时，已打开%s查找器迟到确认也不修改草稿', async kind => {
  api.update.mockRejectedValue(new Error('超时'))
  await mount(7, async () => {
    await change('配件名称', '待确认')
    await click(kind === '分类' ? '五金配件' : '配件供应商')
    if (kind === '供应商') await vi.waitFor(() => expect(document.querySelectorAll('[role="row"][aria-selected]')).toHaveLength(2))
    const target = kind === '分类' ? button('新分类') : Array.from(document.querySelectorAll('[role="row"][aria-selected]')).at(-1)!
    await click('保存修改')
    await act(async () => { target.dispatchEvent(new MouseEvent(kind === '分类' ? 'click' : 'dblclick', { bubbles: true })) })
    expect(button(kind === '分类' ? '五金配件' : '配件供应商')).toBeTruthy()
    expect(input('进价').matches(':disabled')).toBe(true); expect(input('价格D').matches(':disabled')).toBe(true)
    await click('按原请求重试'); expect(api.update.mock.calls[1]).toEqual(api.update.mock.calls[0])
  })
})
test.each(['分类', '供应商'])('服务器变化后，已打开%s查找器不能把新来源选择写入原草稿', async kind => {
  try {
    await mount(7, async () => {
      await click(kind === '分类' ? '五金配件' : '配件供应商')
      if (kind === '供应商') await vi.waitFor(() => expect(document.querySelectorAll('[role="row"][aria-selected]')).toHaveLength(2))
      const target = kind === '分类' ? button('新分类') : Array.from(document.querySelectorAll('[role="row"][aria-selected]')).at(-1)!
      await act(async () => { api.defaults.baseURL = '/server-b' })
      await act(async () => { target.dispatchEvent(new MouseEvent(kind === '分类' ? 'click' : 'dblclick', { bubbles: true })) })
      expect(button(kind === '分类' ? '五金配件' : '配件供应商')).toBeTruthy()
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('服务器已切换')
      expect(api.update).not.toHaveBeenCalled()
    })
  } finally { api.defaults.baseURL = '/api' }
})
test('加价率和三个真实查找器读取都绑定原端点/登录代次，关闭的查找器不发请求', async () => {
  await mount('new', async () => {
    const config = expect.objectContaining({ baseURL: '/api', _authSessionGeneration: 10, _erpApiFallbackTried: true, automaticReplay: false, skipGlobalError: true })
    expect(api.settings).toHaveBeenCalledWith(config)
    expect(api.categories).not.toHaveBeenCalled(); expect(api.suppliers).not.toHaveBeenCalled(); expect(api.products).not.toHaveBeenCalled()
    await chooseCategory(); expect(api.categories.mock.calls[0][0]).toEqual(config); expect(api.categories.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
    await chooseSupplier(); expect(api.suppliers.mock.calls[0][1]).toEqual(config); expect(api.suppliers.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    await addComponent(); expect(api.products.mock.calls[0][1]).toEqual(config); expect(api.products.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})
test.each(['分类', '供应商', '组件'])('%s在A读取期间切B再回A，旧回复和旧查询缓存不能回填', async kind => {
  const query = kind === '分类' ? api.categories : kind === '供应商' ? api.suppliers : api.products
  const page = (name: string) => kind === '分类' ? [{ id: 22, name, status: 1 }] : { list: [{ id: 33, code: 'FIX33', name, unit: '个', allowDecimalQty: false, isActive: true }], pagination: { total: 1 } }
  let finish!: (value: unknown) => void
  query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(page(`新读取${kind}`))
  try {
    await mount('new', async () => {
      await click(kind === '分类' ? '点击选择分类…' : kind === '供应商' ? '点击选择供应商…' : '添加组件')
      expect(query).toHaveBeenCalledTimes(1)
      await act(async () => { api.defaults.baseURL = '/server-b' })
      await act(async () => { finish(page(`旧回复${kind}`)); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(document.body.textContent).not.toContain(`旧回复${kind}`)
      await act(async () => { api.defaults.baseURL = '/api'; await new Promise(resolve => setTimeout(resolve, 15)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2))
      expect(document.body.textContent).toContain(`新读取${kind}`); expect(document.body.textContent).not.toContain(`旧回复${kind}`)
      if (kind === '分类') await click('新读取分类')
      else await act(async () => { (kind === '供应商' ? document.querySelector('[role="row"][aria-selected]')! : Array.from(document.querySelectorAll('tbody tr')).find(row => row.textContent?.includes('新读取组件'))!).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
      expect(kind === '组件' ? input('新读取组件每套基本量')?.value : button(`新读取${kind}`)?.textContent).toBe(kind === '组件' ? '1' : `新读取${kind}`)
    })
  } finally { api.defaults.baseURL = '/api' }
})
test('登录代次变化后供应商迟到响应不能显示或回填', async () => {
  let finish!: (value: unknown) => void
  api.suppliers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount('new', async () => {
    await click('点击选择供应商…')
    await act(async () => { useAuthStore.setState({ sessionGeneration: 11 }); finish({ list: [{ id: 99, name: '旧登录供应商', isActive: true }], pagination: { total: 1 } }); await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(document.body.textContent).not.toContain('旧登录供应商')
    expect(button('点击选择供应商…')).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })
})
test.each(['分类', '供应商'])('%s同步A→B→A时，React重渲染前的旧节点也不能确认', async kind => {
  await mount(7, async () => {
    await click(kind === '分类' ? '五金配件' : '配件供应商')
    const target = kind === '分类' ? button('新分类') : Array.from(document.querySelectorAll('[role="row"][aria-selected]')).at(-1)!
    await act(async () => { api.defaults.baseURL = '/server-b'; api.defaults.baseURL = '/api'; target.dispatchEvent(new MouseEvent(kind === '分类' ? 'click' : 'dblclick', { bubbles: true })) })
    expect(document.querySelector(kind === '分类' ? '#kit-category' : '#kit-supplier')?.textContent).toBe(kind === '分类' ? '五金配件' : '配件供应商')
  })
})
test('只读资料完整展示商品字段，所有资料和四档价格不可写', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.PRODUCT_VIEW] } })
  await mount(7, async () => {
    for (const label of ['配件名称', '单位', '型号', '颜色', '供应商型号', '进价', '备注', '价格A', '价格B', '价格C', '价格D']) expect(input(label).matches(':disabled'), label).toBe(true)
    expect(button('五金配件').disabled).toBe(true); expect(button('配件供应商').disabled).toBe(true)
    expect(button('保存修改')).toBeUndefined()
  })
})
