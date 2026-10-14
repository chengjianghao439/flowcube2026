// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { webcrypto, createHash } from 'node:crypto'
import { useOutbound } from './useInventory'
import { outboundRequestAction } from './useInventoryOutboundRecovery'
import { useAuthStore } from '@/store/authStore'
import { setApiClientBaseURL } from '@/api/client'
import type { User } from '@/types'
const api = vi.hoisted(() => ({ post: vi.fn(), receipt: vi.fn() }))
vi.mock('@/api/inventory', async original => ({ ...await original<typeof import('@/api/inventory')>(), outboundApi: api.post }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.receipt }))
vi.mock('@/hooks/useInvalidate', () => ({ useInvalidate: () => vi.fn() }))
let root: Root, host: HTMLDivElement, operation: ReturnType<typeof useOutbound>, query: QueryClient
const body = { productId: 3, warehouseId: 7, quantity: 3, unitPrice: 5.1234, supplierId: null, remark: '合成原出库' }
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  function Probe() { operation = useOutbound(); return null }
  await act(async () => root.render(<QueryClientProvider client={query}><Probe /></QueryClientProvider>))
}
async function unmount() { await act(async () => root.unmount()); host.remove() }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  Object.defineProperty(navigator, 'locks', { value: { request: async (_name: string, options: unknown, fn?: (lock: object) => unknown) => (typeof options === 'function' ? options : fn!)({}) }, configurable: true })
  localStorage.clear(); api.post.mockReset(); api.receipt.mockReset()
  setApiClientBaseURL('/api'); useAuthStore.getState().login('synthetic', null, { id: 1, roleId: 1, permissions: ['inventory.adjust'] } as User)
  query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  await mount()
})
afterEach(async () => { await unmount(); query.clear(); vi.restoreAllMocks(); useAuthStore.getState().logout() })
async function failFirst() {
  api.post.mockRejectedValueOnce(Object.assign(new Error('合成服务暂不可用'), { status: 503 }))
  await act(async () => { await operation.mutateAsync(body).catch(() => {}) })
  return operation.recovery.record!
}
test.each([500, 502, 503, 504])('HTTP %s 保留完整原正文与键，改数量和重挂不能另发出库', async status => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('服务暂不可用'), { status }))
  await act(async () => { await operation.mutateAsync(body).catch(() => {}) })
  const original = operation.recovery.record!
  expect(original.body).toEqual(body); expect(operation.recovery.blocked).toBe(true)
  await act(async () => { await operation.mutateAsync({ ...body, quantity: 4 }).catch(() => {}) })
  expect(api.post).toHaveBeenCalledTimes(1)
  await unmount(); await mount()
  expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
  expect(api.post).toHaveBeenCalledTimes(1); expect(api.receipt).not.toHaveBeenCalled()
})
test('原回执not_found后仅同键同完整正文重试，成功库存回执确认后才开放下一笔', async () => {
  const original = await failFirst()
  api.receipt.mockResolvedValue({ status: 'not_found', data: null })
  api.post.mockResolvedValue({ beforeQty: 20, afterQty: 17 })
  await act(async () => { await operation.recovery.retry() })
  expect(api.receipt).toHaveBeenCalledWith(original.requestKey, original.action, expect.objectContaining({ baseURL: original.baseURL, automaticReplay: false }))
  expect(api.post.mock.calls[1][0]).toEqual(original.body); expect(api.post.mock.calls[1][1]).toBe(original.requestKey)
  expect(operation.recovery.blocked).toBe(false)
})
test('后台成功而客户端丢响应，核原回执结束，不重复POST', async () => {
  const original = await failFirst()
  api.receipt.mockResolvedValue({ status: 'success', resourceType: 'inventory', resourceId: 3, data: { beforeQty: 20, afterQty: 17 } })
  await act(async () => { await operation.recovery.query() })
  expect(api.post).toHaveBeenCalledTimes(1); expect(operation.recovery.record).toBeNull()
  expect(localStorage.getItem('flowcube-inventory-outbound-v1:terminal:' + encodeURIComponent(JSON.stringify([1, original.baseURL, original.requestKey])))).not.toBeNull()
})
test('首发明确400解除冻结，未决后重试409保留原键', async () => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('参数不合法'), { status: 400 }))
  await act(async () => { await operation.mutateAsync(body).catch(() => {}) })
  expect(operation.recovery.record).toBeNull()
  const original = await failFirst()
  api.receipt.mockResolvedValue({ status: 'not_found', data: null })
  api.post.mockRejectedValueOnce(Object.assign(new Error('当前拒绝'), { status: 409 }))
  await act(async () => { await operation.recovery.retry().catch(() => {}) })
  expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
})
test('查询异常、处理中、错商品或错数量均不确认原出库', async () => {
  const original = await failFirst()
  for (const receipt of [{ status: 'pending' }, { status: 'success', resourceId: 99, data: { beforeQty: 20, afterQty: 17 } }, { status: 'success', resourceId: 3, data: { beforeQty: 20, afterQty: 16 } }]) {
    api.receipt.mockResolvedValue(receipt)
    await act(async () => { await operation.recovery.query().catch(() => {}) })
    expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
  }
  api.receipt.mockRejectedValue(Object.assign(new Error('权限已变化'), { status: 403 }))
  await act(async () => { await operation.recovery.query().catch(() => {}) })
  expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
})
test('登出重登保留原键正文，换号与服务器不能使用旧回调重发', async () => {
  const original = await failFirst(), staleRetry = operation.recovery.retry
  await act(async () => { useAuthStore.getState().logout(); useAuthStore.getState().login('other', null, { id: 2, roleId: 1 } as User) })
  expect(operation.recovery.record).toBeNull()
  await act(async () => { await staleRetry().catch(() => {}) })
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => { useAuthStore.getState().login('again', null, { id: 1, roleId: 1 } as User) })
  expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
  const beforeEndpointRetry = operation.recovery.retry
  await act(async () => { setApiClientBaseURL('/other-api'); await beforeEndpointRetry().catch(() => {}) })
  expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => setApiClientBaseURL('/api'))
  expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
})
test('存储不可写及Web Locks缺失时首次不发POST', async () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota') })
  await act(async () => { await operation.mutateAsync(body).catch(() => {}) })
  expect(api.post).not.toHaveBeenCalled(); set.mockRestore()
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  await act(async () => { await operation.mutateAsync(body).catch(() => {}) })
  expect(api.post).not.toHaveBeenCalled()
})
test('损坏正文和同域多份原记录阻断，不按较新记录或一份成功猜另一份成功', async () => {
  const original = await failFirst()
  const prefix = 'flowcube-inventory-outbound-v1:request:'
  const oldKey = prefix + encodeURIComponent(JSON.stringify([1, original.baseURL, original.requestKey]))
  localStorage.setItem(oldKey, JSON.stringify({ ...original, body: { ...body, quantity: 4 } }))
  await act(async () => { window.dispatchEvent(new StorageEvent('storage')); await operation.recovery.retry().catch(() => {}) })
  expect(api.post).toHaveBeenCalledTimes(1)
  const second = { ...original, requestKey: 'second-original' }
  localStorage.setItem(prefix + encodeURIComponent(JSON.stringify([1, original.baseURL, second.requestKey])), JSON.stringify(second))
  await act(async () => window.dispatchEvent(new StorageEvent('storage')))
  expect(operation.recovery.error).toContain('多笔'); expect(operation.recovery.blocked).toBe(true)
})
test.each([{ unitPrice: 0, supplierId: 0, remark: '' }, { unitPrice: null, supplierId: null }, {}])('精确匹配后端空字段与0归一指纹：%j', async optional => {
  const raw = { productId: 3, warehouseId: 7, quantity: 3, ...optional }
  const expectedPayload = { productId: 3, quantity: 3, remark: null, supplierId: null, unitPrice: null, warehouseId: 7 }
  expect(await outboundRequestAction(raw)).toBe('inventory.manual-out.v2.' + createHash('sha256').update(JSON.stringify(expectedPayload)).digest('hex').slice(0, 16))
})

