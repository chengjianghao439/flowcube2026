// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { usePdaScanner } from './usePdaScanner'

const native = vi.hoisted(() => ({
  listener: null as null | ((event: { barcode: string }) => void),
  addListener: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ addListener: native.addListener }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  native.listener = null
  native.remove.mockReset()
  native.addListener.mockReset().mockImplementation(async (_name, listener) => {
    native.listener = listener
    return { remove: native.remove }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('原生广播条码在无输入焦点时提交，并与键盘事件共用防重复窗口', async () => {
  const onScan = vi.fn()
  const onDuplicate = vi.fn()
  function Harness() {
    usePdaScanner({ onScan, onDuplicate })
    return null
  }
  await act(async () => { root.render(<Harness />) })
  expect(native.addListener).toHaveBeenCalledWith('scan', expect.any(Function))
  await act(async () => { native.listener?.({ barcode: 'I000123' }) })
  expect(onScan).toHaveBeenCalledWith('I000123')

  for (const key of 'I000123') {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(onScan).toHaveBeenCalledTimes(1)
  expect(onDuplicate).not.toHaveBeenCalled()

  await act(async () => { native.listener?.({ barcode: 'I000123' }) })
  expect(onDuplicate).toHaveBeenCalledWith('I000123')
})

test('扫码监听停用后不处理原生结果，卸载时移除原生监听', async () => {
  const onScan = vi.fn()
  function Harness() {
    usePdaScanner({ onScan, enabled: false })
    return null
  }
  await act(async () => { root.render(<Harness />) })
  await act(async () => { native.listener?.({ barcode: 'I000123' }) })
  expect(onScan).not.toHaveBeenCalled()
  await act(async () => { root.unmount() })
  expect(native.remove).toHaveBeenCalledTimes(1)
  root = createRoot(host)
})

test('偏离推荐库位待确认时允许第二次同源实扫，但仍丢弃抖动和双通道回放', async () => {
  const onScan = vi.fn()
  const clock = vi.spyOn(Date, 'now')
  let now = 1000
  clock.mockImplementation(() => now)
  function Harness({ armed }: { armed: boolean }) {
    usePdaScanner({ onScan, allowIntentionalRepeat: armed })
    return null
  }
  try {
    await act(async () => { root.render(<Harness armed={false} />) })
    await act(async () => { native.listener?.({ barcode: 'R000804' }) })
    await act(async () => { root.render(<Harness armed />) })

    now += 100
    await act(async () => { native.listener?.({ barcode: 'R000804' }) })
    expect(onScan).toHaveBeenCalledTimes(1)

    now += 350
    await act(async () => { native.listener?.({ barcode: 'R000804' }) })
    expect(onScan).toHaveBeenCalledTimes(2)

    for (const key of 'R000804') document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onScan).toHaveBeenCalledTimes(2)
  } finally {
    clock.mockRestore()
  }
})
