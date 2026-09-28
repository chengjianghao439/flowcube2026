// @vitest-environment jsdom
//
// 商品编辑页的「初始化快照 / 版本基线 / 草稿」行为契约（迁移 264 续项）。
//
// 这些是**行为测试**：渲染真实的 `ProductFormPage`，配一个与生产同 staleTime(5min) 的真实
// `QueryClient`，只 mock 边界（商品/设置接口、finder 弹窗、路由、toast）。断言的是**页面真实
// 表现**，不是扫源码文本、也不是自造镜像实现。
//
// 反例来源（2026-09-28 真实浏览器验收，见 docs/export-filters-fix-2026-09-27.md §23）：
//   ③′ 无编辑时后台 refetch 误报「未保存」；
//   ④  fresh 缓存窗口内关闭重开不重新取数 ⇒ 表单仍旧价/旧 revision、重试仍 409。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ProductFormPage from './form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { getProductApi, updateProductApi, createProductApi } from '@/api/products'

vi.mock('@/api/products', () => ({
  getProductApi: vi.fn(),
  updateProductApi: vi.fn(),
  createProductApi: vi.fn(),
  deleteProductApi: vi.fn(),
  getProductsForFinderApi: vi.fn(),
}))
vi.mock('@/api/settings', () => ({ getSettingsApi: vi.fn(async () => ({ map: {} })) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

// finder 是「选数据」的弹窗外壳，属边界：mock 成一个可点选后回填的按钮。
vi.mock('@/components/finder', () => ({
  CategoryFinder: ({ open, onConfirm }: { open?: boolean; onConfirm: (v: { id: number; name: string }) => void }) =>
    open ? <button type="button" data-testid="pick-category" onClick={() => onConfirm({ id: 1, name: '分类X' })}>pick</button> : null,
  SupplierFinder: ({ open, onConfirm }: { open?: boolean; onConfirm: (v: { id: number; name: string }) => void }) =>
    open ? <button type="button" data-testid="pick-supplier" onClick={() => onConfirm({ id: 62, name: '供应商Y' })}>pick</button> : null,
}))

type AnyProduct = Record<string, unknown>

function makeProduct(over: AnyProduct = {}): AnyProduct {
  return {
    id: 147, code: 'P000001', name: '夹具商品264', categoryId: 1, categoryName: '分类X',
    supplierId: 62, supplierName: '供应商Y', unit: '个', spec: 'S1', color: '黑',
    costPrice: 100, salePriceA: 150, salePriceB: 200, salePriceC: null, salePriceD: null,
    salePrice: 150, labelSalePrice: 150, remark: '', articleNumber: '', isActive: true,
    batchManaged: false, allowDecimalQty: true, shelfLifeDays: null, safetyStock: null,
    reorderPoint: null, units: [], revision: 1,
    ...over,
  }
}

let host: HTMLDivElement, root: Root, client: QueryClient

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // 与生产同口径：staleTime 5min —— 不主动失效/不强制刷新就会继续用旧缓存
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 * 60 * 5 } } })
  vi.mocked(getProductApi).mockReset()
  vi.mocked(updateProductApi).mockReset()
  vi.mocked(createProductApi).mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  client.clear()
  host.remove()
})

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TabPathContext.Provider value={path}>
          <ProductFormPage />
        </TabPathContext.Provider>
      </QueryClientProvider>,
    )
  })
}

const settle = (ms = 25) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

function numberValues(): string[] {
  return [...host.querySelectorAll('input[type=number]')].map(i => (i as HTMLInputElement).value)
}
function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')] as HTMLButtonElement[]
}
function clickButton(match: string) {
  const btn = buttons().find(b => (b.textContent ?? '').includes(match))
  if (!btn) throw new Error(`未找到按钮：${match}`)
  btn.click()
}
/**
 * 备注框：按**真实字段特征**定位——它是 `LimitedInput`，右侧有 "n/30" 计数 span。
 * 不能取「第一个非 checkbox/number 的 input」（那是「名称」，会把名称改动误当备注草稿）。
 */
