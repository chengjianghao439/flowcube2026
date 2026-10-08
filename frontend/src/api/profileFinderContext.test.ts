import { beforeEach, expect, test, vi } from 'vitest'
import { getSuppliersApi } from './suppliers'
import { getSettingsApi } from './settings'

const get = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ payloadClient: { get } }))
beforeEach(() => { get.mockReset() })
test('供应商读取透传来源/登录代次/禁止回退/AbortSignal且保留查询参数', async () => {
  const config = { baseURL: '/original/api', _authSessionGeneration: 10, _erpApiFallbackTried: true, automaticReplay: false as const, skipGlobalError: true, signal: new AbortController().signal }
  const params = { pageSize: 500, keyword: '供应商' }
  await getSuppliersApi(params, config)
  expect(get).toHaveBeenCalledWith('/suppliers', { ...config, params })
})
test('系统加价率读取使用原来源；普通页面默认调用保持原参数形状', async () => {
  const config = { baseURL: '/original/api', _authSessionGeneration: 10, _erpApiFallbackTried: true, automaticReplay: false as const, skipGlobalError: true }
  await getSettingsApi(config)
  expect(get).toHaveBeenNthCalledWith(1, '/settings', config)
  await getSettingsApi(); await getSuppliersApi({ pageSize: 500 })
  expect(get).toHaveBeenNthCalledWith(2, '/settings')
  expect(get).toHaveBeenNthCalledWith(3, '/suppliers', { params: { pageSize: 500 } })
})
