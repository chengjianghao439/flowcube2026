// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { captureReorderOwner } from '@/lib/saleReorder'
import type { CreateSaleParams } from '@/types/sale'
import { PERMISSIONS } from '@/lib/permission-codes'
import { REPEAT_CREATE_STORAGE } from './useRepeatSaleCreate'
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
const payload: CreateSaleParams = { customerId: 4, customerName: '当前客户', warehouseId: 8, warehouseName: '当前仓', items: [] }
const posts: InternalAxiosRequestConfig[] = []
let response: 'unknown' | 'ack' | 'reject' | 'reject-proof' = 'unknown', status: unknown = { status: 'not_found' }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); localStorage.clear(); posts.length = 0; response = 'unknown'; status = { status: 'not_found' }
  setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, roleId: 1, permissions: ['*'] } as never)
  apiClient.defaults.adapter = async config => {
    if (config.method === 'get' && config.url?.includes('/system/request-status/')) return { data: { success: true, data: status }, status: 200, statusText: 'OK', headers: {}, config }
    if (config.url !== '/sale') throw new Error('禁止真实网络')
    posts.push(config)
    if (response === 'ack') return { data: { success: true, data: { id: 81, orderNo: 'S81' } }, status: 201, statusText: 'OK', headers: {}, config }
    const body = { success: false, message: '未确认', code: response === 'reject' ? 'VALIDATION_ERROR' : null, ...(response === 'reject-proof' ? { data: { saleCreateNotExecuted: true } } : {}) }
    throw new AxiosError('拒绝', 'ERR_BAD_RESPONSE', config, undefined, { data: body, status: response.startsWith('reject') ? 400 : 503, statusText: 'ERROR', headers: {}, config })
  }
})
afterEach(() => vi.restoreAllMocks())
async function harness(run: (hook: () => import('./useRepeatSaleCreate').RepeatSaleCreate) => Promise<void>) {
  const { useRepeatSaleCreate } = await import('./useRepeatSaleCreate')
  const owner = captureReorderOwner(), host = document.createElement('div'), root = createRoot(host), cache = new QueryClient()
  let hook: import('./useRepeatSaleCreate').RepeatSaleCreate
  function View() { hook = useRepeatSaleCreate(80, 'ordinary', owner, '/sale/new?sourceId=80'); return null }
  await act(async () => root.render(<QueryClientProvider client={cache}><View /></QueryClientProvider>))
  try { await run(() => hook) } finally { await act(async () => root.unmount()); cache.clear() }
}
test('5xx冻结原body/key；仅新鲜not_found手动原请求重试，同键改body不可新建', async () => {
  await harness(async h => {
    await act(async () => { await h().submit(payload) }); expect(h().blocked).toBe(true)
    await act(async () => { await h().submit({ ...payload, remark: '不该发出' }) }); expect(posts).toHaveLength(1)
    response = 'ack'; await act(async () => { await h().retry() }); expect(posts).toHaveLength(2)
    expect(posts[1].data).toBe(posts[0].data); expect(posts[1].headers['X-Request-Key']).toBe(posts[0].headers['X-Request-Key']); expect(h().result?.id).toBe(81)
  })
})
test('首发明确验证拒绝可修正；未知后的同一400仍冻结', async () => {
  await harness(async h => {
    response = 'reject'; await act(async () => { await h().submit(payload) }); expect(h().blocked).toBe(false)
    response = 'unknown'; await act(async () => { await h().submit({ ...payload, remark: '已修正' }) }); expect(h().blocked).toBe(true)
    response = 'reject'; await act(async () => { await h().retry() }); expect(h().blocked).toBe(true)
  })
})
test('服务首发明确回滚证据经真实HTTP错误信封解包，员工可修正再保存', async () => {
  await harness(async h => {
    response = 'reject-proof'; await act(async () => { await h().submit(payload) }); expect(h().blocked).toBe(false)
    expect(posts[0].headers['X-Sale-Repeat-Create']).toBe('1')
    response = 'ack'; await act(async () => { await h().submit({ ...payload, remark: '修正草稿' }) }); expect(h().result?.id).toBe(81)
    expect(posts[1].headers['X-Request-Key']).not.toBe(posts[0].headers['X-Request-Key'])
  })
})
test('恢复status必须安全新sale_order且resourceId===data.id，不认来源旧单或错误资源', async () => {
  await harness(async h => {
    await act(async () => { await h().submit(payload) })
    for (const bad of [{ resourceType: 'purchase_order', resourceId: 81, data: { id: 81 } }, { resourceType: 'sale_order', resourceId: 81, data: { id: 82 } }, { resourceType: 'sale_order', resourceId: 80, data: { id: 80, orderNo: 'S80' } }]) {
      status = { status: 'success', ...bad }; await act(async () => { await h().queryOriginal() }); expect(h().blocked).toBe(true); expect(h().result).toBeNull()
    }
  })
})
test('账号或服务器切走再回来，晚到成功不可应用；仍保留原请求', async () => {
  await harness(async h => {
    let release: (value: AxiosResponse) => void
    apiClient.defaults.adapter = config => { posts.push(config); return new Promise(resolve => { release = resolve }) }
    let sending: Promise<unknown>
    await act(async () => { sending = h().submit(payload); await Promise.resolve() })
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') })
    await act(async () => { release!({ data: { success: true, data: { id: 81, orderNo: 'S81' } }, status: 201, statusText: 'OK', headers: {}, config: posts[0] }); await sending! })
    expect(h().blocked).toBe(true); expect(h().result).toBeNull()
  })
})
test('重挂只保存查询身份且不自动POST；查询失败/pending/not_found均保留，缺完整body不可重试', async () => {
  await harness(async h => { await act(async () => { await h().submit(payload) }); expect(h().pending).toBe(true) })
  const record = JSON.parse(sessionStorage.getItem(REPEAT_CREATE_STORAGE)!)
  expect(JSON.stringify(record)).not.toContain('当前客户'); expect(record[0].requestKey).toBeTruthy()
  await harness(async h => {
    expect(h().blocked).toBe(true); expect(posts).toHaveLength(1); expect(h().canRetry).toBe(false)
    const originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = async () => { throw Error('查询网络失败') }
    await act(async () => { await h().queryOriginal() }); expect(h().pending).toBe(true)
    apiClient.defaults.adapter = originalAdapter
    for (const value of [{ status: 'pending' }, { status: 'not_found' }]) { status = value; await act(async () => { await h().retry() }); expect(h().pending).toBe(true); expect(posts).toHaveLength(1) }
    status = { status: 'success', resourceType: 'sale_order', resourceId: 81, data: { id: 81, orderNo: 'S81' } }
    await act(async () => { await h().queryOriginal() }); expect(h().result?.id).toBe(81); expect(h().canApply(h().result!)).toBe(false)
  })
})
test('达到7天仅查询，不发同键body；恢复result仍需真实sale_order新身份', async () => {
  await harness(async h => {
    await act(async () => { await h().submit(payload) })
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 24 * 60 * 60 * 1000)
    await act(async () => { await h().retry() }); expect(posts).toHaveLength(1); expect(h().pending).toBe(true); expect(h().canRetry).toBe(false)
    status = { status: 'success', resourceType: 'sale_order', resourceId: 81, data: { id: 81, orderNo: 'S81' } }
    await act(async () => { await h().queryOriginal() }); expect(h().result?.id).toBe(81)
  })
})
test('撤回创建/查看权限仍能本人查原结果；不能retry，回执不自动应用到失效草稿', async () => {
  const actor = useAuthStore.getState().user!
  useAuthStore.setState({ user: { ...actor, roleId: 2, permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.SALE_ORDER_VIEW] } })
  await harness(async h => {
    await act(async () => { await h().submit(payload) })
    await act(async () => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [] } }))
    await act(async () => { await h().retry() }); expect(posts).toHaveLength(1); expect(h().pending).toBe(true)
    status = { status: 'success', resourceType: 'sale_order', resourceId: 81, data: { id: 81, orderNo: 'S81' } }
    await act(async () => { await h().queryOriginal() }); expect(h().result?.id).toBe(81); expect(h().canApply(h().result!)).toBe(false)
  })
})
test('网络断连及无法识别的成功ACK仍冻结，不据当前表单猜结果', async () => {
  for (const kind of ['network', 'malformed']) {
    sessionStorage.clear()
    apiClient.defaults.adapter = async config => { posts.push(config); if (kind === 'network') throw Error('network lost'); return { data: { success: true, data: { id: 80, orderNo: '旧来源单' } }, status: 200, statusText: 'OK', config, headers: {} } }
    await harness(async h => { await act(async () => { await h().submit(payload) }); expect(h().pending).toBe(true); expect(h().blocked).toBe(true); expect(h().result).toBeNull() })
  }
})
test('先确认A的新单再改址B，旧结果身份立即隐藏，禁止拿A的ID跳B原单', async () => {
  await harness(async h => {
    response = 'ack'; await act(async () => { await h().submit(payload) }); expect(h().result?.id).toBe(81)
    const old = h(), answer = old.result!
    await act(async () => setApiClientBaseURL('/b'))
    expect(h().result).toBeNull(); expect(h().blocked).toBe(true); expect(old.canView(answer)).toBe(false)
    await act(async () => setApiClientBaseURL('/a')); expect(h().result).toBeNull()
  })
})
