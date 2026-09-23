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

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@capacitor/core')>(),
  Capacitor: { isNativePlatform: () => true },
}))
vi.mock('@/lib/pdaScanBridge', () => ({ PdaScanBridge: scanner }))
vi.mock('@/hooks/usePdaScanner', () => ({ usePdaScanner: () => {} }))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, err: vi.fn(), ok: vi.fn() }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  scanner.getStatus.mockReset().mockResolvedValue({ enabled: true, available: true })
  scanner.setEnabled.mockReset().mockImplementation(async ({ enabled }) => ({ enabled }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('原生无焦点扫码默认开启，用户可在库存查询关闭并重新开启', async () => {
  await act(async () => { root.render(<MemoryRouter><PdaInventoryQueryPage /></MemoryRouter>) })
  const button = () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('无焦点扫码'))
  expect(button()?.textContent).toContain('关闭')
  expect(host.textContent).not.toContain('测试')
  expect(scanner.setEnabled).not.toHaveBeenCalled()

  await act(async () => { button()?.click() })
  expect(scanner.setEnabled).toHaveBeenCalledWith({ enabled: false })
  expect(button()?.textContent).toContain('开启')

  await act(async () => { button()?.click() })
  expect(scanner.setEnabled).toHaveBeenLastCalledWith({ enabled: true })
  expect(button()?.textContent).toContain('关闭')
})
