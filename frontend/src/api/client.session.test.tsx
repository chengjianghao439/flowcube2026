// @vitest-environment jsdom
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/store/authStore'
import { useCompanyStore } from '@/store/companyStore'
import type { User } from '@/types'

vi.mock('@/lib/pdaRuntime', () => ({ syncPdaLabelPrinterBinding: vi.fn(async () => null) }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/lib/apiOrigin', () => ({ applyErpApiBaseFromStorage: vi.fn() }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => true, persistErpApiBaseAfterLogin: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const user: User = { id: 1, username: 'A', realName: 'A', roleId: 1, roleName: 'test' }
const calls: InternalAxiosRequestConfig[] = []
let transport: AxiosAdapter
let api: typeof import('./client').default
let useLogin: typeof import('@/hooks/useAuth').useLogin
let performSessionLogout: typeof import('@/lib/authSession').performSessionLogout
let ConsolidationPage: ComponentType
let root: Root | undefined
let login: ReturnType<typeof useLogin>
function ok(config: InternalAxiosRequestConfig, data: unknown = 'ok') {
  return { config, data: { success: true, data }, status: 200, statusText: 'OK', headers: {} }
}
function failure(config: InternalAxiosRequestConfig, status = 401, code?: string) {
  return new AxiosError('test response', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config), status, data: { success: false, code } })
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
async function mount(child: React.ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<QueryClientProvider client={queryClient}><HashRouter>{child}</HashRouter></QueryClientProvider>) })
}
function LoginProbe() { login = useLogin('/dashboard'); return null }
async function loginAsB() {
  await act(async () => { await login.mutateAsync({ username: 'B', password: 'local-adapter-only' }); await new Promise(resolve => setTimeout(resolve, 5)) })
}
beforeAll(async () => {
  axios.defaults.adapter = async config => { calls.push(config); return transport(config) }
  api = (await import('./client')).default
  useLogin = (await import('@/hooks/useAuth')).useLogin
  performSessionLogout = (await import('@/lib/authSession')).performSessionLogout
  ConsolidationPage = (await import('@/pages/accounting/consolidation')).default
})
beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  useAuthStore.getState().logout()
  useAuthStore.getState().login('A-access', 'A-refresh', user)
  useCompanyStore.setState({ companyId: 1, companyName: null })
  window.location.hash = '#/dashboard'
  transport = async config => {
    if (config.url === '/auth/login') return ok(config, { token: 'B-access', refreshToken: 'B-refresh', user: { ...user, id: 2, username: 'B' } })
    if (config.url === '/auth/refresh') return ok(config, { token: 'renewed', refreshToken: 'rotated' })
    return ok(config)
  }
})
afterEach(async () => {
  await act(async () => { root?.unmount(); root = undefined; queryClient.clear() })
  document.body.innerHTML = ''
})

test.each([401, 200, 403, 500])('真实退出和登录 hook 后，旧请求迟到 %s 不重放也不污染新会话', async status => {
  await mount(<LoginProbe />)
  const gate = deferred()
  const fallback = transport
  transport = async config => {
    if (config.url === '/sale/901') {
      if (config.headers.Authorization === 'Bearer A-access') {
        await gate.promise
        if (status !== 200) throw failure(config, status, status === 403 ? 'PDA_SESSION_REQUIRED' : undefined)
      }
      return ok(config)
    }
    return fallback(config)
  }
  const pending = api.delete('/sale/901').catch(error => error)
  await vi.waitFor(() => expect(calls.some(c => c.url === '/sale/901')).toBe(true))
  await act(async () => { performSessionLogout(); await new Promise(resolve => setTimeout(resolve, 5)) })
  await loginAsB()
  await act(async () => { gate.release(); await pending })
  expect(axios.isCancel(await pending)).toBe(true)
  expect(calls.filter(c => c.url === '/sale/901')).toHaveLength(1)
  expect(calls.filter(c => c.url === '/auth/refresh')).toHaveLength(0)
  expect(useAuthStore.getState().user?.username).toBe('B')
  expect(useAuthStore.getState().token).toBe('B-access')
})

