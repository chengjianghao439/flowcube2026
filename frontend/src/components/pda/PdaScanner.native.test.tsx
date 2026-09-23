// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaScanner from './PdaScanner'

const native = vi.hoisted(() => ({
  listener: null as null | ((event: { barcode: string }) => void),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    addListener: async (_name: string, listener: (event: { barcode: string }) => void) => {
      native.listener = listener
      return { remove: async () => {} }
    },
  }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  native.listener = null
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('手动输入框打开时仍接收扫码广播，扫码后收起输入框', async () => {
  const onScan = vi.fn()
  await act(async () => { root.render(<PdaScanner onScan={onScan} />) })
  const manualButton = [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')
  await act(async () => { manualButton?.click() })
  expect(host.querySelector('[data-scanner-manual="true"]')).not.toBeNull()
  await act(async () => { native.listener?.({ barcode: 'I000123' }) })
  expect(onScan).toHaveBeenCalledWith('I000123')
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
})

test('扫码条只负责接收条码，不提前显示绿色操作成功提示', async () => {
  const onScan = vi.fn()
  await act(async () => { root.render(<PdaScanner onScan={onScan} />) })
  await act(async () => { native.listener?.({ barcode: 'I000123' }) })
  expect(onScan).toHaveBeenCalledWith('I000123')
  expect(host.textContent).not.toContain('已识别')
  expect(host.querySelector('[data-testid="pda-scan-area"]')?.className).not.toContain('bg-emerald')
})
