// @vitest-environment jsdom
/**
 * 转采购单的**请求头层**契约（2026-09-29）。
 *
 * `convertRequisitionApi` 必须把**调用方传入的请求键**原样放进 `X-Request-Key`，
 * 而不是自己每次内部 `createRequestKey()` —— 否则「后台已成功、响应丢失」后的重试
 * 会带着新键被后端当成新请求，同一次转单意图被执行两遍。
 *
 * 本文件不 mock `@/api/purchase-requisitions`（测真实实现），只 mock 底层 client，
 * 直接断言**实际发出的请求头**。变异验证：把实现改回内部 `createRequestKey()` ⇒ 必红。
 */
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue({ data: null }) }))

vi.mock('./client', () => ({
  payloadClient: { get: vi.fn(), post: mocks.post, put: vi.fn(), delete: vi.fn() },
}))

import { convertRequisitionApi } from './purchase-requisitions'
import type { ConvertLine } from '@/types/purchase-requisition'

const lines: ConvertLine[] = [{ requisitionItemId: 11, quantity: 5, supplierId: 1, supplierName: '供应商1', unitPrice: 10 }]
const headerOf = (call: number) => (mocks.post.mock.calls[call][2] as { headers: Record<string, string> }).headers['X-Request-Key']

beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue({ data: null }) })

test('转单请求头使用调用方传入的键（不是内部生成）', async () => {
  await convertRequisitionApi(1, lines, 'KEY-EXTERNAL-1')
  expect(headerOf(0)).toBe('KEY-EXTERNAL-1')
})

test('两次调用传同一个键 ⇒ 请求头里的键相同（后端才能识别为同一次提交）', async () => {
  await convertRequisitionApi(1, lines, 'KEY-SAME')
  await convertRequisitionApi(1, lines, 'KEY-SAME')
  expect(headerOf(0)).toBe('KEY-SAME')
  expect(headerOf(1)).toBe('KEY-SAME')
})

test('两次调用传不同键 ⇒ 请求头随之不同（新意图）', async () => {
  await convertRequisitionApi(1, lines, 'KEY-A')
  await convertRequisitionApi(1, lines, 'KEY-B')
  expect(headerOf(0)).toBe('KEY-A')
  expect(headerOf(1)).toBe('KEY-B')
})
