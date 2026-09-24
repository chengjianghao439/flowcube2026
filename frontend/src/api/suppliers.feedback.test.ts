import { expect, test, vi } from 'vitest'
import { createSupplierApi, updateSupplierApi } from './suppliers'

const api = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }))
vi.mock('./client', () => ({ payloadClient: api }))

test('供应商创建和编辑错误由页面单独提示，关闭 API 全局 toast', async () => {
  api.post.mockResolvedValue({ id: 1 })
  api.put.mockResolvedValue(null)
  await createSupplierApi({ name: '重复供应商' })
  await updateSupplierApi(1, { name: '重复供应商', isActive: true })
  expect(api.post).toHaveBeenCalledWith('/suppliers', { name: '重复供应商' }, { skipGlobalError: true })
  expect(api.put).toHaveBeenCalledWith('/suppliers/1', { name: '重复供应商', isActive: true }, { skipGlobalError: true })
})
