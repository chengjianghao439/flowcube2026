import axios from 'axios'
import { expect, test, vi } from 'vitest'
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ sessionGeneration: 1, token: 'test' }) } }))
vi.mock('@/store/companyStore', () => ({ useCompanyStore: { getState: () => ({ companyId: 1 }) } }))
vi.mock('@/lib/platform', () => ({ IS_CAPACITOR_PDA: false }))
vi.mock('@/lib/authSession', () => ({ performSessionLogout: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => true }))
vi.mock('@/lib/pdaDeviceBinding', () => ({ getDeviceSession: () => null }))
vi.mock('./pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn() }))

test('通用 payloadClient HTTP 续页实际携带首次返回的 snapshotId 与原筛选条件', async () => {
  const requests: Record<string, unknown>[] = []
  axios.defaults.adapter = async config => {
    requests.push(config.params)
    const page = Number(config.params.page || 1)
    if (page === 2) expect(config.params.snapshotId).toBe('read-1')
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: {
      list: [{ id: page }], snapshotId: 'read-1', pagination: { page, pageSize: 1, total: 2 },
    } } }
  }
  const { payloadClient } = await import('./client')
  const result = await payloadClient.get<{ list: { id: number }[] }>('/inventory/procurement-plan', { params: { keyword: 'test' } })
  expect(result.list.map(row => row.id)).toEqual([1, 2])
  expect(requests).toEqual([{ keyword: 'test' }, { keyword: 'test', snapshotId: 'read-1', page: 2, pageSize: 1 }])
})
