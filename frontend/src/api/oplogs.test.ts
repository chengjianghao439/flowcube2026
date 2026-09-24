import { expect, test, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn().mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 20, total: 0 } }))
vi.mock('./client', () => ({ payloadClient: { get } }))
import { getOpLogsApi } from './oplogs'
import { formatApiPath } from '../utils/operationLogFormatters'

test('operation log page keeps server pagination and hides development actors', async () => {
  await getOpLogsApi({ page: 1, pageSize: 20 })
  expect(get).toHaveBeenCalledWith('/oplogs', { listMode: 'summary', params: { page: 1, pageSize: 20, hideDevelopment: '1', hidePrintPolling: '1' } })
})

test('authentication operation labels identify login and logout while details retain HTTP path', () => {
  expect(formatApiPath('/api/auth/login', 'POST', 200)).toBe('登录成功')
  expect(formatApiPath('/api/auth/login', 'POST', 401)).toBe('登录失败')
  expect(formatApiPath('/api/auth/logout', 'POST', 200)).toBe('退出登录')
  expect(formatApiPath('/api/auth/refresh', 'POST', 200)).toBe('POST /api/auth/refresh')
})
