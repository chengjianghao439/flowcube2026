// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { AxiosAdapter } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { DISPOSAL_EXECUTION_STORAGE } from '@/lib/disposalRecovery'
import { isRegisteredErpRoute, resolveRoutePermission } from '@/router/routeDefinitions'
const oldAdapter = client.defaults.adapter, calls: string[] = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); calls.length = 0; setApiClientBaseURL('/a'); useAuthStore.getState().login('offline', null, { id: 9, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2, permissions: [] }); client.defaults.adapter = (async config => { calls.push(config.url!); if (config.method !== 'get' || !config.url?.startsWith('/system/request-status/')) throw Error('Only own status GET allowed'); return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: { status: 'not_found', data: null } } } }) satisfies AxiosAdapter })
afterEach(() => { client.defaults.adapter = oldAdapter; localStorage.clear() })
const snapshot = (createdAt = Date.now()) => ({ version: 1, id: 11, userId: 9, baseURL: '/a', action: 'disposal.dispose.11', path: '/disposals/11/dispose', method: 'post', body: {}, requestKey: 'original', createdAt, phase: 'pending' })
it('撤VIEW/EXECUTE后重挂auth-only可核本人，只有status GET，没有detail/stock/approval/新执行', async () => {
  expect(isRegisteredErpRoute('/disposals/recovery')).toBe(true); expect(resolveRoutePermission('/disposals/recovery')).toBeUndefined(); expect(resolveRoutePermission('/disposals')).toBeTruthy()
  localStorage.setItem(DISPOSAL_EXECUTION_STORAGE, JSON.stringify([snapshot()]))
  const host = document.createElement('div'), root = createRoot(host), cache = new QueryClient()
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/disposals/recovery']}><QueryClientProvider client={cache}><KeepAliveOutlet /></QueryClientProvider></MemoryRouter>))
    // 真实路由通过 React.lazy 导入；等待可操作页面，不能把固定延迟当作导入完成。
    const button = await vi.waitFor(async () => {
      await act(async () => {})
      expect(host.querySelector('h1')?.textContent).toBe('报废结果核对')
      const query = [...host.querySelectorAll('button')].find(b => b.textContent === '查询原报废结果')
      expect(query).toBeDefined()
      expect(query?.disabled).toBe(false)
      return query!
    }, { timeout: 3000, interval: 20 })
    expect(calls).toHaveLength(0)
    await act(async () => button.click())
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(host.querySelector('[role="status"]')?.textContent).toContain('暂未找到原结果')
    })
    expect(calls).toEqual(['/system/request-status/original'])
    expect(host.querySelector('input')).toBeNull()
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')?.disabled).toBe(true)
  } finally { await act(async () => root.unmount()); cache.clear() }
})
it.each([Date.now() - 8 * 86400000, Date.now() + 86400000])('TTL过期/异常时间只查询；缺旧body或重复记录不得另建键', async createdAt => {
  localStorage.setItem(DISPOSAL_EXECUTION_STORAGE, JSON.stringify([snapshot(createdAt)])); const { default: Page } = await import('./DisposalRecoveryPage'); const host = document.createElement('div'), root = createRoot(host), cache = new QueryClient()
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={cache}><Page /></QueryClientProvider></MemoryRouter>)); try { const retry = [...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!; expect(retry.disabled).toBe(true); expect(calls).toHaveLength(0) } finally { await act(async () => root.unmount()); cache.clear() }
})
