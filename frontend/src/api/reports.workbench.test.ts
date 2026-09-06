import { beforeEach, expect, test, vi } from 'vitest'
import { payloadClient } from './client'
import { getRoleWorkbenchApi } from './reports'
vi.mock('./client', () => ({ payloadClient: { get: vi.fn() } }))
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ sessionGeneration: 7 }) } }))
const batch = (id: number, hasMore: boolean, total = 2) => ({ summary: { totalAlerts: total }, hasMore, sections: [{ key: 'warehouse', cards: [{ key: 'receive', items: [{ id, title: `单据${id}`, badge: '待收货', subtitle: '同一类型' }] }] }] })
beforeEach(() => vi.resetAllMocks())
test('完整待办取齐后台批次，始终固定原登录会话', async () => {
  vi.mocked(payloadClient.get).mockResolvedValueOnce(batch(1, true)).mockResolvedValueOnce(batch(2, false))
  const result = await getRoleWorkbenchApi()
  expect(result.sections[0].cards[0].items.map(i => i.id)).toEqual([1, 2])
  expect(vi.mocked(payloadClient.get).mock.calls[1][1]).toMatchObject({ params: { batchPage: 2, batchSize: 200 }, _authSessionGeneration: 7 })
})
test('续批变化或重复必须拒绝，不能展示不完整待办', async () => {
  vi.mocked(payloadClient.get).mockResolvedValueOnce(batch(1, true)).mockResolvedValueOnce(batch(2, false, 3))
  await expect(getRoleWorkbenchApi()).rejects.toThrow('数量发生变化')
  vi.mocked(payloadClient.get).mockResolvedValueOnce(batch(1, true)).mockResolvedValueOnce(batch(1, false))
  await expect(getRoleWorkbenchApi()).rejects.toThrow('批次发生重复')
})
