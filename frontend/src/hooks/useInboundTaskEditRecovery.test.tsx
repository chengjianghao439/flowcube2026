// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as hooks from './useInboundTasks'
import { validInboundEditBody } from './useInboundTaskEditRecovery'
import { useAuthStore } from '@/store/authStore'
import { getApiClientBaseURL, setApiClientBaseURL } from '@/api/client'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { User } from '@/types'
import type { UpdateInboundTaskParams } from '@/types/inbound-tasks'
const api = vi.hoisted(() => ({ put: vi.fn(), query: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/api/inbound-tasks', () => ({ updateInboundTaskApi: api.put }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.query }))
vi.mock('@/hooks/useInvalidate', () => ({ useInvalidate: () => api.invalidate }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined, userId = 77000, active = true
const views: ReturnType<typeof hooks.useInboundTaskEditRecovery>[] = []
const body = (): UpdateInboundTaskParams => ({ remark: '原备注', expectedEditFingerprint: 'baseline-21', items: [{ purchaseItemId: 41, qty: 2 }] })
const success = (id = 21) => ({ taskId: id, taskNo: `IN-${id}`, expectedEditFingerprint: 'new-baseline' })
function login(id = userId, permissions = [PERMISSIONS.INBOUND_ORDER_UPDATE, PERMISSIONS.INBOUND_ORDER_VIEW]) { act(() => useAuthStore.getState().login('test', null, { id, roleId: 99, permissions } as User)) }
function Probe({ id, index }: { id: number; index: number }) { views[index] = hooks.useInboundTaskEditRecovery(id, active); return null }
async function mount(ids = [21, 21]) { root = createRoot(document.createElement('div')); await act(async () => root!.render(<>{ids.map((id, index) => <Probe key={index} id={id} index={index} />)}</>)) }
async function remount(ids = [21, 21]) { await act(async () => root?.unmount()); await mount(ids) }
async function submit(index = 0, payload = body()) { await act(async () => { await views[index].submit(payload) }) }
async function query(index = 0) { await act(async () => { await views[index].queryOriginal() }) }
async function retry(index = 0) { await act(async () => { await views[index].retry() }) }
const storageKey = 'flowcube-inbound-edit-v1'
const snapshot = () => JSON.stringify(Object.keys(localStorage).filter(key => key.startsWith(`${storageKey}:request:`)).sort().map(key => [key, localStorage.getItem(key)]))
beforeEach(() => { userId++; active = true; localStorage.clear(); setApiClientBaseURL('/api'); api.put.mockReset().mockRejectedValue(Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' })); api.query.mockReset().mockResolvedValue({ status: 'not_found', data: null }); api.invalidate.mockClear(); login() })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; act(() => useAuthStore.getState().logout()); vi.restoreAllMocks() })
test('丢响应刷新保留账号/原端点/任务/action/完整body/key，不自动写；查询成功安全清理', async () => {
  await mount(); await submit(); const original = views[0].pendingRecord
  expect(original).toMatchObject({ taskId: 21, userId, action: 'inbound.update.21', body: body(), method: 'put', path: '/inbound-tasks/21' })
  await remount(); expect(api.put).toHaveBeenCalledTimes(1); expect(api.query).not.toHaveBeenCalled(); expect(views[0].pendingRecord).toEqual(original)
  api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 21, data: success() }); await query()
  expect(api.query).toHaveBeenCalledWith(original!.requestKey, 'inbound.update.21', expect.objectContaining({ baseURL: original!.baseURL, automaticReplay: false, _erpApiFallbackTried: true }))
  expect(views[0].pendingRecord).toBeNull(); expect(views[0].result).toEqual(success()); expect(api.invalidate).toHaveBeenCalled()
})
test('not_found主动核对后显式重试使用同key同body；重试4xx仍未知', async () => {
  await mount(); const payload = body(); let pending!: Promise<unknown>
  await act(async () => { pending = views[0].submit(payload); payload.items[0].qty = 99; await pending })
  const original = views[0].pendingRecord!
  await remount(); await retry(); expect(api.put).toHaveBeenCalledTimes(1)
  await query(); expect(views[0].canRetry).toBe(true); api.put.mockRejectedValue({ status: 400 }); await retry()
  expect(api.put.mock.calls.at(-1)).toEqual([21, original.body, original.requestKey, expect.objectContaining({ baseURL: original.baseURL, automaticReplay: false })])
  expect(views[0].pendingRecord).toEqual(original); expect(views[0].blocked).toBe(true)
})
test.each([400, 403, 409])('首发确定%s保留输入可纠正，下一显式请求换key', async status => {
  await mount(); api.put.mockRejectedValue({ status, message: '拒绝', data: { inboundEditNotExecuted: true } }); await submit(); const old = api.put.mock.calls[0][2]
  expect(views[0].pendingRecord).toBeNull(); expect(views[0].error).toContain('拒绝')
  api.put.mockRejectedValue({ status: 500 }); await submit(0, { ...body(), remark: '改后' })
  expect(views[0].pendingRecord!.requestKey).not.toBe(old); expect(views[0].pendingRecord!.body.remark).toBe('改后')
})
test('无未执行证明的4xx与REQUEST_IN_PROGRESS保留原请求', async () => {
  await mount(); api.put.mockRejectedValue({ status: 409, code: 'REQUEST_IN_PROGRESS' }); await submit(); const original = views[0].pendingRecord; await submit(); expect(original).not.toBeNull(); expect(views[0].pendingRecord).toEqual(original); expect(api.put).toHaveBeenCalledTimes(1)
})
test('同tick不同hook同单仅一笔，另一任务独立', async () => {
  await mount([21, 21]); let release!: (value: unknown) => void; api.put.mockImplementation(() => new Promise(resolve => { release = resolve }))
  let first!: Promise<unknown>, second!: Promise<unknown>
  await act(async () => { first = views[0].submit(body()); second = views[1].submit({ ...body(), remark: '另一个标签' }) })
  expect(api.put).toHaveBeenCalledTimes(1); await second
  await act(async () => { release(success()); await first }); await remount([21, 22]); api.put.mockRejectedValue({ status: 504 }); await submit(); await submit(1)
  expect(views[0].pendingRecord!.taskId).toBe(21); expect(views[1].pendingRecord!.taskId).toBe(22)
})
test.each(['pending', 'not_found'])('%s不得新建请求或换载荷', async status => {
  await mount(); await submit(); const original = views[0].pendingRecord; api.query.mockResolvedValue({ status, data: null }); await query(); await submit(0, { ...body(), remark: '新的' })
  expect(api.put).toHaveBeenCalledTimes(1); expect(views[0].pendingRecord).toEqual(original)
})
test('确认failed后安全清理，错资源回执保留', async () => {
  await mount(); await submit(); const original = views[0].pendingRecord
  api.query.mockResolvedValue({ status: 'failed', resourceType: 'sale_order', resourceId: 21, data: null }); await query(); expect(views[0].pendingRecord).toEqual(original)
  api.query.mockResolvedValue({ status: 'failed', data: null, message: '已拒绝' }); await query(); expect(views[0].pendingRecord).toBeNull(); expect(views[0].error).toContain('已拒绝')
})
test('存储写失败不发PUT；非法记录不删或放行', async () => {
  await mount(); const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('full') }); await submit(); expect(api.put).not.toHaveBeenCalled(); expect(views[0].blocked).toBe(true)
  failure.mockRestore(); localStorage.setItem(storageKey, '{bad'); await remount(); await submit(); expect(api.put).not.toHaveBeenCalled(); expect(localStorage.getItem(storageKey)).toBe('{bad')
})
test('确认成功清理失败仍阻断，禁止重复PUT', async () => {
  await mount(); await submit(); api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 21, data: success() })
  const failure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw Error('full') }); await query(); await retry(); expect(views[0].blocked).toBe(true); expect(api.put).toHaveBeenCalledTimes(1)
  failure.mockRestore(); await query(); expect(views[0].pendingRecord).toBeNull()
})
test('撤权阻止新提交和retry，仍可查询本人原成功', async () => {
  await mount(); await submit(); await query(); act(() => useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INBOUND_ORDER_VIEW] })); await retry(); expect(api.put).toHaveBeenCalledTimes(1)
  api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 21, data: success() }); await query(); expect(views[0].pendingRecord).toBeNull()
})
test.each(['account', 'endpoint-ABA', 'inactive'])('在途%s变化拒绝迟到成功，原存储保留', async change => {
  await mount(); let release!: (value: unknown) => void; api.put.mockImplementation(() => new Promise(resolve => { release = resolve })); let pending!: Promise<unknown>
  await act(async () => { pending = views[0].submit(body()) }); const raw = snapshot()
  if (change === 'account') login(userId + 100)
  if (change === 'endpoint-ABA') { act(() => { setApiClientBaseURL('/other'); setApiClientBaseURL('/api') }); expect(getApiClientBaseURL()).toBe('/api') }
  if (change === 'inactive') { active = false; await act(async () => root!.render(<Probe id={21} index={0} />)) }
  await act(async () => { release(success()); await pending }); expect(snapshot()).toBe(raw); expect(views[0].result).toBeNull(); expect(api.invalidate).not.toHaveBeenCalled()
})
test('过期完整请求仅查询；回执身份错误不确认', async () => {
  await mount(); await submit(); const key = requestKeys()[0], record = JSON.parse(localStorage.getItem(key)!)
  record.createdAt = Date.now() - 8 * 86400000; localStorage.setItem(key, JSON.stringify(record)); await remount(); await query(); expect(views[0].canRetry).toBe(false); await retry(); expect(api.put).toHaveBeenCalledTimes(1)
  api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 21, data: success(22) }); await query(); expect(views[0].pendingRecord).not.toBeNull()
})

