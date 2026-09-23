import { expect, test, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn().mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 20, total: 0 } }))
vi.mock('./client', () => ({ payloadClient: { get } }))

import { getUsersApi, getUserOptionsApi } from './users'

test('front-end user queries always request hidden development accounts', async () => {
  await getUsersApi({ page: 1, pageSize: 20 })
  expect(get).toHaveBeenCalledWith('/users', { params: { page: 1, pageSize: 20, hideDevelopment: '1' }, listMode: 'summary' })
  await getUserOptionsApi()
  expect(get).toHaveBeenCalledWith('/users/options', { params: { hideDevelopment: '1' } })
})
