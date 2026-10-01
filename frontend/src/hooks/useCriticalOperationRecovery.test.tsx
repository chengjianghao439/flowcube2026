// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
import { useCriticalOperationRecovery, currentRecoveryEndpoint } from './useCriticalOperationRecovery'
import { recoveryStorageKey, type RepackRecoveryRecord } from '@/lib/criticalOperationRecovery'
const api = vi.hoisted(() => ({ post: vi.fn(), query: vi.fn(), defaults: { baseURL: '/api' } }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults } }))
vi.mock('@/api/inventory', () => ({ repackPlasticBoxApi: api.post }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.query }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let owner = 92000
let canExecute = true
const hooks: ReturnType<typeof useCriticalOperationRecovery>[] = []
const confirmed = vi.fn()
function Probe({ index }: { index: number }) { hooks[index] = useCriticalOperationRecovery({ canExecute, onConfirmed: confirmed }); return null }
function login(id = owner) { act(() => useAuthStore.getState().login('test', null, { id, roleId: 1 } as User)) }
async function mount() { root = createRoot(document.createElement('div')); await act(async () => root!.render(<><Probe index={0} /><Probe index={1} /></>)) }
async function remount() { act(() => root?.unmount()); await mount() }
const success = (boxId = 4) => ({ boxId, boxRemainingAfter: 60, created: [{ containerId: 6, barcode: 'I6', qty: 20 }], printJobIds: [4], noPrinterCount: 0, renderFailedCount: 0 })
const record = (boxId = 4): RepackRecoveryRecord => ({ accountId: owner, boxId, action: `plastic_box.repack.${boxId}`, requestKey: `original-${owner}-${boxId}`, createdAt: '2026-10-01T00:00:00Z', endpoint: currentRecoveryEndpoint(), body: { perBoxQty: 20, boxCount: 2 } })
function seed(records = [record()]) { localStorage.setItem(recoveryStorageKey(owner), JSON.stringify({ version: 1, records })); return records }
async function run(boxId = 4) { await act(async () => { await hooks[0].run(boxId, { perBoxQty: 20, boxCount: 2 }) }) }
async function query(r = hooks[0].records[0]) { await act(async () => { await hooks[0].query(r) }) }
async function retry(r = hooks[0].records[0]) { await act(async () => { await hooks[0].retry(r) }) }
beforeEach(() => { owner++; localStorage.clear(); canExecute = true; confirmed.mockClear(); api.defaults.baseURL = '/api'; api.post.mockReset().mockRejectedValue(Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' })); api.query.mockReset().mockResolvedValue({ status: 'not_found', data: null }); login() })
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.restoreAllMocks(); act(() => useAuthStore.getState().logout()) })

test.each(['success', 'not_found'])('丢响应刷新后保存原身份，不自动 POST，显式查询 %s', async status => {
  await mount(); await run()
  const original = hooks[0].records[0]
  expect(original).toMatchObject({ accountId: owner, boxId: 4, action: 'plastic_box.repack.4', body: { perBoxQty: 20, boxCount: 2 } })
  await remount(); expect(api.post).toHaveBeenCalledTimes(1); expect(api.query).not.toHaveBeenCalled()
  expect(hooks[0].records[0]).toEqual(original)
  api.query.mockResolvedValue({ status, data: status === 'success' ? success() : null, resourceId: 4 })
  await query()
  expect(api.query).toHaveBeenCalledWith(original.requestKey, original.action, expect.objectContaining({ baseURL: original.endpoint, _erpApiFallbackTried: true }))
  expect(hooks[0].records.length).toBe(status === 'success' ? 0 : 1)
  if (status === 'success') expect(confirmed).toHaveBeenCalledWith(original, success())
})
test.each(['pending', 'not_found'])('%s 保留原键、原内容和阻断', async status => {
  const [original] = seed(); await mount(); api.query.mockResolvedValue({ status, data: null }); await query()
  expect(hooks[0].records[0]).toEqual(original); expect(hooks[0].blocked(4)).toBe(true)
})
test('明确 failed 清理原记录后才可新显式提交', async () => {
  const [original] = seed(); await mount(); api.query.mockResolvedValue({ status: 'failed', data: null }); await query()
  expect(hooks[0].records).toEqual([]); expect(confirmed).not.toHaveBeenCalled()
  await run(); expect(hooks[0].records[0].requestKey).not.toBe(original.requestKey)
})
test('首发 400 清理；未知原请求 retry 400 保留', async () => {
  await mount(); api.post.mockRejectedValue({ status: 400 }); await run(); expect(hooks[0].records).toEqual([])
  api.post.mockRejectedValue({ status: 504 }); await run(); const original = hooks[0].records[0]
  api.post.mockRejectedValue({ status: 403 }); await retry(); expect(hooks[0].records[0]).toEqual(original)
})
test.each(['same-hook', 'two-hooks'])('同 tick %s 同步 claim，只派发一笔 POST', async mode => {
  await mount(); let release!: (data: unknown) => void; api.post.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let first!: Promise<unknown>; let second!: Promise<unknown>
  await act(async () => {
    first = hooks[0].run(4, { perBoxQty: 20, boxCount: 2 })
    second = hooks[mode === 'same-hook' ? 0 : 1].run(4, { perBoxQty: 30, boxCount: 1 }).catch(e => e)
  })
  expect(api.post).toHaveBeenCalledTimes(1); expect(await second).toBeInstanceOf(Error)
  expect(hooks[1].records[0].body).toEqual({ perBoxQty: 20, boxCount: 2 })
  await act(async () => { release(success()); await first })
})
test('多盒独立保留，同盒不能覆盖，原 items 与外部输入断开', async () => {
  await mount(); const body = { items: [10, 20] }
  await act(async () => { const p = hooks[0].run(4, body); body.items[0] = 99; await p })
  await run(5); expect(hooks[0].records.map(r => r.boxId)).toEqual([4, 5])
  await expect(hooks[0].run(4, { items: [99] })).rejects.toThrow('结果待确认')
  await retry(hooks[0].records[0]); expect(api.post.mock.calls.at(-1)?.[1]).toEqual({ items: [10, 20] })
  api.query.mockResolvedValue({ status: 'success', data: success(), resourceId: 4 }); await query(hooks[0].records[0])
  expect(hooks[0].records.map(r => r.boxId)).toEqual([5])
})
test('保存失败阻止首发，不写出敏感自由字段', async () => {
  await mount(); const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  await act(async () => { await expect(hooks[0].run(4, { items: [20] })).rejects.toThrow('保存失败') })
  expect(api.post).not.toHaveBeenCalled(); expect(hooks[0].error).toContain('保存失败')
  storage.mockRestore()
  await act(async () => { await expect(hooks[0].run(4, { items: [20], remark: '秘密' } as never)).rejects.toThrow('参数不合法') })
  expect(localStorage.getItem(recoveryStorageKey(owner))).toBeNull()
})
test('读取失败阻断，不删除已保存原身份', async () => {
  const [original] = seed(); const raw = localStorage.getItem(recoveryStorageKey(owner))
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('读取失败') })
  await mount(); expect(hooks[0].error).toBeTruthy()
  await expect(hooks[0].run(5, { items: [20] })).rejects.toThrow(); expect(api.post).not.toHaveBeenCalled()
  read.mockRestore(); expect(localStorage.getItem(recoveryStorageKey(owner))).toBe(raw)
  act(() => hooks[0].reload()); expect(hooks[0].records[0]).toEqual(original)
})
test.each([
  { version: 2, records: [] }, { version: 1, records: [{ accountId: 1 }] }, { version: 1, records: 'invalid' },
])('未知/非法 schema 不静默删除或放行：%j', async value => {
  const raw = JSON.stringify(value); localStorage.setItem(recoveryStorageKey(owner), raw); await mount()
  expect(hooks[0].blocked(4)).toBe(true)
  await expect(hooks[0].run(4, { items: [20] })).rejects.toThrow(); expect(api.post).not.toHaveBeenCalled()
  expect(localStorage.getItem(recoveryStorageKey(owner))).toBe(raw)
})
test.each(['remove', 'set'])('业务确认后的 %s 清理失败保留阻断，不能再次 POST', async mode => {
  const originals = mode === 'remove' ? seed() : seed([record(), record(5)]); await mount()
  const fail = vi.spyOn(Storage.prototype, mode === 'remove' ? 'removeItem' : 'setItem').mockImplementation(() => { throw new Error('storage failure') })
  api.query.mockResolvedValue({ status: 'success', data: success(), resourceId: 4 }); await query(originals[0])
  expect(hooks[0].blocked(4)).toBe(true); expect(hooks[0].notices[originals[0].requestKey].cleanupPending).toBe(true)
  await expect(hooks[0].retry(originals[0])).rejects.toThrow('已确认')
  expect(api.post).not.toHaveBeenCalled(); expect(confirmed).toHaveBeenCalledOnce()
  fail.mockRestore(); act(() => hooks[0].clearConfirmed(originals[0]))
  expect(hooks[0].records.map(r => r.boxId)).toEqual(mode === 'remove' ? [] : [5])
})
test.each(['post', 'query'])('换账号时 %s 旧成功不改当前 UI/记录，不调用草稿回调', async operation => {
  let release!: (data: unknown) => void
  const [original] = seed(); await mount()
  const mock = operation === 'post' ? api.post : api.query
  mock.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let pending!: Promise<unknown>; await act(async () => { pending = operation === 'post' ? hooks[0].retry(original) : hooks[0].query(original) })
  login(owner + 1000); expect(hooks[0].records).toEqual([])
  await act(async () => { release(operation === 'post' ? success() : { status: 'success', data: success(), resourceId: 4 }); await pending })
  expect(confirmed).not.toHaveBeenCalled(); expect(hooks[0].records).toEqual([])
  login(); expect(hooks[0].records[0]).toEqual(original)
})
test('同账号重新登录的旧响应也作废，令牌续期仍接受', async () => {
  const [original] = seed(); await mount(); let release!: (data: unknown) => void
  api.query.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let pending!: Promise<unknown>; await act(async () => { pending = hooks[0].query(original) }); login()
  await act(async () => { release({ status: 'success', data: success(), resourceId: 4 }); await pending })
  expect(confirmed).not.toHaveBeenCalled(); expect(hooks[0].records[0]).toEqual(original)
  api.query.mockResolvedValue({ status: 'success', data: success(), resourceId: 4 })
  act(() => useAuthStore.getState().setTokens('renewed', null)); await query(); expect(confirmed).toHaveBeenCalledOnce()
})
test('撤销权限只允许查询；查询失败/撤权保留 unknown', async () => {
  const [original] = seed(); canExecute = false; await mount()
  await expect(hooks[0].retry(original)).rejects.toThrow('无还原整件权限')
  api.query.mockRejectedValue({ status: 403 }); await query(); expect(hooks[0].records[0]).toEqual(original)
  expect(hooks[0].notices[original.requestKey].message).toContain('待确认'); expect(api.post).not.toHaveBeenCalled()
})
test('实际 /api origin 规范化与绝对桌面 endpoint 固定配置；切端点不投新服务器', async () => {
  expect(currentRecoveryEndpoint()).toBe(new URL('/api', window.location.origin).href)
  api.defaults.baseURL = 'https://desktop.test/api/'; const [original] = seed(); await mount()
  await retry(); expect(api.post).toHaveBeenCalledWith(4, original.body, original.requestKey, undefined, expect.objectContaining({ baseURL: 'https://desktop.test/api', _erpApiFallbackTried: true }))
  api.defaults.baseURL = 'https://other.test/api'
  await expect(hooks[0].query(original)).rejects.toThrow('服务器'); await expect(hooks[0].retry(original)).rejects.toThrow('服务器')
  expect(api.post).toHaveBeenCalledTimes(1); expect(api.query).not.toHaveBeenCalled(); expect(hooks[0].records[0]).toEqual(original)
})
test('查询在途端点切换，旧响应不能确认或清除', async () => {
  const [original] = seed(); await mount(); let release!: (data: unknown) => void
  api.query.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let pending!: Promise<unknown>; await act(async () => { pending = hooks[0].query(original) })
  api.defaults.baseURL = 'https://other.test/api'
  await act(async () => { release({ status: 'success', data: success(), resourceId: 4 }); await pending })
  expect(confirmed).not.toHaveBeenCalled(); expect(hooks[0].records[0]).toEqual(original)
})
test.each(['resource', 'data-box'])('成功归属 %s 不匹配时保留，不 patch 错盒', async kind => {
  const [original] = seed(); await mount(); api.query.mockResolvedValue({ status: 'success', data: success(kind === 'data-box' ? 5 : 4), resourceId: kind === 'resource' ? 5 : 4 }); await query()
  expect(hooks[0].records[0]).toEqual(original); expect(confirmed).not.toHaveBeenCalled()
})
test('成功载荷字段残缺只确认状态，回调无 patch 数据', async () => {
  const [original] = seed(); await mount(); api.query.mockResolvedValue({ status: 'success', data: { boxId: 4, boxRemainingAfter: '60' }, resourceId: 4 }); await query()
  expect(confirmed).toHaveBeenCalledWith(original, null); expect(hooks[0].records).toEqual([])
})

