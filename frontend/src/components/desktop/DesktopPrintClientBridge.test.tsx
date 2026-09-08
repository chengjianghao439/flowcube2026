// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DesktopPrintClientBridge from './DesktopPrintClientBridge'

const mocks = vi.hoisted(() => ({ post: vi.fn(), print: vi.fn() }))
vi.mock('@/api/client', () => ({ payloadClient: { post: mocks.post } }))
vi.mock('@/lib/platform', () => ({ IS_ELECTRON_DESKTOP: true }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) => select({ isAuthenticated: true }) }))
let root: Root
let host: HTMLDivElement
const raw = '^XA^FDABC^FS^XZ'
const job = { id: 123, printerName: '虚拟标签机', content: raw, contentType: 'zpl', ackToken: 'claim-current' }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  mocks.post.mockReset(); mocks.print.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'flowcubeDesktop', { configurable: true, value: {
    getClientInfo: async () => ({ clientId: 'test-client', hostname: 'test-only' }),
    getSystemPrinters: async () => [{ name: '虚拟标签机' }], printZpl: mocks.print,
  } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete window.flowcubeDesktop; vi.useRealTimers() })
async function run(extra: Record<string, unknown> = {}, failComplete = false) {
  let claimed = false
  mocks.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/claim-client')) { if (claimed) return []; claimed = true; return [{ ...job, ...extra }] }
    if (failComplete && url.endsWith('/complete-client')) throw new Error('网络暂时不可用')
    return undefined
  })
  await act(async () => { root.render(<DesktopPrintClientBridge />) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
}
function reports(kind: string) { return mocks.post.mock.calls.filter(([url]) => url.endsWith(`/${kind}-client`)) }

test('三份标签合成一次 RAW 提交，携带本次令牌完成核销', async () => {
  await run({ copies: 3 })
  expect(mocks.print).toHaveBeenCalledTimes(1)
  expect(mocks.print).toHaveBeenCalledWith({ printerName: job.printerName, content: [raw, raw, raw].join('\n') })
  expect(reports('complete')).toHaveLength(1)
  expect(reports('complete')[0][1]).toEqual({ ackToken: job.ackToken })
})
test('旧任务缺省份数保持单份', async () => { await run(); expect(mocks.print).toHaveBeenCalledWith({ printerName: job.printerName, content: raw }) })
test('单份保留原始 ^PQ 模板', async () => { const content = '^XA^PQ2^FDABC^FS^XZ'; await run({ copies: 1, content }); expect(mocks.print).toHaveBeenCalledWith({ printerName: job.printerName, content }) })
test('模板内已有份数时拒绝叠加，避免意外多打', async () => {
  await run({ copies: 2, content: '^XA^PQ2^FDABC^FS^XZ' })
  expect(mocks.print).not.toHaveBeenCalled()
  expect(reports('fail')[0][1]).toEqual({ ackToken: job.ackToken, errorMessage: expect.stringContaining('模板已设置打印份数') })
})
test.each([0, -1, 1.5, 101, null, true, '3'])('非法份数 %s 不送往打印机', async copies => {
  await run({ copies }); expect(mocks.print).not.toHaveBeenCalled(); expect(reports('fail')[0][1]).toEqual({ ackToken: job.ackToken, errorMessage: expect.stringContaining('1–100') })
})
test.each([{ printerName: '' }, { content: '' }])('缺少打印数据仍带领取令牌报错', async extra => {
  await run(extra); expect(mocks.print).not.toHaveBeenCalled(); expect(reports('fail')[0][1]).toMatchObject({ ackToken: job.ackToken })
})
test('本机 RAW 错误使用本次令牌标记失败', async () => {
  mocks.print.mockRejectedValue(new Error('虚拟打印失败')); await run({ copies: 2 })
  expect(reports('fail')[0][1]).toEqual({ ackToken: job.ackToken, errorMessage: '虚拟打印失败' }); expect(reports('complete')).toHaveLength(0)
})
test('提交后核销网络失败只重试回执，不补打也不改报失败', async () => {
  await run({ copies: 2 }, true); expect(mocks.print).toHaveBeenCalledTimes(1); expect(reports('complete')).toHaveLength(3); expect(reports('fail')).toHaveLength(0)
})

test('多份按完整多标签模板重复，最大份数仍只提交一次', async () => {
  const content = raw + '^XA^FDSECOND^FS^XZ'
  await run({ copies: 100, content })
  expect(mocks.print).toHaveBeenCalledTimes(1)
  const sent = mocks.print.mock.calls[0][0].content as string
  expect(sent.match(/\^XA/g)).toHaveLength(200)
  expect(sent.split('\n').every(batch => batch === content)).toBe(true)
  expect(reports('complete')).toHaveLength(1)
})
