// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useDisposalHandlingOperation } from './useDisposalHandlingOperation'
import { HANDLING_STORAGE, readHandlingRecords } from '@/lib/disposalHandlingRecovery'
import type { HandlingSpec, HandlingSourceAck } from '@/types/disposal-handling'
const adapter = client.defaults.adapter, unknown: string[] = [], calls: InternalAxiosRequestConfig[] = []
const spec: HandlingSpec = {
  kind: 'source', draftIdentity: 'intent', intentUuid: '11111111-1111-4111-8111-111111111111',
  operationUuid: '22222222-2222-4222-8222-222222222222', requestKey: 'fixed',
  path: '/disposals/handling-sources', action: 'disposal.handling.source.create',
  body: { intentUuid: '11111111-1111-4111-8111-111111111111', operationUuid: '22222222-2222-4222-8222-222222222222', productId: 3, warehouseId: 8, unit: '个', handlingType: 1, quantity: 2 },
}
const ack: HandlingSourceAck = { id: 11, intentUuid: '11111111-1111-4111-8111-111111111111', productId: 3, warehouseId: 8, unit: '个', handlingType: 1, quantity: 2, revision: 1 }
function response(c: InternalAxiosRequestConfig, data: unknown) {
  return { config: c, headers: {}, status: 200, statusText: 'OK', data: { success: true, data } }
}
let post: (c: InternalAxiosRequestConfig) => Promise<unknown>, query: (c: InternalAxiosRequestConfig) => Promise<unknown>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); calls.length = 0; unknown.length = 0; setApiClientBaseURL('/a')
  useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: [] })
  post = async () => { throw Error('offline uncertainty') }
  query = async () => ({ status: 'not_found', data: null })
  client.defaults.adapter = async c => {
    calls.push(c)
    if (c.method === 'post' && c.url === spec.path) return response(c, await post(c))
    if (c.method === 'get' && c.url === `/disposals/handling-operations/${spec.operationUuid}`) return response(c, await query(c))
    unknown.push(`${c.method} ${c.url}`); throw Error('unknown endpoint')
  }
})
afterEach(() => { vi.restoreAllMocks(); client.defaults.adapter = adapter; localStorage.clear(); expect(unknown).toEqual([]) })
async function probe(run: (get: () => ReturnType<typeof useDisposalHandlingOperation>, draw: (active?: boolean) => Promise<void>) => Promise<void>) {
  let hook!: ReturnType<typeof useDisposalHandlingOperation>, active = true
  function Probe() { hook = useDisposalHandlingOperation('intent', active, () => true); return null }
  const host = document.createElement('div'), root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const draw = async (next = true) => { active = next; await act(async () => root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>)) }
  await draw()
  try { await run(() => hook, draw) } finally { await act(async () => root.unmount()); qc.clear() }
}
test('真实POST前完整保存；网络不明后只主动GET，不换键或另POST', async () => {
  await probe(async get => {
    await act(async () => { await get().submit(spec) })
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([`post ${spec.path}`])
    expect(readHandlingRecords()[0].body).toEqual(spec.body); expect(get().blocked).toBe(true)
    await act(async () => { await get().submit({ ...spec, requestKey: 'another', body: { ...spec.body, quantity: 9 } }); await get().queryOriginal() })
    expect(calls.filter(c => c.method === 'post')).toHaveLength(1); expect(get().blocked).toBe(true)
    expect(calls[0].baseURL).toBe('/a'); expect(calls[0].automaticReplay).toBe(false); expect(calls[0]._erpApiFallbackTried).toBe(true)
    expect(calls[0].headers.get('X-Request-Key')).toBe('fixed')
  })
})
test.each(['write', 'readback'])('持久%s失败零POST、草稿可修正且不清损坏历史', async fault => {
  if (fault === 'write') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('storage unavailable') })
  else {
    const original = Storage.prototype.getItem
    let written = false
    const set = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k,v) { if (k === HANDLING_STORAGE) written = true; set.call(this,k,v) })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k) { return k === HANDLING_STORAGE && written ? '[]' : original.call(this,k) })
  }
  await probe(async get => { await act(async () => { await get().submit(spec) }); expect(calls).toEqual([]); expect(get().error).toBeTruthy() })
})
function changeOwner(kind: string) {
  if (kind === 'server') { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') }
  else {
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, ...(kind === 'actor' ? { id: 10 } : { permissions: ['withdraw'] }) } })
    useAuthStore.setState({ user })
  }
}
test.each(['server', 'actor', 'permissions'])('confirmed持久钩子触发%s ABA时保confirmed、不清理；当前主动查询才能清理', async kind => {
  post = async () => ack
  const set = Storage.prototype.setItem
  let changed = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
    set.call(this, k, v)
    if (!changed && k === HANDLING_STORAGE && JSON.parse(v).some((r: { phase: string }) => r.phase === 'confirmed')) {
      changed = true
      changeOwner(kind)
    }
  })
  await probe(async get => {
    await act(async () => { await get().submit(spec) })
    expect(changed).toBe(true)
    expect(readHandlingRecords()).toHaveLength(1)
    expect(readHandlingRecords()[0].phase).toBe('confirmed')
    expect(readHandlingRecords()[0].result).toEqual(ack)
    expect(get().result).toBeNull()
    expect(get().canApply(ack)).toBe(false)
    expect(get().blocked).toBe(true)
    await act(async () => { await get().queryOriginal() })
    expect(readHandlingRecords()).toEqual([])
    expect(get().result).toEqual(ack)
    expect(calls.filter(c => c.method === 'post')).toHaveLength(1)
  })
})
test.each(['server','actor','permissions'])('%s ABA晚POST成功不清原记录、不应用旧ACK', async kind => {
  let resolve!: (v: unknown) => void
  post = () => new Promise(r => { resolve = r })
  await probe(async get => {
    let pending!: Promise<unknown>
    await act(async () => { pending = get().submit(spec); await new Promise(r => setTimeout(r,5)) })
    await act(async () => changeOwner(kind)); await act(async () => { resolve(ack); await pending })
    expect(readHandlingRecords()).toHaveLength(1); expect(get().result).toBeNull(); expect(get().canApply(ack)).toBe(false)
  })
})
test.each(['server','actor','permissions'])('%s ABA晚查询拒绝不污染当前error，记录保留', async kind => {
  let reject!: (e: Error) => void
  query = () => new Promise((_r,j) => { reject = j })
  await probe(async get => {
    await act(async () => { await get().submit(spec) })
    let pending!: Promise<unknown>
    await act(async () => { pending = get().queryOriginal(); await new Promise(r => setTimeout(r,5)) })
    await act(async () => changeOwner(kind)); await act(async () => { reject(Error('late old error')); await pending })
    expect(get().error).not.toContain('late old error'); expect(readHandlingRecords()).toHaveLength(1)
  })
})
test('隐藏KeepAlive晚成功不清记录；回当前账号主动查询仍合法且无新POST', async () => {
  let resolve!: (v: unknown) => void; post = () => new Promise(r => { resolve = r })
  query = async () => ({ status: 'success', data: ack, resourceType: 'disposal_handling_source', resourceId: 11 })
  await probe(async (get,draw) => {
    let pending!: Promise<unknown>
    await act(async () => { pending = get().submit(spec); await new Promise(r => setTimeout(r,5)) })
    await draw(false); await act(async () => { resolve(ack); await pending })
    expect(readHandlingRecords()).toHaveLength(1); await draw(true)
    await act(async () => { await get().queryOriginal() }); expect(readHandlingRecords()).toEqual([]); expect(get().result).toEqual(ack)
    expect(calls.filter(c => c.method === 'post')).toHaveLength(1)
  })
})
test.each(['confirmed-write','cleanup'])('成功后%s失败继续阻断，主动核对可清理原结果', async fault => {
  post = async () => ack
  const set = Storage.prototype.setItem
  let fail = true
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k,v) {
    if (fail && k === HANDLING_STORAGE && (fault === 'cleanup' ? v === '[]' : v.includes('confirmed'))) throw Error('storage confirmation failure')
    set.call(this,k,v)
  })
  await probe(async get => {
    await act(async () => { await get().submit(spec) }); expect(get().blocked).toBe(true); expect(readHandlingRecords()).toHaveLength(1)
    expect(readHandlingRecords()[0].phase).toBe(fault === 'cleanup' ? 'confirmed' : 'pending')
    fail = false; query = async () => ({ status:'success',data:ack,resourceType:'disposal_handling_source',resourceId:11 })
    await act(async () => { await get().queryOriginal() }); expect(readHandlingRecords()).toEqual([])
    expect(calls.filter(c => c.method === 'post')).toHaveLength(1)
  })
})
test('查询资源错配不清记录；撤写权重挂只有本人GET', async () => {
  await probe(async get => { await act(async () => { await get().submit(spec) }) })
  query = async () => ({ status:'success',data:ack,resourceType:'sale_order',resourceId:11 })
  await probe(async get => { await act(async () => { await get().queryOriginal() }); expect(readHandlingRecords()).toHaveLength(1); expect(get().error).toContain('身份不一致') })
  expect(calls.filter(c => c.method === 'post')).toHaveLength(1)
})

