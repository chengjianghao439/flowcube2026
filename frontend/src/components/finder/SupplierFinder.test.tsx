// @vitest-environment jsdom
//
// SupplierFinder 的**选中一致性**回归（2026-09-28，取证见
// docs/finder-selection-parity-2026-09-28.md）。与 CustomerFinder 同契约。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SupplierFinder } from './SupplierFinder'
import { getSuppliersApi } from '@/api/suppliers'

vi.mock('@/api/suppliers', () => ({ getSuppliersApi: vi.fn() }))
vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => <div>{children}{footer}</div>,
}))

type Row = Record<string, unknown>
const row = (over: Row = {}): Row => ({ id: 1, name: '供应商甲', code: 'S001', contact: '张三', phone: '13800000000', isActive: true, ...over })
const pageOf = (list: Row[]) => ({ list, pagination: { page: 1, pageSize: 500, total: list.length } })

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 * 60 * 5 } } })
  vi.mocked(getSuppliersApi).mockReset()
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })

async function mount(open: boolean, onConfirm: (r: unknown) => void = () => {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SupplierFinder open={open} onClose={() => {}} onConfirm={onConfirm} />
      </QueryClientProvider>,
    )
  })
}
const rows = () => [...host.querySelectorAll('[role="row"]')] as HTMLElement[]
const btn = (t: string) => [...host.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined
const hasRow = (name: string) => rows().some(r => (r.textContent ?? '').includes(name))
const searchInput = () => host.querySelector('input') as HTMLInputElement
const waitRow = (name: string) => vi.waitFor(() => expect(hasRow(name)).toBe(true))
function setNativeValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
}
async function typeKeyword(v: string) {
  await act(async () => {
    setNativeValue(searchInput(), v)
    searchInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function selectFirstRow() {
  // 真实就绪等待（不用固定 sleep）：`onSelect` 在 pending（debounce / 请求中）时会被守卫拦下，
  // 故重试点击直到"确实选上且可确认"为止。
  await vi.waitFor(async () => {
    await act(async () => { rows()[0]?.click() })
    expect(btn('确认选择')?.disabled).toBe(false)
  })
}

it('★ 数据刷新（改名 + 换联系方式）后，页脚与双击都回传**当前行**', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  const onConfirm = vi.fn()
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  await selectFirstRow()

  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row({ name: '供应商甲改名', contact: '李四', phone: '13900000000' })]) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['suppliers'] }) })
  await waitRow('供应商甲改名')

  await act(async () => { btn('确认选择')!.click() })
  const viaFooter = onConfirm.mock.calls[0][0] as { name: string; contact?: string }
  expect(viaFooter.name).toBe('供应商甲改名')
  expect(viaFooter.contact).toBe('李四')

  onConfirm.mockClear()
  await act(async () => { rows()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  expect((onConfirm.mock.calls[0][0] as { phone?: string }).phone).toBe('13900000000')
})

it('★ 选中行被移除后不得确认', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  const onConfirm = vi.fn()
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  await selectFirstRow()

  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row({ id: 2, name: '供应商乙' })]) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['suppliers'] }) })
  await waitRow('供应商乙')

  expect(btn('确认选择')?.disabled).toBe(true)
  await act(async () => { btn('确认选择')!.click() })
  expect(onConfirm).not.toHaveBeenCalled()
})

it('★ 选中行被停用（isActive:false）后不得确认', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  await mount(true, vi.fn())
  await waitRow('供应商甲')
  await selectFirstRow()

  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row({ isActive: false })]) as never)
  await act(async () => { await client.invalidateQueries({ queryKey: ['suppliers'] }) })
  await vi.waitFor(() => expect(hasRow('供应商甲')).toBe(false))
  expect(btn('确认选择')?.disabled).toBe(true)
})

it('★ debounce 未落定（300ms 内）：搜索请求尚未发出、旧行仍在，页脚 / 双击 / Space 均不回调', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  const onConfirm = vi.fn()
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  await selectFirstRow()
  const callsBefore = vi.mocked(getSuppliersApi).mock.calls.length

  await typeKeyword('别的词')   // 尚未越过 300ms debounce
  expect(vi.mocked(getSuppliersApi).mock.calls.length).toBe(callsBefore) // 搜索请求尚未发生
  expect(hasRow('供应商甲')).toBe(true)                                  // 旧行仍在列表
  expect(btn('确认选择')?.disabled).toBe(true)

  await act(async () => { btn('确认选择')!.click() })
  await act(async () => { rows()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await act(async () => { rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
  expect(onConfirm).not.toHaveBeenCalled()
})

it('★ 已有选中且**旧行仍可见**时，后台 refetch 挂起期间三个入口都不回调；释放后恢复', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  const onConfirm = vi.fn()
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  await selectFirstRow()
  const callsBefore = vi.mocked(getSuppliersApi).mock.calls.length

  let release: (v: unknown) => void = () => {}
  vi.mocked(getSuppliersApi).mockImplementation(() => new Promise(res => { release = res as unknown as (v: unknown) => void }))
  await act(async () => { void client.invalidateQueries({ queryKey: ['suppliers'] }) })
  await vi.waitFor(() => expect(btn('确认选择')?.disabled).toBe(true))
  expect(vi.mocked(getSuppliersApi).mock.calls.length).toBeGreaterThan(callsBefore)
  expect(hasRow('供应商甲')).toBe(true)

  await act(async () => { btn('确认选择')!.click() })
  await act(async () => { rows()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await act(async () => { rows()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
  expect(onConfirm).not.toHaveBeenCalled()

  await act(async () => { release(pageOf([row()]) as never) })
  await vi.waitFor(() => expect(btn('确认选择')?.disabled).toBe(false))
  await act(async () => { btn('确认选择')!.click() })
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

it('★ 查询出错时不得确认，给出可重试入口；重试后**确认真正恢复**', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  const onConfirm = vi.fn()
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  await selectFirstRow()

  vi.mocked(getSuppliersApi).mockRejectedValue(new Error('boom'))
  await act(async () => { await client.invalidateQueries({ queryKey: ['suppliers'] }) })
  await vi.waitFor(() => expect(btn('重试')).toBeTruthy())
  expect(btn('确认选择')?.disabled).toBe(true)

  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  await act(async () => { btn('重试')!.click() })
  await vi.waitFor(() => expect(btn('重试')).toBeFalsy())
  await waitRow('供应商甲')
  await selectFirstRow()
  await act(async () => { btn('确认选择')!.click() })
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

it('★ 关闭后重开：选中被清空', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  const onConfirm = vi.fn()
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  await selectFirstRow()

  await mount(false, onConfirm)
  await mount(true, onConfirm)
  await waitRow('供应商甲')
  expect(btn('确认选择')?.disabled).toBe(true)
})

it('★ 输入后立即关闭（debounce 未落定）→ 越过 timer 再重开：不会永久 pending', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  await mount(true, vi.fn())
  await waitRow('供应商甲')

  await typeKeyword('别的词')
  await mount(false, vi.fn())
  await act(async () => { await new Promise(r => setTimeout(r, 400)) })
  await mount(true, vi.fn())
  await waitRow('供应商甲')
  await selectFirstRow()
})

it('★ 带首尾空格的搜索输入不会永久 pending', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue(pageOf([row()]) as never)
  await mount(true, vi.fn())
  await waitRow('供应商甲')

  await typeKeyword('供应商甲 ')
  await act(async () => { await new Promise(r => setTimeout(r, 400)) })
  await selectFirstRow()
})
