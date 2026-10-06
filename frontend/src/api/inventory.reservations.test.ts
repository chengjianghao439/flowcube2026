// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import api from './client'
import { getInventoryReservationsApi } from './inventory'
vi.mock('@/lib/pdaRuntime', () => ({ syncPdaLabelPrinterBinding: vi.fn(async () => null) }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/lib/apiOrigin', () => ({ applyErpApiBaseFromStorage: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
const original = api.defaults.adapter
afterEach(() => { api.defaults.adapter = original })
test('预占明细显式paged只请求指定页，不被payloadClient自动取齐', async () => {
  const adapter = vi.fn(async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { productId: 7, warehouseId: 8, list: [{ saleOrderId: 11 }], pagination: { page: 2, pageSize: 20, total: 100 } } } }))
  api.defaults.adapter = adapter
  const data = await getInventoryReservationsApi({ productId: 7, warehouseId: 8, page: 2, pageSize: 20 })
  expect(adapter).toHaveBeenCalledOnce(); expect(adapter.mock.calls[0]?.[0].params).toEqual({ productId: 7, warehouseId: 8, page: 2, pageSize: 20 })
  expect(data.list).toHaveLength(1); expect(data.pagination.total).toBe(100)
})