import { useProductQtyPolicies } from './useProductQtyPolicies'
import { captureHandlingOwner, handlingOwnerCurrent } from '@/lib/disposalHandlingRecovery'
test.each(['hidden', 'serverABA'])('H6数量策略%s晚返回不进入当前商品缓存', async kind => {
  let resolve!: () => void, enabled = true, allow = true
  const owner = captureHandlingOwner()
  client.defaults.adapter = async c => {
    calls.push(c)
    if (c.method !== 'get' || c.url !== '/products/qty-policies' || c.params.ids !== '3') {
      unknown.push(c.method + ' ' + c.url); throw Error('unexpected quantity read')
    }
    await new Promise<void>(r => { resolve = r })
    return response(c, [{ id: 3, allowDecimal: false }])
  }
  function Probe() {
    const policy = useProductQtyPolicies([3], { owner, isCurrent: () => enabled && handlingOwnerCurrent(owner) })
    allow = policy(3)
    return null
  }
  const root = createRoot(document.createElement('div')), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const draw = () => act(async () => root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>))
  try {
    await draw(); expect(resolve).toBeTruthy()
    await act(async () => { if (kind === 'hidden') enabled = false; else changeOwner('server') })
    await draw(); await act(async () => resolve()); await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(allow).toBe(true)
    expect(calls[0].baseURL).toBe('/a')
    expect(calls).toHaveLength(1)
  } finally { await act(async () => root.unmount()); qc.clear() }
})

