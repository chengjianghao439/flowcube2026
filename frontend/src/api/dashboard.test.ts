// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import api, { payloadClient } from './client'
import { getCreditRiskPageApi, getLowStockPageApi } from './dashboard'
import { listPendingApprovalsApi } from './approvals'
import { getBarcodePrintRecordsApi } from './print-jobs'

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
      list: Array.from({ length: Math.min(pageSize, total - start) }, (_, i) => ({ id: start + i + 1, warehouseId: 1 })),
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

function paginatedAdapter(rows: (page: number) => unknown[], pageSize = 1, total = 2) {
  return vi.fn(async config => {
    const page = Number(config.params.page || 1)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: {
      list: rows(page), pagination: { page, pageSize, total },
    } } }
  })
}

test('低库存的 id 是商品而非行主键，同批跨仓同商品必须保留', async () => {
  api.defaults.adapter = paginatedAdapter(() => [{ id: 7, warehouseId: 1 }, { id: 7, warehouseId: 2 }], 2)
  expect((await getLowStockPageApi()).list).toEqual([{ id: 7, warehouseId: 1 }, { id: 7, warehouseId: 2 }])
})

test('低库存跨页同商品不同仓合法，同商品同仓重复即失败', async () => {
  api.defaults.adapter = paginatedAdapter(page => [{ id: 7, warehouseId: page }])
  expect((await getLowStockPageApi()).list).toHaveLength(2)
  api.defaults.adapter = paginatedAdapter(page => [{ id: 7, warehouseId: 1, quantity: page }])
  await expect(getLowStockPageApi()).rejects.toThrow('重复')
})

test('授信预警使用 customerId，重复客户失败，同名不同客户保留', async () => {
  api.defaults.adapter = paginatedAdapter(page => [{ customerId: 42, customerName: '客户', used: page }])
  await expect(getCreditRiskPageApi()).rejects.toThrow('重复')
  api.defaults.adapter = paginatedAdapter(page => [{ customerId: page, customerName: '客户' }])
  expect((await getCreditRiskPageApi()).list).toHaveLength(2)
})

test('待审批使用 taskId，同审批实例不同任务合法，同任务重复失败', async () => {
  api.defaults.adapter = paginatedAdapter(page => [{ instanceId: 8, taskId: page }])
  expect((await listPendingApprovalsApi({ page: 1, pageSize: 1 })).list).toHaveLength(2)
  api.defaults.adapter = paginatedAdapter(() => [{ instanceId: 8, taskId: 11 }])
  await expect(listPendingApprovalsApi({ page: 1, pageSize: 1 })).rejects.toThrow('重复')
})

test('调用方身份解析只在汇总层运行，不进入 Axios 配置或请求参数', async () => {
  const identity = vi.fn((row: unknown) => String((row as { code: number }).code))
  const request = paginatedAdapter(page => [{ code: page }])
  api.defaults.adapter = request
  await payloadClient.get('/dashboard/custom-fixture', { params: { page: 1, keyword: 'same' } }, identity)
  expect(identity).toHaveBeenCalledTimes(2)
  for (const [config] of request.mock.calls) {
    expect(Object.values(config)).not.toContain(identity)
    expect(config.params).toEqual({ page: expect.any(Number), pageSize: expect.any(Number), keyword: 'same' })
  }
})

test('已约定身份的分页接口缺少关键身份字段时明确失败，不绕过检测', async () => {
  api.defaults.adapter = paginatedAdapter(page => [{ id: page }])
  await expect(getLowStockPageApi()).rejects.toThrow('不完整')
  api.defaults.adapter = paginatedAdapter(page => [{ customerName: `客户${page}` }])
  await expect(getCreditRiskPageApi()).rejects.toThrow('不完整')
  api.defaults.adapter = paginatedAdapter(page => [{ instanceId: page }])
  await expect(listPendingApprovalsApi({ page: 1, pageSize: 1 })).rejects.toThrow('不完整')
})


for (const category of ['inbound', 'outbound', 'logistics'] as const) {
  test(`${category} 条码记录按 category/recordId 查重，同文案不同记录保留`, async () => {
    api.defaults.adapter = paginatedAdapter(page => [{ category, recordId: 9, title: `版本${page}` }])
    await expect(getBarcodePrintRecordsApi({ category, page: 1, pageSize: 1 })).rejects.toThrow('重复')
    api.defaults.adapter = paginatedAdapter(page => [{ category, recordId: page, title: '相同文案' }])
    expect((await getBarcodePrintRecordsApi({ category, page: 1, pageSize: 1 })).list).toHaveLength(2)
  })
}
