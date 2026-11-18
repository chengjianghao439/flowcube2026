// @vitest-environment jsdom
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import DesktopPrintClientBridge from './DesktopPrintClientBridge'

const origin = 'https://print-test.invalid'
vi.mock('@/config/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/config/api')>(),
  getEffectiveApiOrigin: () => origin,
}))
const transport = vi.fn<AxiosAdapter>()
const print = vi.fn()
const initialAdapter = apiClient.defaults.adapter
const initialBaseURL = apiClient.defaults.baseURL
const initialAuth = useAuthStore.getState()
let root: Root
let host: HTMLDivElement
const raw = '^XA^FDABC^FS^XZ'
const job = { id: 123, printerName: '虚拟标签机', content: raw, contentType: 'zpl', ackToken: 'claim-current' }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  transport.mockReset()
  print.mockReset().mockResolvedValue(undefined)
  apiClient.defaults.adapter = transport
  useAuthStore.setState({ isAuthenticated: true, token: 'fixture-desktop-token' })
  Object.defineProperty(window, 'flowcubeDesktop', { configurable: true, value: {
    isDesktop: true,
    getClientInfo: async () => ({ clientId: 'test-client', hostname: 'test-only' }),
    getPrintClientCredential: async () => 'a'.repeat(64),
    getSystemPrinters: async () => [{ name: '虚拟标签机' }], printZpl: print,
  } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete window.flowcubeDesktop
  apiClient.defaults.adapter = initialAdapter
  setApiClientBaseURL(initialBaseURL)
  useAuthStore.setState(initialAuth)
  localStorage.clear()
  vi.useRealTimers()
})

function rejectResponse(config: InternalAxiosRequestConfig, status: number, code: string) {
  return new AxiosError('打印请求被拒绝', 'ERR_BAD_REQUEST', config, undefined, {
    config, status, statusText: 'Rejected', headers: {}, data: { success: false, code, message: '打印请求被拒绝' },
  })
}