function remarkInput(): HTMLInputElement {
  const counter = [...host.querySelectorAll('span')].find(s => /^\d+\/30$/.test((s.textContent ?? '').trim()))
  const el = counter?.previousElementSibling as HTMLInputElement | undefined
  if (!el || el.tagName !== 'INPUT') throw new Error('未找到备注输入框')
  return el
}
async function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const hasUnsaved = () => (host.textContent ?? '').includes('未保存')

// ── ④ 恢复路径：fresh 缓存 + 延迟响应 ────────────────────────────────────────────

test('★ 重挂载不用 fresh 旧缓存初始化（不提前可保存）；本次刷新到达后以新价+新 revision 初始化并成功提交', async () => {
  client.setQueryData(['products', 147], makeProduct({ salePriceA: 150, revision: 1 }))
  vi.mocked(getProductApi).mockImplementation(() => new Promise(res => {
    setTimeout(() => res(makeProduct({ salePriceA: 300, revision: 2 }) as never), 60)
  }))

  await renderAt('/products/147')
  // 本次刷新尚未返回：**不得**把缓存旧值当初始值渲染出来，且此刻**不能保存**（无按钮、无请求）
  expect(numberValues()).not.toContain('150')
  expect(buttons().some(b => (b.textContent ?? '').includes('保存修改'))).toBe(false)
  expect(vi.mocked(updateProductApi)).not.toHaveBeenCalled()

  await vi.waitFor(() => expect(numberValues()).toContain('300'))
  expect(numberValues()).toContain('100') // 进价

  vi.mocked(updateProductApi).mockResolvedValue(undefined as never)
  await act(async () => { clickButton('保存修改') })
  await vi.waitFor(() => expect(vi.mocked(updateProductApi)).toHaveBeenCalled())
  const [, data] = vi.mocked(updateProductApi).mock.calls[0] as [number, { revision: number; salePriceA: number }]
  expect(data.revision).toBe(2)
  expect(data.salePriceA).toBe(300)
})

test('★ 首次详情刷新失败：不把缓存旧值显示成可安全保存，且提供可重试入口', async () => {
  client.setQueryData(['products', 147], makeProduct({ salePriceA: 150, revision: 1 }))
  vi.mocked(getProductApi).mockRejectedValueOnce(new Error('boom'))

  await renderAt('/products/147')
  await settle()
  // 旧缓存不得被当作初始值渲染
  expect(numberValues()).not.toContain('150')
  // 有明确的重试入口
  expect((host.textContent ?? '')).toMatch(/重试|重新加载|加载失败/)

  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 300, revision: 2 }) as never)
  await act(async () => { clickButton('重试') })
  await vi.waitFor(() => expect(numberValues()).toContain('300'))
})

// ── ③′ 无编辑 + 后台 refetch ───────────────────────────────────────────────────

test('★ 无编辑时后台 refetch 不误报「未保存」', async () => {
  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 150, revision: 1 }) as never)
  await renderAt('/products/147')
  await vi.waitFor(() => expect(numberValues()).toContain('150'))
  expect(hasUnsaved()).toBe(false)

  // 同事改价：服务端已变，工具后台刷新拿到新数据
  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 300, revision: 2 }) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }) })
  await settle()

  expect(hasUnsaved()).toBe(false)
})

// ── 草稿保留与基线不更新 ───────────────────────────────────────────────────────

test('★ 有草稿时后台 refetch 保留草稿，且仍以原 revision 提交', async () => {
  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 150, revision: 1 }) as never)
  await renderAt('/products/147')
  await vi.waitFor(() => expect(numberValues()).toContain('150'))

  await typeInto(remarkInput(), '草稿B')
  expect(hasUnsaved()).toBe(true)

  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 300, revision: 2 }) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }) })
  await settle()

  // 草稿与基线都不被后台新数据改动
  expect(remarkInput().value).toBe('草稿B')
  expect(numberValues()).toContain('150')
  expect(numberValues()).not.toContain('300')
  expect(hasUnsaved()).toBe(true)

  vi.mocked(updateProductApi).mockResolvedValue(undefined as never)
  await act(async () => { clickButton('保存修改') })
  await vi.waitFor(() => expect(vi.mocked(updateProductApi)).toHaveBeenCalled())
  const [, data] = vi.mocked(updateProductApi).mock.calls[0] as [number, { revision: number; remark: string; name: string }]
  expect(data.revision).toBe(1)
  expect(data.remark).toBe('草稿B')        // 改的确实是备注
  expect(data.name).toBe('夹具商品264')    // 名称未被误改
})

