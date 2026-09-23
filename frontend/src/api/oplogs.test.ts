import { expect, test, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn().mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 20, total: 0 } }))
vi.mock('./client', () => ({ payloadClient: { get } }))
import { getOpLogsApi } from './oplogs'

test('operation log page requests hidden development actors', async () => {
  await getOpLogsApi({ page: 1, pageSize: 20 })
  expect(get).toHaveBeenCalledWith('/oplogs', { params: { page: 1, pageSize: 20, hideDevelopment: '1', hidePrintPolling: '1' } })
})
