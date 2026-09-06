// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import GlobalSearch from './GlobalSearch'
import { searchGlobalApi } from '@/api/search'

vi.mock('@/api/search', () => ({ searchGlobalApi: vi.fn() }))
let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.mocked(searchGlobalApi).mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<MemoryRouter><GlobalSearch /></MemoryRouter>))
  act(() => host.querySelector('input')!.focus())
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
async function type(value: string, advance = true) {
  act(() => {
    const input = host.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (advance) await act(async () => vi.advanceTimersByTimeAsync(300))
}
const page = (items: ReturnType<typeof result>[], nextCursors = {}) => ({ items, nextCursors })
const result = (title: string) => ({ id: 1, type: 'sale', typeLabel: '销售单', title, subtitle: '客户', path: '/sale/1' })

test('移除时间范围，仅用关键词搜索并显示历史单据', async () => {
  vi.mocked(searchGlobalApi).mockResolvedValue(page([result('SALE-2020-001')]) as never)
  await type('SALE-2020')
  expect(host.querySelector('select')).toBeNull()
  expect(searchGlobalApi).toHaveBeenCalledWith('SALE-2020', {signal:expect.any(AbortSignal)})
  expect(host.textContent).toContain('SALE-2020-001')
})

test('旧请求迟到不能覆盖新关键词的结果', async () => {
  let resolveOld!: (value: never) => void
  vi.mocked(searchGlobalApi).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce(page([result('新结果')]) as never)
  await type('旧关键词')
  await type('新关键词')
  await act(async () => resolveOld(page([result('旧结果')]) as never))
  expect(host.textContent).toContain('新结果')
  expect(host.textContent).not.toContain('旧结果')
})

test('清空关键词后迟到结果不会在下次输入时闪现', async () => {
  let resolveOld!: (value: never) => void
  vi.mocked(searchGlobalApi).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce(page([]))
  await type('旧关键词')
  await type('')
  await act(async () => resolveOld(page([result('旧结果')]) as never))
  await type('其他', false)
  expect(host.textContent).not.toContain('旧结果')
})

test('Escape 清理尚未发起的搜索', async () => {
  await type('待取消', false)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(searchGlobalApi).not.toHaveBeenCalled()
  expect(host.querySelector('input')!.value).toBe('')
})

test('查询失败显示错误，不伪装成无结果', async () => {
  vi.mocked(searchGlobalApi).mockRejectedValue(new Error('network'))
  await type('订单')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('搜索失败')
  expect(host.textContent).not.toContain('未找到')
})


test('完整结果保留补充资料，不显示加载更多或分页说明', async () => {
  vi.mocked(searchGlobalApi).mockResolvedValue({items: Array.from({length:25}, (_,i) => ({...result(`客户${i}`),id:i,details:[{label:'联系人',value:'张先生'}]})),nextCursors:{}})
  await type('客户')
  expect(host.textContent).toContain('客户24')
  expect(host.textContent).toContain('联系人：张先生')
  expect(host.textContent).not.toContain('加载更多')
  expect(host.textContent).not.toContain('每类最多')
})
