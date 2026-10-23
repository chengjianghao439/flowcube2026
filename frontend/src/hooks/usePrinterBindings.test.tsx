// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/lib/toast'
import { PDA_LABEL_PRINTER_ID_KEY, syncPdaLabelPrinterBinding } from '@/lib/pdaRuntime'
import { getPrinterBindingsApi, usePrinterBindings } from './usePrinterBindings'
import type { User } from '@/types'

// 真实hook、登录后同步、权限store及API错误拦截器；只替换HTTP transport。
const originalAdapter = api.defaults.adapter
const previousAuth = useAuthStore.getState()
let calls: string[], forbidden: boolean, root: Root, host: HTMLDivElement, cache: QueryClient
let bindingQuery: ReturnType<typeof usePrinterBindings>
const user = (permissions: string[] = [], roleId = 99): User => ({ id: 9900, username: 'synthetic', realName: '合成打印权限测试', roleId, roleName: '合成角色', permissions })
function authenticate(permissions: string[] = [], roleId = 99) {
  useAuthStore.getState().login('synthetic-token', null, user(permissions, roleId))
}
function Probe() { bindingQuery = usePrinterBindings(); return <output>{bindingQuery.status}</output> }
async function mount() {
  await act(async () => root.render(<QueryClientProvider client={cache}><Probe /></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); calls = []; forbidden = false
  useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false })
  vi.spyOn(toast, 'error')
  api.defaults.adapter = async config => {
    calls.push(config.url ?? '')
    expect(config.url).toBe('/printer-bindings')
    if (forbidden) throw new AxiosError('无操作权限', 'ERR_BAD_REQUEST', config, undefined, { config, status: 403, statusText: 'Forbidden', headers: {}, data: { success: false, message: '无操作权限' } })
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { defaultBindings: { container_label: { printer_id: 7, printer_name: '合成打印机' } }, routes: [] } } }
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove()
  api.defaults.adapter = originalAdapter; useAuthStore.setState(previousAuth, true)
  localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks()
})
test.each([[], ['payment.view'], ['print.printer.manage']].map(permissions => ({ permissions })))('无查看权限$permissions：登录同步、hook和手动refetch均不发请求', async ({ permissions }) => {
  authenticate(permissions)
  expect(await syncPdaLabelPrinterBinding()).toBeNull()
  await mount()
  await act(async () => { await bindingQuery.refetch() })
  expect(calls).toEqual([]); expect(toast.error).not.toHaveBeenCalled()
})
test('未登录不拉绑定', async () => {
  expect(await syncPdaLabelPrinterBinding()).toBeNull(); await mount()
  expect(calls).toEqual([])
})
test.each([99, 1])('打印机查看权限或管理员%d仍加载并缓存标签打印机', async roleId => {
  authenticate(roleId === 1 ? [] : ['print.printer.view'], roleId)
  expect(await syncPdaLabelPrinterBinding()).toBe(7)
  expect(localStorage.getItem(PDA_LABEL_PRINTER_ID_KEY)).toBe('7')
  expect(await syncPdaLabelPrinterBinding()).toBe(7)
  expect(calls).toHaveLength(1)
  await mount()
  await vi.waitFor(() => expect(bindingQuery.isSuccess).toBe(true))
  expect(bindingQuery.data?.container_label.printer_name).toBe('合成打印机')
  expect(calls).toHaveLength(2)
})
test('偶发403保留query错误而不弹全局红框；登录同步静默', async () => {
  authenticate(['print.printer.view']); forbidden = true
  expect(await syncPdaLabelPrinterBinding()).toBeNull()
  await expect(getPrinterBindingsApi()).rejects.toMatchObject({ status: 403 })
  await mount(); await vi.waitFor(() => expect(bindingQuery.isError).toBe(true))
  expect(toast.error).not.toHaveBeenCalled()
})
test('撤权后手动重取不能绕过权限；已有PDA打印机仍可复用', async () => {
  authenticate(['print.printer.view']); await mount()
  await vi.waitFor(() => expect(bindingQuery.isSuccess).toBe(true))
  const count = calls.length
  await act(async () => useAuthStore.getState().updateUser({ permissions: [] }))
  await act(async () => { await bindingQuery.refetch() })
  expect(calls).toHaveLength(count)
  localStorage.setItem(PDA_LABEL_PRINTER_ID_KEY, '9')
  expect(await syncPdaLabelPrinterBinding()).toBe(9)
  expect(calls).toHaveLength(count)
})
