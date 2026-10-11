// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AxiosAdapter } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { captureInboundEditOwner } from '@/hooks/useInboundTaskEditRecovery'
import { resolveRoutePermission } from '@/router/routeRegistry'
import { PERMISSIONS } from '@/lib/permission-codes'
const oldAdapter = client.defaults.adapter, calls: string[] = []
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, cache: QueryClient
const storage = 'flowcube-inbound-edit-v1'
function record() { return { version: 1, userId: 91, baseURL: captureInboundEditOwner().baseURL, taskId: 21, action: 'inbound.update.21', path: '/inbound-tasks/21', method: 'put', body: { remark: '原输入', freightType: null, freightAmount: 0, expectedEditFingerprint: 'original', items: [{ purchaseItemId: 41, qty: 2 }] }, requestKey: 'original-edit-key', createdAt: Date.now(), phase: 'pending' } }
function Harness() { const location = useLocation(); return <><output>{location.pathname}</output><KeepAliveOutlet /></> }
async function mount() { await act(async () => root.render(<MemoryRouter initialEntries={['/inbound-tasks/21/edit']}><QueryClientProvider client={cache}><Harness /></QueryClientProvider></MemoryRouter>)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); calls.length = 0; setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 91, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 99, permissions: [PERMISSIONS.INBOUND_ORDER_VIEW] }); useWorkspaceStore.getState().closeAll()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.defaults.adapter = (async config => { calls.push(config.method + ' ' + config.url); if (config.method !== 'get' || config.url !== '/system/request-status/original-edit-key') throw Error('仅允许本人原回执查询'); return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: { status: 'pending', data: null } } } }) satisfies AxiosAdapter
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); cache.clear(); client.defaults.adapter = oldAdapter; localStorage.clear(); useAuthStore.getState().logout() })
test('unknown刷新并重新登录撤UPDATE后，真实工作区仅打开本人原请求恢复壳并查询，无context/来源/PUT', async () => {
  localStorage.setItem(storage, JSON.stringify([record()])); const original = localStorage.getItem(storage); useAuthStore.getState().logout(); useAuthStore.getState().login('fixture', null, { id: 91, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 99, permissions: [PERMISSIONS.INBOUND_ORDER_VIEW] }); await mount()
  const query = await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('output')?.textContent).toBe('/inbound-tasks/21/edit'); const button = [...host.querySelectorAll('button')].find(b => b.textContent === '查询原保存结果'); expect(button).toBeDefined(); return button! }, { timeout: 3000, interval: 20 })
  expect(host.querySelector('input')).toBeNull(); expect(calls).toEqual([]); await act(async () => query.click()); expect(calls).toEqual(['get /system/request-status/original-edit-key']); expect(localStorage.getItem(storage)).toBe(original)
})
test.each(['none', 'other-account', 'other-endpoint', 'other-task', 'malformed', 'no-view'])('无本人原请求%s不能借恢复壳进入编辑页', async kind => {
  const value = record(); if (kind === 'no-view') useAuthStore.getState().updateUser({ permissions: [] }); if (kind === 'other-account') value.userId = 92; if (kind === 'other-endpoint') value.baseURL = 'http://other/api'; if (kind === 'other-task') { value.taskId = 22; value.action = 'inbound.update.22'; value.path = '/inbound-tasks/22' }
  if (kind !== 'none') localStorage.setItem(storage, kind === 'malformed' ? '{bad' : JSON.stringify([value])); expect(resolveRoutePermission('/inbound-tasks/21/edit')).toBe(PERMISSIONS.INBOUND_ORDER_UPDATE); await mount(); await vi.waitFor(() => expect(host.querySelector('output')?.textContent).toBe('/403')); expect(calls).toEqual([])
})

test('仅UPDATE本人unknown重挂保留本地提示，不读取context/来源/receipt或新PUT', async () => {
  useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] }); localStorage.setItem(storage, JSON.stringify([record()])); await mount()
  await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain('联系有权人员') })
  expect(calls).toEqual([]); expect([...host.querySelectorAll('button')].find(b => b.textContent === '查询原保存结果')?.disabled).toBe(true)
})