test('完整恢复body包含运费空值/0及原值，拒绝非法金额且不round', async () => {
  const freight = { ...body(), freightType: 2 as const, freightAmount: 0 }
  expect(validInboundEditBody(freight)).toBe(true)
  expect(validInboundEditBody({ ...freight, freightAmount: null, freightType: null })).toBe(true)
  for (const amount of [-1, 1.001, Infinity, '1.00']) expect(validInboundEditBody({ ...freight, freightAmount: amount })).toBe(false)
  await mount(); await submit(0, freight); const record = views[0].pendingRecord!
  expect(record.body).toEqual(freight); await remount(); expect(views[0].pendingRecord!.body).toEqual(freight)
})

test('首发成功但存储清理失败显示已确认清理状态，不可再次PUT', async () => {
  await mount(); api.put.mockResolvedValue(success()); const failure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw Error('full') })
  await submit(); expect(views[0].pendingRecord?.phase).toBe('confirmed'); expect(views[0].blocked).toBe(true); expect(views[0].error).toContain('清理失败'); await retry(); expect(api.put).toHaveBeenCalledTimes(1)
  failure.mockRestore(); await query(); expect(views[0].pendingRecord).toBeNull()
})

test('撤VIEW即使仍有UPDATE也禁止原回执查询/重试，保留原本地请求提示联系有权人员', async () => {
  await mount(); await submit(); const raw = snapshot(); act(() => useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INBOUND_ORDER_UPDATE] })); await query(); await retry()
  expect(api.query).not.toHaveBeenCalled(); expect(api.put).toHaveBeenCalledTimes(1); expect(snapshot()).toBe(raw); expect(views[0].error).toContain('联系有权人员')
})

