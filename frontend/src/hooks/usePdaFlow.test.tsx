// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { usePdaFlow, type FlowDef } from './usePdaFlow'
const feedback = vi.hoisted(() => ({ ok: vi.fn(), err: vi.fn(), warn: vi.fn(), flash: null }))
vi.mock('./usePdaFeedback', () => ({ usePdaFeedback: () => feedback }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let value: ReturnType<typeof usePdaFlow>
const complete = vi.fn()
const flow: FlowDef = { id: 'test', initialStep: 'scan', onComplete: complete, steps: [{ id: 'scan', label: '扫码', placeholder: '', barcodeType: 'any', handle: async () => ({ ok: true, message: '完成', nextStep: '__done__', context: { scanned: true } }) }] }
function mount(def = flow) { function Probe() { value = usePdaFlow(def, { scanned: false }, 'test'); return null }; root = createRoot(document.createElement('div')); act(() => root!.render(<Probe />)) }
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.restoreAllMocks(); vi.clearAllMocks(); sessionStorage.clear() })
test('sessionStorage 读取和写入异常时使用初始状态并继续流程', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(mount).not.toThrow()
  expect(value.stepId).toBe('scan')
  await act(async () => value.scan('barcode'))
  expect(value.done).toBe(true); expect(complete).toHaveBeenCalledWith({ scanned: true })
})
test('删除缓存异常不阻断完成回调及重置，完成后不再写回草稿', async () => {
  mount()
  const set = vi.spyOn(Storage.prototype, 'setItem')
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  await act(async () => value.scan('barcode'))
  expect(complete).toHaveBeenCalledOnce(); expect(feedback.err).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
  expect(() => act(() => value.reset())).not.toThrow()
  expect(value.done).toBe(false)
})
test('业务异常仍显示错误且不调用完成回调', async () => {
  mount({ ...flow, steps: [{ ...flow.steps[0], handle: async () => { throw new Error('业务失败') } }] })
  await act(async () => value.scan('barcode'))
  expect(feedback.err).toHaveBeenCalledWith('业务失败'); expect(complete).not.toHaveBeenCalled()
})