test('同一事件tick并发点击只发送一笔，结果未知仍保持同原键', async () => {
  api.post.mockRejectedValue(Object.assign(Error('合成丢响应'), { code: 'NETWORK_ERROR' }))
  await act(async () => {
    const first = operation.mutateAsync(body).catch(() => {})
    const second = operation.mutateAsync(body).catch(() => {})
    await Promise.all([first, second])
  })
  expect(api.post).toHaveBeenCalledOnce(); expect(operation.recovery.record?.body).toEqual(body)
})
test('本页观察过的原记录消失且无终态时，继续冻结而不生成新键', async () => {
  const original = await failFirst()
  localStorage.removeItem('flowcube-inventory-outbound-v1:request:' + encodeURIComponent(JSON.stringify([1, original.baseURL, original.requestKey])))
  await act(async () => window.dispatchEvent(new StorageEvent('storage')))
  expect(operation.recovery.blocked).toBe(true); expect(operation.recovery.error).toContain('未确认')
  await act(async () => { await operation.mutateAsync({ ...body, quantity: 4 }).catch(() => {}) })
  expect(api.post).toHaveBeenCalledOnce()
})
test('过期原键可查询，not_found后不会重建已清理的业务回执', async () => {
  const original = await failFirst(), expired = { ...original, createdAt: Date.now() - 8 * 86400000 }
  localStorage.setItem('flowcube-inventory-outbound-v1:request:' + encodeURIComponent(JSON.stringify([1, original.baseURL, original.requestKey])), JSON.stringify(expired))
  await act(async () => window.dispatchEvent(new StorageEvent('storage')))
  // Synthetic historic fixture must update its matching reserved identity too, not corrupt the new marker.
  localStorage.removeItem('flowcube-inventory-outbound-v1:terminal:' + encodeURIComponent(JSON.stringify([1, original.baseURL, original.requestKey])))
  api.receipt.mockResolvedValue({ status: 'not_found', data: null })
  await act(async () => { await operation.recovery.retry().catch(() => {}) })
  expect(api.receipt).toHaveBeenCalled(); expect(api.post).toHaveBeenCalledOnce()
  expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
})
test('迟到的后台成功不能清当前新账号的输入或解除原账号未决', async () => {
  let resolve!: (value: unknown) => void
  api.post.mockImplementation(() => new Promise(done => { resolve = done }))
  let first!: Promise<unknown>
  await act(async () => { first = operation.mutateAsync(body).catch(() => {}); await new Promise(done => setTimeout(done, 10)) })
  await act(async () => useAuthStore.getState().login('other', null, { id: 2, roleId: 1 } as User))
  await act(async () => { resolve({ beforeQty: 20, afterQty: 17 }); await first })
  expect(operation.recovery.lastOutcome).toBeNull()
  await act(async () => useAuthStore.getState().login('original', null, { id: 1, roleId: 1 } as User))
  expect(operation.recovery.record?.body.quantity).toBe(3)
})

