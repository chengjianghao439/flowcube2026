import axios, { type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { CreateKitInput, KitDefinition } from '@/types/kits'
import type { CommercialBody, CommercialPreview } from '@/types/sale-commercial'
import apiClient from './client'
import { createKitApi, deleteKitApi, getKitApi, getKitsApi, updateKitApi } from './kits'
import { previewCommercialSaleApi } from './sale-commercial'

const adapter = apiClient.defaults.adapter
const transport = vi.fn<AxiosAdapter>()
const body = {
  code: 'K1', name: '套1', isActive: true, referenceUnitPrice: 20, components: [{ productId: 11, baseQty: 2 }],
} satisfies CreateKitInput
const kit = {
  id: 7, code: 'K1', name: '套1', isActive: true, deletedAt: null, revision: 1, currentVersionId: 19,
  version: {
    id: 19, kitId: 7, versionNo: 1, referenceUnitPrice: 20, createdBy: 4, createdAt: '2026-10-01T02:00:00Z',
    referenceBasis: 'version_product_a_snapshot_or_explicit_weights', referenceSnapshotAt: null,
    referenceBasisExplanation: '版本快照', components: [{
      id: 20, productId: 11, baseQty: 2, referencePrice: 10, amountWeight: '20', weightSource: 'product_a',
      sortNo: 1, productCode: 'P11', productName: '铰链', unit: '个', productActive: true, allowDecimal: false,
    }],
  },
} satisfies KitDefinition
const list = { list: [kit], pagination: { page: 2, pageSize: 20, total: 21 } }
const updated = { ...kit, revision: 2, currentVersionId: 21, version: { ...kit.version, id: 21, versionNo: 2, referenceUnitPrice: 100 } }
const deleted = { ...updated, revision: 3, isActive: false, deletedAt: '2026-10-02T02:00:00Z' }
const replies = new Map<string, unknown>([
  ['get /kits', list], ['get /kits/7', kit], ['post /kits', kit], ['put /kits/7', updated], ['delete /kits/7', deleted],
])

beforeEach(() => {
  transport.mockReset().mockImplementation(async (config) => {
    const route = `${config.method} ${config.url}`
    if (!replies.has(route)) throw new Error(`未预期成套请求 ${route}`)
    return { config, status: config.method === 'post' ? 201 : 200, statusText: 'OK', headers: {}, data: { success: true, data: replies.get(route) } }
  })
  apiClient.defaults.adapter = transport
})
afterEach(() => { apiClient.defaults.adapter = adapter })

test('成套列表发送原分页和筛选，详情返回当前版本与配件快照', async () => {
  const params = { page: 2, pageSize: 20, keyword: '铰链' }
  expect(await getKitsApi(params)).toEqual(list)
  expect(await getKitApi(7)).toEqual(kit)
  const [page, detail] = transport.mock.calls.map(([config]) => config)
  const url = new URL(axios.getUri(page), 'https://kit-fixture.invalid')
  expect(url.pathname).toBe('/api/kits')
  expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', pageSize: '20', keyword: '铰链' })
  expect(page.listMode).toBe('paged')
  expect(detail.skipGlobalError).toBe(true)
  expect(axios.getUri(detail)).toBe('/api/kits/7')
})

test('成套写入携带原键和版本，解包实际 HTTP 成功回执', async () => {
  const context = { requestKey: 'kit-original', baseURL: 'https://kits-original.invalid/api', sessionGeneration: useAuthStore.getState().sessionGeneration }
  const update = { revision: kit.revision, referenceUnitPrice: 100 }
  const remove = { revision: updated.revision }
  expect(await createKitApi(body, context)).toEqual(kit)
  expect(await updateKitApi(7, update, context)).toEqual(updated)
  expect(await deleteKitApi(7, remove, context)).toEqual(deleted)
  expect(transport.mock.calls.map(([config]) => ({
    url: axios.getUri(config), method: config.method, body: JSON.parse(String(config.data)) as unknown,
  }))).toEqual([
    { url: `${context.baseURL}/kits`, method: 'post', body },
    { url: `${context.baseURL}/kits/7`, method: 'put', body: update },
    { url: `${context.baseURL}/kits/7`, method: 'delete', body: remove },
  ])
  for (const [config] of transport.mock.calls) {
    expect(config.headers.get('X-Request-Key')).toBe(context.requestKey)
    expect(config).toMatchObject({ _authSessionGeneration: context.sessionGeneration, _erpApiFallbackTried: true, skipGlobalError: true })
  }
})

test('资料读取使用原来源端点与登录代次并禁止候选服务器回退', async () => {
  const owner = { baseURL: 'https://kits-original.invalid/api', userId: 7, sessionGeneration: useAuthStore.getState().sessionGeneration }
  await getKitApi(7, owner)
  await getKitsApi({ page: 1, pageSize: 20, keyword: '' }, undefined, owner)
  expect(transport).toHaveBeenCalledTimes(2)
  for (const [config] of transport.mock.calls) {
    expect(config).toMatchObject({ baseURL: owner.baseURL, _authSessionGeneration: owner.sessionGeneration, _erpApiFallbackTried: true, skipGlobalError: true })
  }
})

test('新单和已有单报价使用各自的接口与正文，返回提交页需要的报价', async () => {
  const owner = { baseURL: 'https://quote.invalid/api', userId: 7, sessionGeneration: useAuthStore.getState().sessionGeneration }
  const group = { kind: 'kit', lineKey: 'kit-a', kitVersionId: kit.currentVersionId, quantity: 2, priceSource: 'kit_default' } as const
  const order = { commercialModel: 'kit-v1', expectedRevision: 7, customerId: 11, warehouseId: 22,
    commercialGroups: [{ ...group, warehouseId: 23 }],
  } satisfies CommercialBody
  const fresh = { customerId: order.customerId, warehouseId: order.warehouseId, commercialGroups: [], physicalItems: [],
    amount: 40, canFulfillEntireVector: true, expected: null, readyDate: null,
    readyDateExplanation: '原报价', inventoryExplanation: '有现货',
  } satisfies CommercialPreview
  const saved = { ...fresh, amount: 42, canFulfillEntireVector: false, inventoryExplanation: '库存不足' }
  transport.mockImplementation(async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: {
    success: true, data: config.url === '/kits/preview' ? fresh : saved,
  } }))

  expect(await previewCommercialSaleApi(order, owner)).toEqual(fresh)
  expect(await previewCommercialSaleApi(order, owner, 80)).toEqual(saved)
  expect(transport.mock.calls.map(([config]) => ({
    url: axios.getUri(config), method: config.method, body: JSON.parse(String(config.data)) as unknown,
  }))).toEqual([
    { url: `${owner.baseURL}/kits/preview`, method: 'post', body: { customerId: 11, warehouseId: 22, groups: [group] } },
    { url: `${owner.baseURL}/sale/80/commercial-preview`, method: 'post', body: order },
  ])
})