import { postHandlingApi } from '@/api/disposal-handling'
test('storage钩子变更调用者body/key，真实POST仍用持久克隆body/key/原owner', async () => {
  const mutable = structuredClone(spec), saved: unknown[] = []
  const set = Storage.prototype.setItem
  post = async () => ack
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
    set.call(this, k, v)
    if (k === HANDLING_STORAGE && v.includes('pending')) {
      saved.push(JSON.parse(v))
      mutable.body.quantity = 9
      mutable.requestKey = 'changed-after-persist'
    }
  })
  await probe(async get => {
    await act(async () => { await get().submit(mutable, (body, key, config) => postHandlingApi(spec.path, body, key, config)) })
    expect(saved).toHaveLength(1)
    expect(typeof calls[0].data === 'string' ? JSON.parse(calls[0].data) : calls[0].data).toEqual(spec.body)
    expect(calls[0].headers.get('X-Request-Key')).toBe('fixed')
    expect(calls[0].baseURL).toBe('/a')
  })
})


test('真实数量策略隐藏恢复后旧请求不进入新活动缓存，新活动可读当前策略', async () => {
  const owner = captureHandlingOwner()
  let active = true, allow = true, resolveFirst!: () => void, count = 0
  client.defaults.adapter = async c => {
    calls.push(c)
    if (c.method !== 'get' || c.url !== '/products/qty-policies' || c.params.ids !== '3') {
      unknown.push(c.method + ' ' + c.url); throw Error('unexpected quantity read')
    }
    count++
    if (count === 1) {
      await new Promise<void>(r => { resolveFirst = r })
      return response(c, [{ id: 3, allowDecimal: false }])
    }
    return response(c, [{ id: 3, allowDecimal: true }])
  }
  function Probe() {
    const policy = useProductQtyPolicies([3], { owner, isCurrent: () => active && handlingOwnerCurrent(owner) })
    allow = policy(3)
    return null
  }
  const root = createRoot(document.createElement('div')), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const draw = () => act(async () => root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>))
  try {
    await draw(); expect(resolveFirst).toBeTruthy()
    active = false; await draw(); active = true; await draw()
    await act(async () => resolveFirst()); await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(allow).toBe(true)
    expect(count).toBe(2)
  } finally { await act(async () => root.unmount()); qc.clear() }
})
