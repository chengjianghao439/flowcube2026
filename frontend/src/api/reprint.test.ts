import { expect, test, vi } from 'vitest'
const client = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))
vi.mock('./client', () => ({ payloadClient: client }))
import { reprintBarcodeRecordApi } from './print-jobs'
import { reprintInboundTaskApi } from './inbound-tasks'
test('两入口把调用方原意图键和原服务器配置透传到HTTP', async () => {
  const config = { baseURL: '/original', headers: { 'X-Trace': 'synthetic' }, skipGlobalError: true }
  await reprintBarcodeRecordApi({ category: 'inbound', recordId: 3 }, config, 'same-key')
  await reprintInboundTaskApi(4, { mode: 'task' }, 'same-key', config)
  expect(client.post.mock.calls).toEqual([
    ['/print-jobs/barcodes/reprint', { category: 'inbound', recordId: 3 }, { ...config, headers: { 'X-Trace': 'synthetic', 'X-Request-Key': 'same-key' } }],
    ['/inbound-tasks/4/reprint', { mode: 'task' }, { ...config, headers: { 'X-Trace': 'synthetic', 'X-Request-Key': 'same-key' } }],
  ])
  expect(config.headers).toEqual({ 'X-Trace': 'synthetic' })
})
