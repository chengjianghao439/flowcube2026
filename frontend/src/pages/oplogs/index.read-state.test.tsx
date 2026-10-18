// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import OpLogsPage from './index'
import type { OpLog } from '@/api/oplogs'
import api from '@/api/client'

const reads = vi.hoisted(() => ({ logs: vi.fn() }))
vi.mock('@/api/oplogs', async original => ({ ...await original<typeof import('@/api/oplogs')>(), getAllOpLogsApi: reads.logs }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))

let host: HTMLDivElement, root: Root, cache: QueryClient
let currentSearch = ''
const adapter = api.defaults.adapter
const blockedTransport = vi.fn(async (config: InternalAxiosRequestConfig) => {
  throw new Error(`日志列表测试禁止网络与业务写入：${config.url}`)
})
const log = (id: number, userName: string): OpLog => ({
  id, userId: 123, userName, method: 'PUT', path: '/api/products/123', module: 'products',
  statusCode: 200, ip: '127.0.0.1', createdAt: '2026-10-15T02:00:00Z', requestBody: '{"name":"合成商品"}',
})
const success = (list: OpLog[] = [], total = list.length) => ({ list, pagination: { page: 1, pageSize: 20, total } })
const failures = [
  { name: '403', error: { response: { status: 403, data: { message: '合成操作日志权限已失效' } } }, message: '合成操作日志权限已失效' },
  { name: '500', error: { response: { status: 500, data: { message: '合成操作日志读取失败' } } }, message: '合成操作日志读取失败' },
]
const appliedPath = '/oplogs?keyword=APPLIED&module=products&startDate=2026-10-01&endDate=2026-10-15'
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function click(text: string, scope: ParentNode = host) {
  const node = button(scope, text)
  expect(node, text).toBeTruthy()
  await act(async () => node!.click()); await flush()
}
async function input(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function LocationProbe() { currentSearch = useLocation().search; return null }
async function render(path = appliedPath) {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}>
    <LocationProbe /><OpLogsPage />
  </MemoryRouter></QueryClientProvider>)); await flush()
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  reads.logs.mockReset(); blockedTransport.mockClear(); api.defaults.adapter = blockedTransport
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  cache.clear(); host.remove(); api.defaults.adapter = adapter; localStorage.clear()
  expect(blockedTransport).not.toHaveBeenCalled()
})

test.each(failures)('$name 首读失败显示错误及同条件重试，不能显示暂无数据或共0条', async failure => {
  reads.logs.mockRejectedValue(failure.error)
  await render()
  expect(host.textContent).toContain(failure.message)
  expect(host.textContent).not.toContain('暂无数据')
  expect(host.textContent).not.toMatch(/共\s*0\s*条/)
  const applied = reads.logs.mock.lastCall?.[0]
  reads.logs.mockResolvedValue(success())
  await click('重试')
  expect(reads.logs.mock.lastCall?.[0]).toEqual(applied)
  expect(host.textContent).toContain('暂无数据')
  expect(host.textContent).toMatch(/共\s*0\s*条/)
  expect(host.textContent).not.toContain(failure.message)
})

test.each(failures)('缓存后$name 隐藏旧行、详情入口、数量及旧翻页状态，重试恢复当前结果', async failure => {
  reads.logs.mockResolvedValue(success([log(1, 'LOG-OLD-CACHE')], 67))
  await render()
  expect(host.textContent).toContain('LOG-OLD-CACHE')
  expect(host.textContent).toMatch(/共\s*67\s*条/)
  const applied = reads.logs.mock.lastCall?.[0]
  reads.logs.mockRejectedValue(failure.error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(host.textContent).toContain(failure.message)
  expect(host.textContent).not.toContain('LOG-OLD-CACHE')
  expect(host.textContent).not.toContain('暂无数据')
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(button(host, '详情')).toBeUndefined()
  expect(button(host, '下一页')).toBeUndefined()
  reads.logs.mockResolvedValue(success([log(2, 'LOG-RETRY-CURRENT')]))
  await click('重试')
  expect(reads.logs.mock.lastCall?.[0]).toEqual(applied)
  expect(host.textContent).toContain('LOG-RETRY-CURRENT')
  expect(host.textContent).not.toContain('LOG-OLD-CACHE')
  expect(host.textContent).toMatch(/共\s*1\s*条/)
  await click('详情')
  const detail = document.querySelector('[role="dialog"]')!
  expect(detail.textContent).toContain('LOG-RETRY-CURRENT')
  expect(detail.textContent).toContain('/api/products/123')
})

test('读取失败及原查询重试不改变已应用URL条件或覆盖未应用查询草稿', async () => {
  reads.logs.mockResolvedValue(success([log(3, 'LOG-APPLIED')]))
  await render()
  const applied = reads.logs.mock.lastCall?.[0]
  expect(applied).toMatchObject({ keyword: 'APPLIED', module: 'products', startDate: '2026-10-01', endDate: '2026-10-15' })
  const search = currentSearch
  const queryKey = cache.getQueryCache().findAll({ queryKey: ['oplogs'] })[0].queryKey
  await click('查询')
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const draft = dialog.querySelector<HTMLInputElement>('[placeholder="请输入关键字…"]')!
  await input(draft, 'NOT-APPLIED')
  reads.logs.mockRejectedValue(failures[1].error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(host.textContent).toContain(failures[1].message)
  expect(currentSearch).toBe(search)
  expect(draft.value).toBe('NOT-APPLIED')
  reads.logs.mockResolvedValue(success([log(4, 'LOG-RETRY')]))
  await click('重试')
  expect(reads.logs.mock.lastCall?.[0]).toEqual(applied)
  expect(cache.getQueryCache().findAll({ queryKey: ['oplogs'] })[0].queryKey).toEqual(queryKey)
  expect(currentSearch).toBe(search)
  expect(draft.value).toBe('NOT-APPLIED')
  await click('查询', dialog)
  expect(reads.logs.mock.lastCall?.[0]).toMatchObject({ ...applied, keyword: 'NOT-APPLIED' })
  expect(new URLSearchParams(currentSearch).get('keyword')).toBe('NOT-APPLIED')
})
