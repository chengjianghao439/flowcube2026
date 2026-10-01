import { expect, test, vi } from 'vitest'
import { createKitApi, deleteKitApi, getKitApi, getKitsApi, updateKitApi } from './kits'
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
vi.mock('./client', () => ({ payloadClient: calls }))
test('列表真实分页上限100；当前版本详情不猜历史接口', async () => {
  await getKitsApi({ page: 2, pageSize: 20, keyword: '铰链' }); await getKitApi(7)
  expect(calls.get).toHaveBeenNthCalledWith(1, '/kits', expect.objectContaining({ params: { page: 2, pageSize: 20, keyword: '铰链' }, listMode: 'paged' }))
  expect(calls.get).toHaveBeenNthCalledWith(2, '/kits/7', expect.objectContaining({ skipGlobalError: true }))
})
test('写入携带稳定键；删除携带原revision；不发送DTO以外字段', async () => {
  const body = { code: 'K1', name: '套1', isActive: true, referenceUnitPrice: 20, components: [{ productId: 11, baseQty: 2 }] }
  const context = { requestKey: 'kit-original', baseURL: '/fixed-api', sessionGeneration: 4 }
  await createKitApi(body, context); await updateKitApi(7, { revision: 3, referenceUnitPrice: 100 }, context); await deleteKitApi(7, { revision: 3 }, context)
  const config = expect.objectContaining({ baseURL: '/fixed-api', _authSessionGeneration: 4, _erpApiFallbackTried: true, skipGlobalError: true, headers: { 'X-Request-Key': 'kit-original' } })
  expect(calls.post).toHaveBeenCalledWith('/kits', body, config)
  expect(calls.put).toHaveBeenCalledWith('/kits/7', { revision: 3, referenceUnitPrice: 100 }, config)
  expect(calls.delete).toHaveBeenCalledWith('/kits/7', expect.objectContaining({ data: { revision: 3 }, headers: { 'X-Request-Key': 'kit-original' } }))
})
test('资料读取使用原来源端点与登录代次并禁止候选服务器回退', async () => {
  calls.get.mockClear()
  const owner = { baseURL: '/server-a/api', userId: 7, sessionGeneration: 10 }
  await getKitApi(7, owner); await getKitsApi({ page: 1, pageSize: 20, keyword: '' }, undefined, owner)
  const fixed = expect.objectContaining({ baseURL: '/server-a/api', _authSessionGeneration: 10, _erpApiFallbackTried: true, skipGlobalError: true })
  expect(calls.get).toHaveBeenNthCalledWith(1, '/kits/7', fixed)
  expect(calls.get).toHaveBeenNthCalledWith(2, '/kits', fixed)
})
