// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
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
const adapter = api.defaults.adapter
const blockedTransport = vi.fn(async (config: InternalAxiosRequestConfig) => {
  throw new Error(`日志详情读取状态测试禁止网络与业务写入：${config.url}`)
})
const log = (id: number, marker: string): OpLog => ({
  id, userId: 123, userName: `USER-${marker}`, method: 'PUT', path: '/api/products/123', module: 'products',
  statusCode: 200, ip: '127.0.0.1', createdAt: '2026-10-15T02:00:00Z', requestBody: `{"note":"BODY-${marker}"}`,
})
const success = (list: OpLog[]) => ({ list, pagination: { page: 1, pageSize: 20, total: list.length } })
const failures = [
  { name: '403', error: { response: { status: 403, data: { message: '合成操作日志权限读取失败' } } }, message: '合成操作日志权限读取失败' },
  { name: '500', error: { response: { status: 500, data: { message: '合成操作日志服务器读取失败' } } }, message: '合成操作日志服务器读取失败' },
]
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function click(text: string, scope: ParentNode = host) {
  const node = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)
  expect(node, text).toBeTruthy()
  await act(async () => node!.click()); await flush()
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={cache}>
    <MemoryRouter initialEntries={['/oplogs?keyword=APPLIED&startDate=2026-10-01&endDate=2026-10-15']}><OpLogsPage /></MemoryRouter>
  </QueryClientProvider>)); await flush()
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

test.each(failures)('已打开详情遇到$name 隐藏旧操作人与请求正文，同查询重试按原ID恢复当前内容', async failure => {
  reads.logs.mockResolvedValue(success([log(7, 'OLD-CACHE')]))
  await render(); await click('详情')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('USER-OLD-CACHE')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('BODY-OLD-CACHE')
  const applied = reads.logs.mock.lastCall?.[0]
  reads.logs.mockRejectedValue(failure.error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(host.textContent).toContain(failure.message)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).not.toContain('USER-OLD-CACHE')
  expect(document.body.textContent).not.toContain('BODY-OLD-CACHE')
  reads.logs.mockResolvedValue(success([log(7, 'CURRENT')]))
  await click('重试')
  expect(reads.logs.mock.lastCall?.[0]).toEqual(applied)
  const current = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(current, '同一日志仍可读时恢复原详情上下文').toBeTruthy()
  expect(current.textContent).toContain('USER-CURRENT')
  expect(current.textContent).toContain('BODY-CURRENT')
  expect(document.body.textContent).not.toContain('USER-OLD-CACHE')
  expect(document.body.textContent).not.toContain('BODY-OLD-CACHE')
})

test('重试成功但原日志已不在当前结果，不展示旧详情；之后原ID返回才恢复当前行', async () => {
  reads.logs.mockResolvedValue(success([log(7, 'OLD-CACHE')]))
  await render(); await click('详情')
  reads.logs.mockRejectedValue(failures[1].error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  reads.logs.mockResolvedValue(success([log(8, 'ANOTHER-LOG')]))
  await click('重试')
  expect(host.textContent).toContain('USER-ANOTHER-LOG')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).not.toContain('BODY-OLD-CACHE')
  reads.logs.mockResolvedValue(success([log(7, 'RESTORED')]))
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('USER-RESTORED')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('BODY-RESTORED')
})

test('用户主动关闭详情后，失败与恢复不擅自重新打开', async () => {
  reads.logs.mockResolvedValue(success([log(7, 'OLD-CACHE')]))
  await render(); await click('详情')
  await click('关闭', document.querySelector('[role="dialog"]')!)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  reads.logs.mockRejectedValue(failures[0].error)
  await act(async () => { await cache.refetchQueries({ queryKey: ['oplogs'] }) }); await flush()
  reads.logs.mockResolvedValue(success([log(7, 'CURRENT')]))
  await click('重试')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).toContain('USER-CURRENT')
})
