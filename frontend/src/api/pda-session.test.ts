// @vitest-environment jsdom
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { clearDeviceBinding, getDeviceCredential, getDeviceSession, initDeviceBinding, saveDeviceCredential, saveDeviceSession } from '@/lib/pdaDeviceBinding'
import type { User } from '@/types'

vi.mock('@/lib/platform', () => ({ IS_CAPACITOR_PDA: false }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => true }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

const user: User = { id: 1, username: 'A', realName: 'A', roleId: 1, roleName: 'test' }
let transport: AxiosAdapter
let ensureDeviceSession: typeof import('./pda-session').ensureDeviceSession
let renewDeviceSession: typeof import('./pda-session').renewDeviceSession
const calls: InternalAxiosRequestConfig[] = []
const session = (token: string) => ({ token, warehouseId: 1, expiresAt: null, scopes: [] })
function ok(config: InternalAxiosRequestConfig, token: string) {
  return { config, data: { success: true, data: { session_token: token, warehouse_id: 1, expires_at: null, scopes: [] } }, status: 200, statusText: 'OK', headers: {} }
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }

beforeAll(async () => {
  axios.defaults.adapter = async config => { calls.push(config); return transport(config) }
  ;({ ensureDeviceSession, renewDeviceSession } = await import('./pda-session'))
  await initDeviceBinding()
})
beforeEach(async () => {
  calls.length = 0
  await clearDeviceBinding()
  await saveDeviceCredential('test-device', 'local-adapter-only')
  await saveDeviceSession(session('A-device'))
  useAuthStore.getState().logout()
  useAuthStore.getState().login('A-access', 'A-refresh', user)
  transport = async config => ok(config, 'renewed-device')
})
afterEach(() => { vi.restoreAllMocks() })

test.each([false, true])('真实旧心跳迟到失败=%s，不清除新登录换得的设备票据', async fails => {
  const gate = deferred()
  transport = async config => {
    if (config.url === '/pda/sessions/renew') {
      await gate.promise
      if (fails) throw new AxiosError('offline', 'ECONNABORTED', config)
      return ok(config, 'A-late-device')
    }
    return ok(config, 'B-device')
  }
  const oldRenewal = renewDeviceSession()
  await vi.waitFor(() => expect(calls.some(c => c.url === '/pda/sessions/renew')).toBe(true))
  useAuthStore.getState().logout()
  useAuthStore.getState().login('B-access', 'B-refresh', { ...user, id: 2, username: 'B' })
  await ensureDeviceSession()
  expect(getDeviceSession()?.token).toBe('B-device')
  gate.release()
  expect(await oldRenewal).toBeNull()
  expect(getDeviceSession()?.token).toBe('B-device')
})

test('同一登录会话内旧心跳失败，不清除已被换新的设备票据', async () => {
  const gate = deferred()
  transport = async config => { await gate.promise; throw new AxiosError('offline', 'ECONNABORTED', config) }
  const oldRenewal = renewDeviceSession()
  await saveDeviceSession(session('newer-device'))
  gate.release()
  expect(await oldRenewal).toBeNull()
  expect(getDeviceSession()?.token).toBe('newer-device')
})

test('主动取消当前心跳保留仍有效的设备票据', async () => {
  transport = async () => { throw new axios.CanceledError('cancelled') }
  expect(await renewDeviceSession()).toBeNull()
  expect(getDeviceSession()?.token).toBe('A-device')
})

test('当前心跳正常失败仍清理旧票据，后续凭据换票可恢复', async () => {
  transport = async config => {
    if (config.url === '/pda/sessions/renew') throw new AxiosError('offline', 'ECONNABORTED', config)
    return ok(config, 'recovered-device')
  }
  expect(await renewDeviceSession()).toBeNull()
  expect(getDeviceSession()).toBeNull()
  expect((await ensureDeviceSession())?.token).toBe('recovered-device')
  expect(getDeviceSession()?.token).toBe('recovered-device')
})

test('当前心跳成功保存续期票据', async () => {
  expect((await renewDeviceSession())?.token).toBe('renewed-device')
  expect(getDeviceSession()?.token).toBe('renewed-device')
})

test.each([false, true])('真实旧凭据换票迟到失败=%s，不覆盖新登录票据或清理设备凭据', async fails => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const gate = deferred()
  transport = async config => {
    if (config.headers.Authorization === 'Bearer A-access') {
      await gate.promise
      if (fails) throw new AxiosError('inactive', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config, ''), status: 403, data: { code: 'PDA_DEVICE_NOT_ACTIVE' } })
      return ok(config, 'A-late-device')
    }
    return ok(config, 'B-device')
  }
  const oldEnsure = ensureDeviceSession()
  useAuthStore.getState().logout()
  useAuthStore.getState().login('B-access', 'B-refresh', { ...user, id: 2, username: 'B' })
  expect((await ensureDeviceSession())?.token).toBe('B-device')
  gate.release()
  expect(await oldEnsure).toBeNull()
  expect(getDeviceSession()?.token).toBe('B-device')
  expect(getDeviceCredential()?.deviceCode).toBe('test-device')
})

test('当前设备凭据被服务端明确拒绝时仍清理绑定', async () => {
  transport = async config => { throw new AxiosError('inactive', 'ERR_BAD_REQUEST', config, undefined, { ...ok(config, ''), status: 403, data: { code: 'PDA_DEVICE_NOT_ACTIVE' } }) }
  expect(await ensureDeviceSession()).toBeNull()
  expect(getDeviceSession()).toBeNull()
  expect(getDeviceCredential()).toBeNull()
})
