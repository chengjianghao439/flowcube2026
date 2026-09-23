// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaInventoryQueryPage from './inventory-query'

const scanner = vi.hoisted(() => ({
  getStatus: vi.fn(),
  setEnabled: vi.fn(),
}))
const query = vi.hoisted(() => vi.fn())
const scanHook = vi.hoisted(() => ({ onScan: null as null | ((code: string) => void) }))

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@capacitor/core')>(),
  Capacitor: { isNativePlatform: () => true },
}))
vi.mock('@/lib/pdaScanBridge', () => ({ PdaScanBridge: scanner }))
vi.mock('@/api/inventory', () => ({ queryInventoryByBarcodeApi: query }))
vi.mock('@/hooks/usePdaScanner', () => ({ usePdaScanner: ({ onScan }: { onScan: (code: string) => void }) => { scanHook.onScan = onScan } }))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, err: vi.fn(), ok: vi.fn() }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  scanner.getStatus.mockReset().mockResolvedValue({ enabled: true, available: true })
  scanner.setEnabled.mockReset().mockImplementation(async ({ enabled }) => ({ enabled }))
  query.mockReset().mockResolvedValue([])
  scanHook.onScan = null
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('库存查询不显示设备扫码开关，仍可直接接收原生扫码和手动输入', async () => {
  await act(async () => { root.render(<MemoryRouter><PdaInventoryQueryPage /></MemoryRouter>) })
  expect(host.textContent).not.toContain('无焦点扫码')
  expect(host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')).toBeNull()
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === '手动输入')
  expect(button).not.toBeUndefined()
  await act(async () => { button!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'I000916')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(query).toHaveBeenCalledWith('I000916')
  expect(scanner.getStatus).not.toHaveBeenCalled()
  expect(scanner.setEnabled).not.toHaveBeenCalled()
  await act(async () => { scanHook.onScan?.('I000917'); await Promise.resolve() })
  expect(query).toHaveBeenCalledWith('I000917')
})
