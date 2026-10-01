import { beforeEach, expect, test, vi } from 'vitest'
import { executeCommercialSaleApi, getCommercialSaleApi, previewCommercialSaleApi } from './sale-commercial'
import type { CommercialBody, CommercialOperationPlan } from '@/types/sale-commercial'
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
vi.mock('./client', () => ({ payloadClient: calls }))
const owner = { baseURL: '/original-api', userId: 9, sessionGeneration: 7 }
const body: CommercialBody = {
  commercialModel: 'kit-v1',
  expectedRevision: 4,
  customerId: 1,
  warehouseId: 2,
  commercialGroups: [
    { kind: 'kit', lineKey: 'a', kitVersionId: 19, warehouseId: 2, quantity: 1, priceSource: 'manual', unitPrice: 100 },
    {
      kind: 'ordinary',
      lineKey: 'b',
      productId: 11,
      warehouseId: 3,
      quantity: 2,
      entryUnit: '包',
      priceSource: 'manual',
      unitPrice: 12.3456
    }
  ]
}
beforeEach(() => vi.clearAllMocks())
test('new quote uses distinct groups schema while saved quote retains formal body/revision and separate warehouse', async () => {
  await previewCommercialSaleApi(body, owner)
  expect(calls.post).toHaveBeenLastCalledWith(
    '/kits/preview',
    { customerId: 1, warehouseId: 2, groups: body.commercialGroups.map(({ warehouseId: _warehouseId, ...g }) => g) },
    expect.objectContaining({ baseURL: '/original-api', _authSessionGeneration: 7, _erpApiFallbackTried: true })
  )
  await previewCommercialSaleApi(body, owner, 80)
  expect(calls.post).toHaveBeenLastCalledWith('/sale/80/commercial-preview', body, expect.anything())
  await getCommercialSaleApi(80, owner)
  expect(calls.get).toHaveBeenLastCalledWith(
    '/sale/80',
    expect.objectContaining({ baseURL: owner.baseURL, _authSessionGeneration: 7, _erpApiFallbackTried: true })
  )
})
test('all critical endpoints preserve marker/revision, body and original key', async () => {
  for (const action of ['create', 'update', 'adjust', 'ship', 'cancel', 'reserve', 'release', 'delete'] as const) {
    const data = ['create', 'update', 'adjust'].includes(action)
      ? body
      : {
          commercialModel: 'kit-v1',
          expectedRevision: 4,
          ...(action === 'ship' ? { groups: [{ groupId: 8, qty: 1 }] } : {})
        }
    const plan = {
      ...owner,
      requestKey: 'original-key',
      operation: { action, id: 80, body: data }
    } as CommercialOperationPlan
    await executeCommercialSaleApi(plan)
    const method = action === 'delete' ? calls.delete : ['update', 'adjust'].includes(action) ? calls.put : calls.post
    const last = method.mock.calls.at(-1)!
    expect(last[0]).toBe(
      action === 'create' ? '/sale' : action === 'update' || action === 'delete' ? '/sale/80' : `/sale/80/${action}`
    )
    expect(action === 'delete' ? last[1].data : last[1]).toEqual(data)
    expect(last[action === 'delete' ? 1 : 2]).toMatchObject({
      baseURL: '/original-api',
      _authSessionGeneration: 7,
      _erpApiFallbackTried: true,
      headers: { 'X-Request-Key': 'original-key' }
    })
  }
})
