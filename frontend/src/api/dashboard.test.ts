// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import api from './client'
import { getLowStockPageApi } from './dashboard'

vi.mock('@/lib/pdaRuntime', () => ({ syncPdaLabelPrinterBinding: vi.fn(async () => null) }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/lib/apiOrigin', () => ({ applyErpApiBaseFromStorage: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
const originalAdapter = api.defaults.adapter
afterEach(() => { api.defaults.adapter = originalAdapter })

test('风险计数只请求首批；打开明细仍获取全部记录', async () => {
  const requests = vi.fn(async config => {
    const page = Number(config.params.page || 1)
    const pageSize = Number(config.params.pageSize || 200)
    const total = 780
    const start = (page - 1) * pageSize
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: {
      list: Array.from({ length: Math.min(pageSize, total - start) }, (_, i) => ({ id: start + i + 1 })),
      pagination: { page, pageSize, total },
    } } }
  })
  api.defaults.adapter = requests
  const summary = await getLowStockPageApi(1, 'summary')
  expect(summary.pagination.total).toBe(780)
  expect(requests).toHaveBeenCalledOnce()
  requests.mockClear()
  const detail = await getLowStockPageApi()
  expect(detail.list).toHaveLength(780)
  expect(requests.mock.calls.length).toBeGreaterThan(1)
})