test('旧回执不能清理同键但身份/参数已被替换的记录', async () => {
  const [original] = seed(); await mount(); let release!: (data: unknown) => void
  api.query.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let pending!: Promise<unknown>; await act(async () => { pending = hooks[0].query(original) })
  const replacement = { ...original, createdAt: '2026-10-01T01:00:00Z', body: { items: [15] } }
  seed([replacement]); act(() => hooks[0].reload())
  await act(async () => { release({ status: 'success', data: success(), resourceId: 4 }); await pending })
  expect(hooks[0].records[0]).toEqual(replacement); expect(confirmed).not.toHaveBeenCalled()
})
test('同 tick 撤权先于 React 重渲染也拦住原内容 retry', async () => {
  const [original] = seed(); await mount()
  let attempted!: Promise<unknown>
  act(() => {
    useAuthStore.getState().updateUser({ roleId: 5, permissions: [] })
    attempted = hooks[0].retry(original).catch(e => e)
  })
  expect(await attempted).toBeInstanceOf(Error); expect(api.post).not.toHaveBeenCalled()
})

test('桌面 file origin 为 null 时，仍可规范化实际绝对 API 地址', async () => {
  const { normalizeRecoveryEndpoint } = await import('@/lib/criticalOperationRecovery')
  expect(normalizeRecoveryEndpoint('https://desktop.test/api/', 'null')).toBe('https://desktop.test/api')
})
test('响应到达前磁盘原记录被替换，即使尚未触发 storage event 也不调用旧回调', async () => {
  const [original] = seed(); await mount(); let release!: (data: unknown) => void
  api.query.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let pending!: Promise<unknown>; await act(async () => { pending = hooks[0].query(original) })
  const replacement = { ...original, requestKey: 'replacement', body: { items: [15] } }
  seed([replacement])
  await act(async () => { release({ status: 'success', data: success(), resourceId: 4 }); await pending })
  expect(confirmed).not.toHaveBeenCalled(); expect(hooks[0].records.some(r => r.requestKey === replacement.requestKey)).toBe(true)
})