test('★ 409 版本冲突时保留草稿并给出冲突提示', async () => {
  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 150, revision: 1 }) as never)
  await renderAt('/products/147')
  await vi.waitFor(() => expect(numberValues()).toContain('150'))

  await typeInto(remarkInput(), '草稿C')
  vi.mocked(updateProductApi).mockRejectedValue(Object.assign(new Error('冲突'), { code: 'PRODUCT_VERSION_CONFLICT' }))

  await act(async () => { clickButton('保存修改') })
  await vi.waitFor(() => expect((host.textContent ?? '').includes('本次修改未保存')).toBe(true))
  expect(remarkInput().value).toBe('草稿C')
  const [, data] = vi.mocked(updateProductApi).mock.calls[0] as [number, { remark: string; name: string }]
  expect(data.remark).toBe('草稿C')
  expect(data.name).toBe('夹具商品264')
})

test('★ 已初始化后后台刷新失败：保留草稿、不整页替换为错误态，并给重试入口', async () => {
  vi.mocked(getProductApi).mockResolvedValue(makeProduct({ salePriceA: 150, revision: 1 }) as never)
  await renderAt('/products/147')
  await vi.waitFor(() => expect(numberValues()).toContain('150'))

  await typeInto(remarkInput(), '草稿D')

  // 首次取数已成功；此后后台失效重取失败
  vi.mocked(getProductApi).mockRejectedValue(new Error('boom'))
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }) })
  await settle()

  expect(remarkInput().value).toBe('草稿D')                 // 草稿保留
  expect(numberValues()).toContain('150')                    // 表单未被错误页替换
  expect((host.textContent ?? '')).toContain('刷新失败')      // 有明确提示
  expect(buttons().some(b => (b.textContent ?? '').includes('重试'))).toBe(true)
})

// ── 新建不受影响 ──────────────────────────────────────────────────────────────

test('新建商品不请求详情、不报未保存，填写后可创建', async () => {
  vi.mocked(createProductApi).mockResolvedValue({ id: 999 } as never)
  await renderAt('/products/new')
  await settle()

  expect(vi.mocked(getProductApi)).not.toHaveBeenCalled()
  expect(hasUnsaved()).toBe(false)

  const nameInput = [...host.querySelectorAll('input')][0] as HTMLInputElement
  await typeInto(nameInput, '新商品甲')
  const unitInput = [...host.querySelectorAll('input')].find(i => i.placeholder === '例如：个、箱、kg') as HTMLInputElement
  await typeInto(unitInput, '个')
  const specInput = [...host.querySelectorAll('input')].find(i => i.placeholder === '商品型号') as HTMLInputElement
  await typeInto(specInput, 'S9')
  const colorInput = [...host.querySelectorAll('input')].find(i => i.placeholder === '商品颜色') as HTMLInputElement
  await typeInto(colorInput, '红')
  const costInput = [...host.querySelectorAll('input[type=number]')][0] as HTMLInputElement
  await typeInto(costInput, '10')

  await act(async () => { clickButton('点击选择分类') })
  await act(async () => { clickButton('点击选择供应商') })
  const pc = host.querySelector('[data-testid=pick-category]') as HTMLButtonElement | null
  if (pc) await act(async () => { pc.click() })
  const ps = host.querySelector('[data-testid=pick-supplier]') as HTMLButtonElement | null
  if (ps) await act(async () => { ps.click() })

  await act(async () => { clickButton('保存') })
  await vi.waitFor(() => expect(vi.mocked(createProductApi)).toHaveBeenCalled())
})
