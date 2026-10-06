import { expect, test, vi } from 'vitest'
const client = vi.hoisted(() => ({ get: vi.fn(async (_url: string, _config: unknown, _identity: unknown) => ({ list: [], pagination: { total: 0 } })) }))
vi.mock('./client', () => ({ payloadClient: client }))
import { listPendingApprovalsApi } from './approvals'

test('完整审批页显式paged保留请求页码，首页brief仍为summary', async () => {
  await listPendingApprovalsApi({ page: 2, pageSize: 20 }, 'paged')
  expect(client.get.mock.calls[0]?.[1]).toEqual({ params: { page: 2, pageSize: 20 }, listMode: 'paged' })
  await listPendingApprovalsApi({ page: 1, pageSize: 5 }, true)
  expect(client.get.mock.calls[1]?.[1]).toEqual({ params: { page: 1, pageSize: 5 }, listMode: 'summary' })
  await listPendingApprovalsApi({ page: 1, pageSize: 20 })
  expect(client.get.mock.calls[2]?.[1]).toEqual({ params: { page: 1, pageSize: 20 } })
})
