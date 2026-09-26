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

/**
 * 返货待出库列表是**调用方自己翻页**（page/offset）的接口，不是「拉全量」的列表。
 *
 * payloadClient.get 默认会把外部 page/pageSize 删掉、改由 collectAllRecords 从第 1 页
 * 起算（client.ts:414-421）。对含 `pagination` 的响应它会续批取齐——那是「拉全量」的语义；
 * 对不含 `pagination` 的响应它只发一次，但 `fetchBatch(1)` 已经把请求钉死在 page=1。
 * 两种情况下调用方传的 page=2 都不会出现在请求里：前端点「加载更多」拿到的还是第 1 页。
 *
 * 本测试直接断言**实际发出的请求参数**，而不是断言返回值——返回值在两种实现下都可能
 * 看起来「有一页数据」，只有请求参数能区分「真的翻了页」和「又请求了一次第 1 页」。
 */
test('返货待出库列表：翻第 2 页必须真的把 page=2 发给后端', async () => {
  const sent: Record<string, unknown>[] = []
  axios.defaults.adapter = async config => {
    sent.push({ ...config.params })
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      data: {
        success: true,
        data: {
          list: [{ id: 1 }],
          total: 25,
          page: Number(config.params.page),
          pageSize: Number(config.params.pageSize),
        },
      },
    }
  }
  const { getReturnOutPendingApi } = await import('./warehouse-tasks')
  const result = await getReturnOutPendingApi({ page: 2, pageSize: 100 })

  expect(sent).toEqual([{ page: 2, pageSize: 100 }])
  // 同时确认返回结构未被取齐逻辑改写（页面靠 total/page 判断还有没有下一页）
  expect(result.total).toBe(25)
  expect(result.list).toHaveLength(1)
})