const requestKeys = () => Object.keys(localStorage).filter(key => key.startsWith('flowcube-inbound-edit-v1:request:'))
const requestKeyFor = (record: { userId: number; baseURL: string; taskId: number; requestKey: string }) => 'flowcube-inbound-edit-v1:request:' + encodeURIComponent(JSON.stringify([record.userId, record.baseURL, record.taskId, record.requestKey]))
test('两个不同任务交错持久化不覆盖另一笔unknown正文/key', async () => {
  await mount([21, 22]); const originalSet = Storage.prototype.setItem; let second: Promise<unknown> | undefined, started = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (!started && value.includes('"phase":"pending"') && value.includes('"taskId":21')) { started = true; second = views[1].submit(body()) } originalSet.call(this, key, value) })
  await submit(); await act(async () => { await second }); expect(views[0].pendingRecord?.taskId).toBe(21); expect(views[1].pendingRecord?.taskId).toBe(22); expect(requestKeys()).toHaveLength(2)
})
test('确认A过程中交错保存B只清A，B完整unknown仍在', async () => {
  await mount([21, 22]); await submit(); api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 21, data: success() }); const originalSet = Storage.prototype.setItem; let second: Promise<unknown> | undefined, started = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (!started && value.includes('"phase":"confirmed"')) { started = true; second = views[1].submit(body()) } originalSet.call(this, key, value) })
  await query(); await act(async () => { await second }); expect(views[0].pendingRecord).toBeNull(); expect(views[1].pendingRecord?.taskId).toBe(22); expect(requestKeys()).toHaveLength(1)
})
test('同任务两笔跨窗口正文碰撞全部保留且failclosed，不自动选择/PUT', async () => {
  await mount(); await submit(); const first = views[0].pendingRecord!, second = { ...first, requestKey: 'other-window-key' }; localStorage.setItem(requestKeyFor(second), JSON.stringify(second)); await remount(); expect(views[0].error).toContain('同一收货单'); expect(views[0].blocked).toBe(true); await submit(); expect(api.put).toHaveBeenCalledTimes(1); expect(localStorage.getItem(requestKeyFor(second))).toBe(JSON.stringify(second)); expect(requestKeys()).toHaveLength(2)
})
test('旧数组unknown迁移保留原body/key，安全确认后不会从备份复活', async () => {
  await mount(); await submit(); const original = views[0].pendingRecord!; for (const key of requestKeys()) localStorage.removeItem(key); localStorage.setItem(storageKey, JSON.stringify([original])); await remount(); expect(views[0].pendingRecord).toEqual(original); expect(requestKeys()).toHaveLength(1); expect(api.put).toHaveBeenCalledTimes(1)
  api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 21, data: success() }); await query(); await remount(); expect(views[0].pendingRecord).toBeNull(); expect(requestKeys()).toHaveLength(0)
})

test('旧数组迁移复制与另一窗口确认交错，迟到pending不复活或覆盖确认墓碑', async () => {
  await mount(); await submit(); const original = views[0].pendingRecord!, key = requestKeyFor(original), terminalKey = key.replace(':request:', ':terminal:'), confirmed = { ...original, phase: 'confirmed', result: success() }; localStorage.removeItem(key); localStorage.setItem(storageKey, JSON.stringify([original])); const originalSet = Storage.prototype.setItem; let started = false
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) { if (!started && name === key) { started = true; originalSet.call(this, terminalKey, JSON.stringify(confirmed)) } originalSet.call(this, name, value) })
  await remount(); expect(views[0].pendingRecord?.phase).toBe('confirmed'); await query(); await remount(); expect(views[0].pendingRecord).toBeNull(); expect(api.put).toHaveBeenCalledTimes(1); expect(localStorage.getItem(terminalKey)).toBe(JSON.stringify(confirmed))
})