test('同一会话续期不取消迟到成功结果，多个401共用续期', async () => {
  const gate = deferred()
  const successGate = deferred()
  const fallback = transport
  transport = async config => {
    if (config.url === '/earlier-success') { await successGate.promise; return ok(config, 'earlier') }
    if (config.url === '/auth/refresh') { await gate.promise; return fallback(config) }
    if (config.url?.startsWith('/write') && config.headers.Authorization === 'Bearer A-access') throw failure(config)
    return fallback(config)
  }
  const success = api.get('/earlier-success')
  const writes = [api.post('/write/1'), api.post('/write/2')]
  await vi.waitFor(() => expect(calls.some(c => c.url === '/auth/refresh')).toBe(true))
  gate.release()
  await Promise.all(writes)
  successGate.release()
  await expect(success).resolves.toMatchObject({ data: { data: 'earlier' } })
  expect(calls.filter(c => c.url === '/auth/refresh')).toHaveLength(1)
})

test.each([false, true])('退出并重新登录后，已在途续期失败=%s 不覆盖新会话', async fails => {
  await mount(<LoginProbe />)
  const gate = deferred()
  const fallback = transport
  transport = async config => {
    if (config.url === '/auth/refresh') { await gate.promise; if (fails) throw failure(config); return fallback(config) }
    if (config.url === '/old') throw failure(config)
    return fallback(config)
  }
  const pending = api.post('/old').catch(error => error)
  await vi.waitFor(() => expect(calls.some(c => c.url === '/auth/refresh')).toBe(true))
  await act(async () => { performSessionLogout(); await new Promise(resolve => setTimeout(resolve, 5)) })
  await loginAsB()
  await act(async () => { gate.release(); await pending })
  expect(axios.isCancel(await pending)).toBe(true)
  expect(useAuthStore.getState().token).toBe('B-access')
  expect(calls.filter(c => c.url === '/old')).toHaveLength(1)
})

