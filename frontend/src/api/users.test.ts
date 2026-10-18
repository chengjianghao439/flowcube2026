import { expect, test, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn().mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 20, total: 0 } }))
vi.mock('./client', () => ({ default: { defaults: { baseURL: '/api' } }, payloadClient: { get } }))

import { getUsersApi, getUserOptionsApi } from './users'

test('front-end user queries always request hidden development accounts', async () => {
  await getUsersApi({ page: 1, pageSize: 20 })
  expect(get).toHaveBeenCalledWith('/users', { params: { page: 1, pageSize: 20, hideDevelopment: '1' }, listMode: 'summary' })
  await getUserOptionsApi()
  expect(get).toHaveBeenCalledWith('/users/options', { params: { hideDevelopment: '1' } })
})

// Other consumers (approval-flow user pickers) retain the original single batch.
test('only the management list explicitly opts into bounded full collection', async () => {
  get.mockClear()
  await getUsersApi({ pageSize: 500, keyword: '' })
  expect(get).toHaveBeenLastCalledWith('/users', { params: { pageSize: 500, keyword: '', hideDevelopment: '1' }, listMode: 'summary' })
  await getUsersApi({ page: 1, pageSize: 200, keyword: '' }, 'all')
  expect(get).toHaveBeenLastCalledWith('/users', { params: { page: 1, pageSize: 200, keyword: '', hideDevelopment: '1' }, baseURL: '/api', _authSessionGeneration: expect.any(Number), _erpApiFallbackTried: true, listMode: 'paged' })
})