test('compact完成墓碑保护旧标签；not_found不能重发，GET成功详情后才解冻',async()=>{
 const original=await failFirst(),requestKey='flowcube-inventory-outbound-v1:request:'+encodeURIComponent(JSON.stringify([1,original.baseURL,original.requestKey]))
 const {completeTerminalSlot}=await import('@/lib/criticalTerminalStorage')
 await completeTerminalSlot(requestKey.replace(':request:',':terminal:'),original,'success');localStorage.removeItem(requestKey)
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:requestKey})))
 expect(operation.recovery.record?.requestKey).toBe(original.requestKey)
 api.receipt.mockResolvedValue({status:'not_found',data:null});await act(async()=>{await operation.recovery.retry().catch(()=>{})});expect(api.post).toHaveBeenCalledOnce();expect(operation.recovery.blocked).toBe(true)
 api.receipt.mockResolvedValue({status:'success',data:{beforeQty:20,afterQty:17}});await act(async()=>{await operation.recovery.query()});expect(operation.recovery.blocked).toBe(false)
})
test('年轻终态预算满时PC首次不POST，也不删除其他账号未决',async()=>{
 for(let i=0;i<4096;i++)localStorage.setItem(`pda_owned_terminal_v3:2:${i}`,JSON.stringify({terminalVersion:2,requestHash:'a'.repeat(64),createdAt:Date.now(),state:'success'}))
 const pending='pda_owned_request_v3:2:unknown';localStorage.setItem(pending,'{"keep":"unknown"}')
 await act(async()=>{await expect(operation.mutateAsync(body)).rejects.toThrow('容量已满')})
 expect(api.post).not.toHaveBeenCalled();expect(localStorage.getItem(pending)).toBe('{"keep":"unknown"}')
})

test('最后await action SHA跨安全期时首次POST也停止，原正文仍保留',async()=>{
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now)
 const digest=webcrypto.subtle.digest.bind(webcrypto.subtle);let calls=0
 vi.spyOn(webcrypto.subtle,'digest').mockImplementation(async(...args)=>{const result=await digest(...args);if(++calls===3)vi.mocked(Date.now).mockReturnValue(now+7*86400000-120000);return result})
 await act(async()=>{await operation.mutateAsync(body).catch(()=>{})})
 expect(api.post).not.toHaveBeenCalled();expect(operation.recovery.record?.body).toEqual(body);expect(operation.recovery.message).toContain('安全重试时限')
})
