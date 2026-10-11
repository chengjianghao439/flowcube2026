import { beforeEach, expect, test, vi } from 'vitest'
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }))
vi.mock('./client', () => ({ payloadClient: api }))
import * as inbound from './inbound-tasks'
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue([]) })
test('编辑候选和完整来源核对固定原任务，排除本单占用', async () => {
  await inbound.getInboundEditPurchaseCandidatesApi(21, '来源', { baseURL: '/original', skipGlobalError: true })
  expect(api.get).toHaveBeenCalledWith('/inbound-tasks/21/edit-purchase-items', expect.objectContaining({ baseURL: '/original', params: { keyword: '来源', bounded: 1, page: 1, pageSize: 200 } }), expect.any(Function))
  await inbound.verifyInboundEditPurchaseSelection(21, [41, 42], { baseURL: '/original' })
  expect(api.get.mock.calls.at(-1)).toEqual(['/inbound-tasks/21/edit-purchase-items', expect.objectContaining({ baseURL: '/original', params: { purchaseItemIds: '41,42' } })])
})
test('编辑上下文和PUT使用完整原body及调用方稳定键', async () => {
  await inbound.getInboundTaskEditContextApi(21, { baseURL: '/original' })
  expect(api.get).toHaveBeenCalledWith('/inbound-tasks/21/edit-context', { baseURL: '/original' })
  const body = { remark: '', expectedEditFingerprint: 'baseline', items: [{ purchaseItemId: 41, qty: 2 }] }
  await inbound.updateInboundTaskApi(21, body, 'original-key', { baseURL: '/original', automaticReplay: false })
  await inbound.updateInboundTaskApi(21, body, 'original-key', { baseURL: '/original', automaticReplay: false })
  expect(api.put.mock.calls).toEqual(Array.from({ length: 2 }, () => ['/inbound-tasks/21', body, expect.objectContaining({ baseURL: '/original', automaticReplay: false, headers: { 'X-Request-Key': 'original-key' } })]))
})

test('完整800个来源ID以200分批核实且保留末行和原端点配置', async () => {
  api.get.mockImplementation((_url, config) => Promise.resolve(config.params.purchaseItemIds.split(',').map((id: string) => ({ purchaseItemId: Number(id) }))))
  const ids = Array.from({ length: 800 }, (_, i) => i + 1000), rows = await inbound.verifyInboundEditPurchaseSelection(21, ids, { baseURL: '/original', automaticReplay: false })
  expect(api.get).toHaveBeenCalledTimes(4); expect(rows.map(row => row.purchaseItemId)).toEqual(ids); expect(rows.at(-1)?.purchaseItemId).toBe(1799)
  for (const call of api.get.mock.calls) { expect(call[1].params.purchaseItemIds.split(',')).toHaveLength(200); expect(call[1]).toMatchObject({ baseURL: '/original', automaticReplay: false }) }
})


test('新建保留调用方原端点和配置，仅显式稳定键加入header；旧签名兼容', async () => {
  const body = { supplierId: 2, supplierName: '合成供应商', items: [{ purchaseItemId: 41, qty: 1.25 }] }
  const config = { baseURL: '/original', automaticReplay: false as const, headers: { 'X-Trace': 'synthetic' } }
  await inbound.createInboundTaskApi(body, config, 'create-original-key')
  await inbound.createInboundTaskApi(body, config, 'create-original-key')
  expect(api.post.mock.calls).toEqual(Array.from({ length: 2 }, () => ['/inbound-tasks', body, { ...config, headers: { 'X-Trace': 'synthetic', 'X-Request-Key': 'create-original-key' } }]))
  expect(config.headers).toEqual({ 'X-Trace': 'synthetic' })
  await inbound.createInboundTaskApi(body, config)
  expect(api.post.mock.calls.at(-1)).toEqual(['/inbound-tasks', body, config])
})