test.each([false, true])('账套创建失败=%s 纳入真实 mutation，禁止重复/关闭/切换并刷新列表', async fails => {
  const gate = deferred()
  let created = false
  transport = async config => {
    if (config.url === '/accounting/companies' && config.method === 'post') { await gate.promise; if (fails) throw failure(config, 409, 'CONFLICT'); created = true; return ok(config, { id: 3, code: 'R2', name: '回归账套' }) }
    if (config.url === '/accounting/companies') return ok(config, { list: [{ id: 1, code: 'MAIN', name: '主账套', isActive: true }, ...(created ? [{ id: 3, code: 'R2', name: '回归账套', isActive: true }] : [])] })
    return ok(config, { companies: [] })
  }
  const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!
  await mount(<ConsolidationPage />)
  await act(async () => { button('新建账套').click() })
  for (const [placeholder, value] of [['如 SUB5', 'R2'], ['账套名称', '回归账套']]) {
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await act(async () => { button('创建').click(); button('创建').click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  try {
    await vi.waitFor(() => expect(calls.some(c => c.method === 'post' && c.url === '/accounting/companies')).toBe(true))
    expect(queryClient.isMutating()).toBe(1)
    expect(calls.filter(c => c.method === 'post' && c.url === '/accounting/companies')).toHaveLength(1)
    expect(button('取消').disabled).toBe(true)
    await act(async () => { button('取消').click(); button('关闭').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(() => useCompanyStore.getState().setCompany(2, '其他账套')).toThrow('有操作正在保存')
  } finally { await act(async () => { gate.release(); await new Promise(resolve => setTimeout(resolve, 25)) }) }
  if (fails) {
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(button('创建').disabled).toBe(false)
    expect(button('取消').disabled).toBe(false)
    expect(document.querySelector<HTMLInputElement>('input[placeholder="如 SUB5"]')?.value).toBe('R2')
  } else {
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(document.body.textContent).toContain('回归账套')
    const { toast } = await import('@/lib/toast')
    expect(toast.success).toHaveBeenCalledWith('已创建账套 R2')
    expect(toast.error).not.toHaveBeenCalled()
  }
  expect(queryClient.isMutating()).toBe(0)
  expect(useCompanyStore.getState().companyId).toBe(1)
})

test('会话代次仅在真实登录/退出变化，正常续期和持久化不改变归属', () => {
  const original = useAuthStore.getState().sessionGeneration
  useAuthStore.getState().setTokens('rotated-access', 'rotated-refresh')
  expect(useAuthStore.getState().sessionGeneration).toBe(original)
  expect(JSON.parse(sessionStorage.getItem('flowcube-auth-v3')!).state).not.toHaveProperty('sessionGeneration')
  useAuthStore.getState().logout()
  expect(useAuthStore.getState().sessionGeneration).toBe(original + 1)
  useAuthStore.getState().login('rotated-access', 'rotated-refresh', user)
  expect(useAuthStore.getState().sessionGeneration).toBe(original + 2)
})

test('调用后立即退出和同token重新登录也不把旧请求发送到新会话', async () => {
  const gate = deferred()
  transport = async config => { await gate.promise; throw failure(config) }
  const pending = api.post('/write-immediate').catch(error => error)
  useAuthStore.getState().logout()
  useAuthStore.getState().login('A-access', 'A-refresh', user)
  gate.release()
  expect(axios.isCancel(await pending)).toBe(true)
  expect(calls.map(c => c.url)).toEqual(['/write-immediate'])
})

test.each([false, true])('设备换票等待期间切换会话=%s，重试只属于原会话', async changeSession => {
  const { ensureDeviceSession } = await import('@/api/pda-session')
  const gate = deferred()
  vi.mocked(ensureDeviceSession).mockImplementationOnce(async () => { await gate.promise; return { token: 'device-new', expiresAt: '2099-01-01', deviceId: 1, warehouseId: 1, scopes: [] } })
  transport = async config => {
    if (config.headers['X-PDA-Session'] !== 'device-new') throw failure(config, 403, 'PDA_SESSION_REQUIRED')
    return ok(config)
  }
  const pending = api.post('/pda-write').catch(error => error)
  await vi.waitFor(() => expect(ensureDeviceSession).toHaveBeenCalledOnce())
  if (changeSession) { useAuthStore.getState().logout(); useAuthStore.getState().login('B-access', 'B-refresh', { ...user, id: 2 }) }
  gate.release()
  expect(axios.isCancel(await pending)).toBe(changeSession)
  expect(calls.filter(c => c.url === '/pda-write')).toHaveLength(changeSession ? 1 : 2)
})

test('上一次登录的设备初始化晚到，不覆盖后来登录的用户名记忆', async () => {
  const { syncPdaLabelPrinterBinding } = await import('@/lib/pdaRuntime')
  const gate = deferred()
  vi.mocked(syncPdaLabelPrinterBinding).mockImplementationOnce(async () => { await gate.promise; return null })
  await mount(<LoginProbe />)
  let earlier!: Promise<unknown>
  await act(async () => { earlier = login.mutateAsync({ username: 'A', password: 'local-only' }); await new Promise(resolve => setTimeout(resolve, 5)) })
  await act(async () => { performSessionLogout(); await new Promise(resolve => setTimeout(resolve, 5)) })
  await loginAsB()
  expect(localStorage.getItem('flowcube-saved-username')).toBe('B')
  await act(async () => { gate.release(); await earlier })
  expect(localStorage.getItem('flowcube-saved-username')).toBe('B')
})

test('同会话已正常换令牌后，旧业务首次401仍可续期并重放', async () => {
  const gate = deferred()
  const fallback = transport
  transport = async config => {
    if (config.url === '/late-401' && config.headers.Authorization === 'Bearer A-access') { await gate.promise; throw failure(config) }
    return fallback(config)
  }
  const pending = api.post('/late-401')
  useAuthStore.getState().setTokens('already-renewed', 'already-rotated')
  gate.release()
  await expect(pending).resolves.toMatchObject({ data: { data: 'ok' } })
  expect(calls.filter(c => c.url === '/late-401')).toHaveLength(2)
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
})