test('端点在途变更作废旧响应后，回原服务器重开可再次查询，不留下永久 busy', async () => {
  const [original] = seed(); await mount(); let release!: (data: unknown) => void
  api.query.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let pending!: Promise<unknown>; await act(async () => { pending = hooks[0].query(original) })
  api.defaults.baseURL = 'https://other.test/api'
  await act(async () => { release({ status: 'success', data: success(), resourceId: 4 }); await pending })
  api.defaults.baseURL = '/api'; await remount()
  expect(hooks[0].notices[original.requestKey].busy).toBe(false)
})

test.each(['success', 'failed'])('同资源 ID 但 resourceType=sale_order 的 %s 回执保持原盒 unknown', async status => {
  const [original] = seed(); await mount()
  api.query.mockResolvedValue({ status, data: status === 'success' ? success() : null, resourceId: 4, resourceType: 'sale_order' })
  await query()
  expect(hooks[0].records[0]).toEqual(original)
  expect(hooks[0].blocked(4)).toBe(true)
  expect(confirmed).not.toHaveBeenCalled()
})
test.each(['999', '4', null])('成功载荷显式 boxId=%j 不是原 numeric ID，不能当残缺结构确认', async boxId => {
  const [original] = seed(); await mount()
  api.query.mockResolvedValue({ status: 'success', data: { ...success(), boxId }, resourceId: 4, resourceType: 'inventory_container' })
  await query()
  expect(hooks[0].records[0]).toEqual(original)
  expect(confirmed).not.toHaveBeenCalled()
})
