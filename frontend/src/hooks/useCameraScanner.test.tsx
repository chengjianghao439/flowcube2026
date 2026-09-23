// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { useCameraScanner } from './useCameraScanner'
const plugin = vi.hoisted(() => ({ isSupported: vi.fn(), startScan: vi.fn(), stopScan: vi.fn(), addListener: vi.fn(), remove: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({ BarcodeScanner: plugin, BarcodeFormat: { QrCode: 'QR_CODE' } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let value: ReturnType<typeof useCameraScanner>
let listener: (event: { barcodes: { rawValue: string }[] }) => void
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function mount() { function Probe() { value = useCameraScanner(); return null }; root = createRoot(document.createElement('div')); act(() => root!.render(<Probe />)) }
beforeEach(() => { plugin.isSupported.mockResolvedValue({ supported: true }); plugin.startScan.mockResolvedValue(undefined); plugin.stopScan.mockResolvedValue(undefined); plugin.remove.mockResolvedValue(undefined); plugin.addListener.mockImplementation(async (_name, callback) => { listener = callback; return { remove: plugin.remove } }); mount() })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; vi.resetAllMocks() })
test('卸载停止原生扫描、移除监听器并忽略后续回调', async () => {
  const result = vi.fn()
  await act(async () => value.scan(result))
  expect(document.body.classList.contains('barcode-scanner-active')).toBe(true)
  await act(async () => root!.unmount()); root = undefined
  expect(plugin.stopScan).toHaveBeenCalled(); expect(plugin.remove).toHaveBeenCalledOnce()
  listener({ barcodes: [{ rawValue: 'late' }] }); expect(result).not.toHaveBeenCalled()
  expect(document.body.classList.contains('barcode-scanner-active')).toBe(false)
})
test('支持检查未返回时关闭不再请求启动相机', async () => {
  const supported = deferred<{ supported: boolean }>(); plugin.isSupported.mockReturnValue(supported.promise)
  let running!: Promise<void>
  await act(async () => { running = value.scan(vi.fn()) })
  await act(async () => value.close())
  await act(async () => { supported.resolve({ supported: true }); await running })
  expect(plugin.startScan).not.toHaveBeenCalled(); expect(value.open).toBe(false)
})
test('startScan 在关闭后才完成时再次停止，不回调结果或失败', async () => {
  const started = deferred<void>(); plugin.startScan.mockReturnValue(started.promise)
  const result = vi.fn(), fail = vi.fn(); let running!: Promise<void>
  await act(async () => { running = value.scan(result, fail) })
  expect(plugin.startScan).toHaveBeenCalledOnce()
  await act(async () => value.close())
  const calls = plugin.stopScan.mock.calls.length
  await act(async () => { started.resolve(); await running })
  expect(plugin.stopScan.mock.calls.length).toBeGreaterThan(calls)
  listener({ barcodes: [{ rawValue: 'late' }] })
  expect(result).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled(); expect(value.open).toBe(false)
})
test('监听器延迟注册在关闭后仍被移除且不启动扫描', async () => {
  const added = deferred<{ remove: typeof plugin.remove }>(); plugin.addListener.mockReturnValue(added.promise)
  let running!: Promise<void>
  await act(async () => { running = value.scan(vi.fn()) })
  await act(async () => value.close())
  await act(async () => { added.resolve({ remove: plugin.remove }); await running })
  expect(plugin.remove).toHaveBeenCalledOnce(); expect(plugin.startScan).not.toHaveBeenCalled()
})
test('关闭后的 stop 尚未完成时禁止启动下一轮，避免旧 stop 关闭新相机', async () => {
  await act(async () => value.scan(vi.fn()))
  const stopped = deferred<void>(); plugin.stopScan.mockReturnValue(stopped.promise)
  await act(async () => value.close())
  await act(async () => value.scan(vi.fn()))
  expect(plugin.startScan).toHaveBeenCalledTimes(1)
  await act(async () => stopped.resolve())
  await act(async () => value.scan(vi.fn()))
  expect(plugin.startScan).toHaveBeenCalledTimes(2)
})
test('启动取消的两次 stop 全部完成后才释放所有权，慢 stop 不得关闭下一轮', async () => {
  const started = deferred<void>(), stopped = deferred<void>()
  plugin.startScan.mockReturnValueOnce(started.promise)
  plugin.stopScan.mockReturnValueOnce(stopped.promise).mockResolvedValue(undefined)
  let running!: Promise<void>
  await act(async () => { running = value.scan(vi.fn()) })
  await act(async () => value.close())
  await act(async () => started.resolve())
  await act(async () => value.scan(vi.fn()))
  expect(plugin.startScan).toHaveBeenCalledTimes(1)
  await act(async () => { stopped.resolve(); await running })
  await act(async () => value.scan(vi.fn()))
  expect(plugin.startScan).toHaveBeenCalledTimes(2)
})
test('卸载重挂后的新 hook 必须等待旧实例原生 stop 完成', async () => {
  await act(async () => value.scan(vi.fn()))
  const stopped = deferred<void>(); plugin.stopScan.mockReturnValueOnce(stopped.promise)
  await act(async () => root!.unmount()); mount()
  await act(async () => value.scan(vi.fn()))
  expect(plugin.startScan).toHaveBeenCalledTimes(1)
  await act(async () => stopped.resolve())
  await act(async () => value.scan(vi.fn()))
  expect(plugin.startScan).toHaveBeenCalledTimes(2)
})
