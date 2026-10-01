// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
import type { PlasticBox } from '@/hooks/usePlasticBoxes'
import { recoveryStorageKey, type RepackRecoveryRecord } from '@/lib/criticalOperationRecovery'
import PlasticBoxesPage from './index'
const api = vi.hoisted(() => ({ post: vi.fn(), query: vi.fn(), getBox: vi.fn(), sources: vi.fn(), movement: vi.fn(), toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, defaults: { baseURL: '/api' } }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults }, payloadClient: { get: vi.fn() } }))
vi.mock('@/api/inventory', () => ({ repackPlasticBoxApi: api.post, getPlasticBoxSourcesApi: api.sources }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.query }))
vi.mock('@/lib/toast', () => ({ toast: api.toast }))
vi.mock('@/hooks/usePlasticBoxes', async original => ({ ...await original<typeof import('@/hooks/usePlasticBoxes')>(), getPlasticBoxApi: api.getBox, usePlasticBoxMovements: () => ({ data: [], isLoading: false, isError: false, refetch: api.movement }) }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => null }))
vi.mock('@/components/shared/BaseCrudPage', () => ({ default: (p: { renderToolbar: ReactNode; renderActions: (row: PlasticBox, helpers: object) => ReactNode }) => <>{p.renderToolbar}{[4, 5].map(id => <div data-box={id} key={id}>{p.renderActions({ id, barcode: `B${id}`, remainingQty: 100 } as PlasticBox, {})}</div>)}</> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let owner = 94000
let root: Root | undefined
let host: HTMLDivElement
let qc: QueryClient
const result = (boxId = 4) => ({ boxId, boxRemainingAfter: 60, created: [{ containerId: 6, barcode: 'I6', qty: 20 }], printJobIds: [4], noPrinterCount: 0, renderFailedCount: 0 })
const record = (boxId = 4): RepackRecoveryRecord => ({ accountId: owner, boxId, action: `plastic_box.repack.${boxId}`, requestKey: `original-${owner}-${boxId}`, createdAt: '2026-10-01T00:00:00Z', endpoint: new URL('/api', location.origin).href, body: { perBoxQty: 20, boxCount: 2 } })
function seed(records = [record()]) { localStorage.setItem(recoveryStorageKey(owner), JSON.stringify({ version: 1, records })); return records }
async function mount() { root = createRoot(host); await act(async () => root!.render(<QueryClientProvider client={qc}><PlasticBoxesPage /></QueryClientProvider>)) }
async function click(label: string, scope: ParentNode = document) { const b = [...scope.querySelectorAll('button')].find(b => b.textContent === label); expect(b, label).toBeTruthy(); await act(async () => b!.click()) }
async function openB() { await click('详情', host.querySelector('[data-box="5"]')!); await click('还原整件') }
async function setQty(value: string) { const input = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="number"]')[0]; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
beforeEach(() => {
  owner++; localStorage.clear(); vi.clearAllMocks(); api.defaults.baseURL = '/api'
  api.sources.mockResolvedValue({ sources: [] }); api.post.mockRejectedValue({ code: 'NETWORK_ERROR' }); api.query.mockResolvedValue({ status: 'not_found', data: null }); api.getBox.mockImplementation(async id => ({ id, barcode: `B${id}`, remainingQty: 60 }))
  act(() => useAuthStore.getState().login('test', null, { id: owner, roleId: 1 } as User))
  host = document.createElement('div'); document.body.append(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['plastic-boxes', { page: 1 }], { list: [{ id: 4 }, { id: 5 }] })
})
afterEach(() => { act(() => root?.unmount()); root = undefined; qc.clear(); host.remove(); vi.restoreAllMocks(); act(() => useAuthStore.getState().logout()) })

test('刷新页面显示同账号多个盒原操作，挂载不自动 POST/查询/补打', async () => {
  seed([record(), record(5)]); await mount()
  expect(host.textContent).toContain('盒 #4'); expect(host.textContent).toContain('盒 #5'); expect(host.textContent).toContain('每箱 20 × 2 箱')
  expect(api.post).not.toHaveBeenCalled(); expect(api.query).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull()
})
test('查看 B 并输入草稿时确认 A，只更新 A，B 弹窗/草稿和缓存保留', async () => {
  const [original] = seed(); await mount(); await openB(); await setQty('7')
  const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
  expect(dialog.textContent).toContain('还原整件 · B5')
  expect(dialog.textContent).toContain('盒 #4')
  api.query.mockResolvedValue({ status: 'success', data: result(), resourceId: 4 })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const sourceCalls = api.sources.mock.calls.length
  await click('查询上次结果', dialog)
  expect(api.query).toHaveBeenCalledWith(original.requestKey, original.action, expect.objectContaining({ baseURL: original.endpoint }))
  expect([...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent).toContain('还原整件 · B5')
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('7')
  expect(api.sources.mock.calls.length).toBe(sourceCalls)
  expect(invalidate.mock.calls.map(c => c[0]?.queryKey).filter(Boolean)).toEqual([['plastic-box', 4], ['plastic-box-sources', 4], ['plastic-box-movements', 4]])
  expect(api.toast.success).toHaveBeenCalledWith(expect.stringContaining('I6(20)'))
})
test('查看原盒走最新单盒 GET，不全拉列表；详情拒绝保持恢复记录', async () => {
  const [original] = seed(); await mount(); api.getBox.mockRejectedValueOnce({ status: 403 })
  await click('查看原盒', host)
  expect(api.getBox).toHaveBeenCalledWith(4, expect.objectContaining({ baseURL: original.endpoint, _erpApiFallbackTried: true }))
  expect(host.textContent).toContain('盒 #4'); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('查看原盒', host); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('塑料盒详情 · B4')
})
test('无执行权限仍可查询自身回执，failed 如实提示且不允许 retry', async () => {
  seed(); act(() => useAuthStore.getState().updateUser({ roleId: 5, permissions: [] })); await mount()
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '按原内容重试')).toBe(false)
  api.query.mockResolvedValue({ status: 'failed', data: null, resourceId: 4 }); await click('查询上次结果', host)
  expect(api.toast.error).toHaveBeenCalledWith(expect.stringContaining('已确认失败')); expect(host.textContent).not.toContain('盒 #4')
})
test('成功载荷未知时只读原盒，详情403仍说明业务已确认，无当前盒patch', async () => {
  seed(); await mount(); await openB(); await setQty('8')
  api.query.mockResolvedValue({ status: 'success', data: {}, resourceId: 4 }); api.getBox.mockRejectedValue({ status: 403 })
  await click('查询上次结果', [...document.querySelectorAll('[role="dialog"]')].at(-1)!)
  expect(api.getBox).toHaveBeenCalledWith(4, expect.objectContaining({ _erpApiFallbackTried: true }))
  expect(api.toast.success).toHaveBeenCalledWith(expect.stringContaining('原提交成功'))
  expect(api.toast.warning).toHaveBeenCalledWith(expect.stringContaining('已确认成功'))
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('8')
})
test('打印降级独立警告，业务成功文案不声称物理出纸', async () => {
  seed(); await mount(); api.query.mockResolvedValue({ status: 'success', data: { ...result(), noPrinterCount: 1, renderFailedCount: 1 }, resourceId: 4 })
  await click('查询上次结果', host)
  expect(api.toast.warning).toHaveBeenCalledWith('2 个标签未打印，可在打印记录页补打')
  expect(api.toast.success.mock.calls.join()).not.toContain('已打印')
})

test('首发 A 延迟成功时已关闭 A 打开 B，A 的 Promise 收尾不能关闭 B 草稿', async () => {
  await mount(); let release!: (data: unknown) => void
  api.post.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await click('详情', host.querySelector('[data-box="4"]')!); await click('还原整件'); await click('确认还原')
  await click('取消', [...document.querySelectorAll('[role="dialog"]')].at(-1)!); await click('关闭')
  await openB(); await setQty('7')
  await act(async () => { release(result()); await Promise.resolve() })
  expect([...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent).toContain('还原整件 · B5')
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('7')
})
test('首发期间换账号，旧成功不关闭仍挂载的还原弹窗/不调用当前提示', async () => {
  await mount(); let release!: (data: unknown) => void
  api.post.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await openB(); await click('确认还原')
  act(() => useAuthStore.getState().login('other', null, { id: owner + 1000, roleId: 1 } as User))
  await setQty('8')
  await act(async () => { release(result(5)); await Promise.resolve() })
  expect([...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent).toContain('还原整件 · B5')
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('8')
  expect(api.toast.success).not.toHaveBeenCalled()
})
test('查看原盒 A 的详情 GET 迟到时不能覆盖已打开 B 的选择与草稿', async () => {
  seed(); await mount(); let release!: (data: unknown) => void
  api.getBox.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await click('查看原盒', host)
  await openB(); await setQty('9')
  await act(async () => { release({ id: 4, barcode: 'B4', remainingQty: 60 }); await Promise.resolve() })
  expect([...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent).toContain('还原整件 · B5')
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('9')
})

test.each([
  ['success', true], ['error', true], ['success', false], ['error', false],
] as const)('查看原盒在途身份被替换后，旧 GET %s（storage已刷新=%s）不打开/提示', async (outcome, refreshed) => {
  const [original] = seed(); await mount()
  let release!: (data: unknown) => void
  let reject!: (error: unknown) => void
  api.getBox.mockImplementation(() => new Promise((resolve, fail) => { release = resolve; reject = fail }))
  await click('查看原盒', host)
  const replacement = { ...original, requestKey: 'replacement', body: { items: [15] } }
  seed([replacement])
  if (refreshed) act(() => window.dispatchEvent(new StorageEvent('storage', { key: recoveryStorageKey(owner) })))
  await act(async () => {
    if (outcome === 'success') release({ id: 4, barcode: 'B4', remainingQty: 60 })
    else reject({ status: 403 })
    await Promise.resolve()
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(api.toast.error).not.toHaveBeenCalled()
  expect(api.toast.warning).not.toHaveBeenCalled()
  expect(JSON.parse(localStorage.getItem(recoveryStorageKey(owner))!).records).toEqual([replacement])
})

test('已确认后的原盒 GET 迟到，不能覆盖同盒下一次成功的数量', async () => {
  seed(); await mount(); let release!: (data: unknown) => void
  api.getBox.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await click('详情', host.querySelector('[data-box="4"]')!)
  api.query.mockResolvedValue({ status: 'success', data: {}, resourceId: 4 })
  await click('查询上次结果', document.querySelector('[role="dialog"]')!)
  api.post.mockResolvedValue({ ...result(), boxRemainingAfter: 40 })
  await click('还原整件'); await setQty('10'); await click('确认还原')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前数量 40')
  await act(async () => { release({ id: 4, barcode: 'B4', remainingQty: 60 }); await Promise.resolve() })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前数量 40')
})
test('已确认后的原盒 GET 迟到，不能 patch 关闭后重选同盒的新草稿', async () => {
  seed(); await mount(); let release!: (data: unknown) => void
  api.getBox.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await click('详情', host.querySelector('[data-box="4"]')!)
  api.query.mockResolvedValue({ status: 'success', data: {}, resourceId: 4 })
  await click('查询上次结果', document.querySelector('[role="dialog"]')!)
  await click('关闭'); await click('详情', host.querySelector('[data-box="4"]')!)
  await click('还原整件'); await setQty('7')
  await act(async () => { release({ id: 4, barcode: 'B4', remainingQty: 60 }); await Promise.resolve() })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前数量 100')
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('7')
})

test('同盒新 POST 已开始但未返回，也让已确认后的旧 GET 失效', async () => {
  seed(); await mount(); let releaseGet!: (data: unknown) => void; let releasePost!: (data: unknown) => void
  api.getBox.mockImplementation(() => new Promise(resolve => { releaseGet = resolve }))
  await click('详情', host.querySelector('[data-box="4"]')!)
  api.query.mockResolvedValue({ status: 'success', data: {}, resourceId: 4 })
  await click('查询上次结果', document.querySelector('[role="dialog"]')!)
  api.post.mockImplementation(() => new Promise(resolve => { releasePost = resolve }))
  await click('还原整件'); await setQty('10'); await click('确认还原')
  expect(api.post).toHaveBeenCalledOnce()
  await act(async () => { releaseGet({ id: 4, barcode: 'B4', remainingQty: 60 }); await Promise.resolve() })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前数量 100')
  await act(async () => { releasePost({ ...result(), boxRemainingAfter: 40 }); await Promise.resolve() })
})
test('已确认后的旧 GET 失败，重选同盒后不向新草稿追加迟到警告', async () => {
  seed(); await mount(); let reject!: (error: unknown) => void
  api.getBox.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  await click('详情', host.querySelector('[data-box="4"]')!)
  api.query.mockResolvedValue({ status: 'success', data: {}, resourceId: 4 })
  await click('查询上次结果', document.querySelector('[role="dialog"]')!)
  await click('关闭'); await click('详情', host.querySelector('[data-box="4"]')!)
  await click('还原整件'); await setQty('7')
  await act(async () => { reject({ status: 403 }); await Promise.resolve() })
  expect(api.toast.warning).not.toHaveBeenCalled()
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('7')
})
test('原记录合法清理后，首次无迟到变更的 GET 仍可重读原盒', async () => {
  seed(); await mount(); let release!: (data: unknown) => void
  api.getBox.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await click('详情', host.querySelector('[data-box="4"]')!)
  api.query.mockResolvedValue({ status: 'success', data: {}, resourceId: 4 })
  await click('查询上次结果', document.querySelector('[role="dialog"]')!)
  expect(localStorage.getItem(recoveryStorageKey(owner))).toBeNull()
  await act(async () => { release({ id: 4, barcode: 'B4', remainingQty: 60 }); await Promise.resolve() })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前数量 60')
})