async function run(extra: Record<string, unknown> = {}, completionError?: 'network' | 'conflict') {
  let claimed = false
  transport.mockImplementation(async (config) => {
    let data: unknown = null
    if (config.url === '/print-jobs/claim-client') {
      data = claimed ? [] : [{ ...job, ...extra }]
      claimed = true
    }
    if (config.url === `/print-jobs/${job.id}/complete-client`) {
      if (completionError === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config)
      if (completionError === 'conflict') throw rejectResponse(config, 409, 'CONFLICT')
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
  })
  await act(async () => { root.render(<DesktopPrintClientBridge />) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
}
function requests() {
  return transport.mock.calls.map(([config]) => ({
    config,
    url: axios.getUri(config),
    method: config.method,
    body: JSON.parse(String(config.data)) as unknown,
  }))
}
function reports(kind: string) { return requests().filter(({ url }) => url.endsWith(`/${kind}-client`)) }

test('共享 ERP 构建中的网页即使存在同名方法也不领取桌面打印任务', async () => {
  window.flowcubeDesktop!.isDesktop = false
  await run()
  expect(transport).not.toHaveBeenCalled()
  expect(print).not.toHaveBeenCalled()
})

test('三份标签以单份内容和份数提交，携带工作站凭据完成核销', async () => {
  await run({ copies: 3 })
  expect(print).toHaveBeenCalledExactlyOnceWith({ printerName: job.printerName, content: raw, copies: 3 })
  expect(requests().map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${origin}/api/printers/client-heartbeat`, method: 'post', body: { hostname: 'test-only' } },
    { url: `${origin}/api/print-jobs/claim-client`, method: 'post', body: { limit: 3 } },
    { url: `${origin}/api/print-jobs/${job.id}/complete-client`, method: 'post', body: { ackToken: job.ackToken } },
  ])
  for (const { config } of requests()) {
    expect(config.headers.get('X-Client-Id')).toBe('test-client')
    expect(config.headers.get('X-Print-Client-Credential')).toBe('a'.repeat(64))
    expect(config.headers.get('Authorization')).toBe('Bearer fixture-desktop-token')
    expect(config._erpApiFallbackTried).toBe(true)
  }
})
test('旧任务缺省份数保持单份', async () => { await run(); expect(print).toHaveBeenCalledWith({ printerName: job.printerName, content: raw, copies: 1 }) })
test('单份保留原始 ^PQ 模板', async () => { const content = '^XA^PQ2^FDABC^FS^XZ'; await run({ copies: 1, content }); expect(print).toHaveBeenCalledWith({ printerName: job.printerName, content, copies: 1 }) })
test('模板内已有份数时拒绝叠加，避免意外多打', async () => {
  await run({ copies: 2, content: '^XA^PQ2^FDABC^FS^XZ' })
  expect(print).not.toHaveBeenCalled()
  expect(reports('fail')[0].body).toEqual({ ackToken: job.ackToken, errorMessage: expect.stringContaining('模板已设置打印份数') })
})
test.each([0, -1, 1.5, 101, null, true, '3'])('非法份数 %s 不送往打印机', async copies => {
  await run({ copies }); expect(print).not.toHaveBeenCalled(); expect(reports('fail')[0].body).toEqual({ ackToken: job.ackToken, errorMessage: expect.stringContaining('1–100') })
})
test.each([{ printerName: '' }, { content: '' }])('缺少打印数据仍带领取令牌报错', async extra => {
  await run(extra); expect(print).not.toHaveBeenCalled(); expect(reports('fail')[0].body).toMatchObject({ ackToken: job.ackToken })
})
test('本机 RAW 错误使用本次令牌标记失败', async () => {
  print.mockRejectedValue(new Error('虚拟打印失败'))
  await run({ copies: 2 })
  expect(reports('fail')).toEqual([expect.objectContaining({
    url: `${origin}/api/print-jobs/${job.id}/fail-client`,
    method: 'post',
    body: { ackToken: job.ackToken, errorMessage: '虚拟打印失败' },
  })])
  expect(reports('complete')).toHaveLength(0)
})
test('提交后核销网络失败只重试回执，不补打也不改报失败', async () => {
  await run({ copies: 2 }, 'network')
  expect(print).toHaveBeenCalledTimes(1)
  expect(reports('complete').map(({ url, body }) => ({ url, body }))).toEqual(Array.from({ length: 3 }, () => ({
    url: `${origin}/api/print-jobs/${job.id}/complete-client`, body: { ackToken: job.ackToken },
  })))
  expect(reports('fail')).toHaveLength(0)
})
test('完成回执收到服务器 409 时停止重试且不触发重复打印', async () => {
  await run({ copies: 2 }, 'conflict')
  expect(print).toHaveBeenCalledTimes(1)
  expect(reports('complete')).toHaveLength(1)
  expect(reports('fail')).toHaveLength(0)
})

test('最大份数只传单份内容，Electron主进程逐份处理', async () => {
  const content = raw + '^XA^FDSECOND^FS^XZ'
  await run({ copies: 100, content })
  expect(print).toHaveBeenCalledTimes(1)
  const sent = print.mock.calls[0][0].content as string
  expect(sent).toBe(content)
  expect(print.mock.calls[0][0].copies).toBe(100)
  expect(reports('complete')).toHaveLength(1)
})

test('未注册工作站不发心跳或领取，不触发RAW', async () => {
  window.flowcubeDesktop!.getPrintClientCredential = async () => null
  await run()
  expect(transport).not.toHaveBeenCalled()
  expect(print).not.toHaveBeenCalled()
})

test('撤销凭据错误按实际ApiClientError形状显示注册指引', async () => {
  setApiClientBaseURL(`${origin}/api`)
  transport.mockImplementation(async (config) => { throw rejectResponse(config, 401, 'PRINT_CLIENT_CREDENTIAL_INVALID') })
  await act(async () => { root.render(<DesktopPrintClientBridge />) })
  expect(print).not.toHaveBeenCalled()
  expect(host.textContent).toContain('由管理员')
  expect(useAuthStore.getState().token).toBe('fixture-desktop-token')
})
