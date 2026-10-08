// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaOverReceiveDialog from './PdaOverReceiveDialog'
import { usePdaScanner } from '@/hooks/usePdaScanner'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) }))
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

test('超收必须选原因，模态期间后台扫码暂停，关闭后恢复', async () => {
  const onScan = vi.fn(), onConfirm = vi.fn()
  function Harness({ open }: { open: boolean }) {
    usePdaScanner({ onScan })
    return <><button>背景操作</button>{open && <PdaOverReceiveDialog productName="合成商品" unit="个" orderedQty={1} receivedQty={1} thisQty={1.25} overQty={1.25} overAmount={5} onCancel={vi.fn()} onConfirm={onConfirm} />}</>
  }
  await act(async () => { root.render(<Harness open />) })
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog).toBeTruthy()
  expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
  const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === '确认超收登记')!
  expect(confirm.disabled).toBe(true)
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === '供应商多发货')!.click() })
  expect(confirm.disabled).toBe(false)
  await act(async () => { confirm.click() })
  expect(onConfirm).toHaveBeenCalledWith('supplier_over_delivery')
  function scan() { for (const key of [...'I000123', 'Enter']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) }
  await act(async () => { scan() })
  expect(onScan).not.toHaveBeenCalled()
  await act(async () => { root.render(<Harness open={false} />) })
  await act(async () => { scan() })
  expect(onScan).toHaveBeenCalledWith('I000123')
})
