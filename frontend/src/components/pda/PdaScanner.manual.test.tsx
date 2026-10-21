// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaScanner from './PdaScanner'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
async function manual(value: string) {
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '手动输入')!.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}
async function enter(input: HTMLInputElement) {
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

test('立即拒绝后跨事件循环快速同码回车静默去重，保留原码和聚焦全选', async () => {
  const onScan = vi.fn(() => 'rejected' as const), onDuplicate = vi.fn()
  await act(async () => root.render(<PdaScanner onScan={onScan} onDuplicate={onDuplicate} />))
  const input = await manual('UITEST123')
  await enter(input)
  expect(input.readOnly).toBe(false)
  await enter(input)
  expect(onScan).toHaveBeenCalledTimes(1)
  expect(onDuplicate).not.toHaveBeenCalled()
  expect(input.value).toBe('UITEST123'); expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(9)
})

test('一秒内重复点击确认静默去重后恢复输入焦点与全选', async () => {
  const onScan = vi.fn(() => 'rejected' as const), onDuplicate = vi.fn()
  await act(async () => root.render(<PdaScanner onScan={onScan} onDuplicate={onDuplicate} />))
  const input = await manual('UITEST123'); await enter(input)
  const confirm = [...host.querySelectorAll('button')].find(button => button.textContent === '确认')!
  // jsdom.click 不自动模拟浏览器按下按钮时的移焦，显式先还原真实按钮焦点。
  confirm.focus(); input.setSelectionRange(9, 9)
  expect(document.activeElement).toBe(confirm)
  await act(async () => confirm.click())
  expect(onScan).toHaveBeenCalledTimes(1)
  expect(onDuplicate).not.toHaveBeenCalled()
  expect(input.value).toBe('UITEST123'); expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(9)
})

test('快速修正为不同条码可立即提交，同码满一秒后允许主动重试', async () => {
  vi.useFakeTimers()
  const onScan = vi.fn((_barcode: string) => 'rejected' as const)
  await act(async () => root.render(<PdaScanner onScan={onScan} />))
  const input = await manual('UITEST123'); await enter(input)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'I000123')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await enter(input)
  expect(onScan.mock.calls.map(call => call[0])).toEqual(['UITEST123', 'I000123'])
  await act(async () => vi.advanceTimersByTime(999)); await enter(input)
  expect(onScan).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTime(1)); await enter(input)
  expect(onScan).toHaveBeenCalledTimes(3)
})

test('手输等实际异步结果，连续Enter只调用一次，失败保留原值并聚焦全选', async () => {
  let finish!: (result: 'rejected') => void
  const onScan = vi.fn(() => new Promise<'rejected'>(resolve => { finish = resolve }))
  await act(async () => root.render(<PdaScanner onScan={onScan} />))
  const input = await manual('I000123')
  await enter(input); await enter(input)
  expect(onScan).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-scanner-manual]')).toBe(input)
  expect(input.readOnly || input.disabled).toBe(true)
  await act(async () => finish('rejected'))
  await vi.waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.value).toBe('I000123')
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(7)
  expect(input.readOnly || input.disabled).toBe(false)
})

test('确认按钮也等结果；明确成功后收起，默认模式不重新聚焦', async () => {
  let finish!: (result: 'accepted') => void
  const onScan = vi.fn(() => new Promise<'accepted'>(resolve => { finish = resolve }))
  await act(async () => root.render(<PdaScanner onScan={onScan} />))
  expect(host.querySelector('input')).toBeNull()
  const input = await manual('I000123')
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '确认')!.click() })
  expect(host.querySelector('[data-scanner-manual]')).toBe(input)
  await act(async () => finish('accepted'))
  expect(host.querySelector('input')).toBeNull()
  expect(document.activeElement).not.toBe(input)
})

test('被忽略的迟到结果不抢焦点，不清掉原手输', async () => {
  let finish!: (result: 'ignored') => void
  const onScan = () => new Promise<'ignored'>(resolve => { finish = resolve })
  await act(async () => root.render(<><PdaScanner onScan={onScan} /><button id="elsewhere">其他动作</button></>))
  const input = await manual('I000123'); await enter(input)
  // 模拟隐藏实例/身份代次失效后的读取，页面回调明确忽略该结果。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 90)) })
  host.querySelector<HTMLButtonElement>('#elsewhere')!.focus()
  await act(async () => finish('ignored'))
  expect(document.activeElement).toBe(host.querySelector('#elsewhere'))
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('I000123')
})

test('原结果待确认保留只读原码，不开放Enter重发；只认原键恢复成功才清理', async () => {
  const onScan = vi.fn(() => ({ kind: 'pending', requestKey: 'original' }) as const)
  await act(async () => root.render(<PdaScanner onScan={onScan} />))
  const input = await manual('A01'); await enter(input)
  expect(host.querySelector('[data-scanner-manual]')).toBe(input)
  expect(input.readOnly || input.disabled).toBe(true)
  await enter(input); expect(onScan).toHaveBeenCalledTimes(1)
  await act(async () => root.render(<PdaScanner onScan={onScan} resolution={{ requestKey: 'another', outcome: 'accepted' }} />))
  expect(host.querySelector('input')).toBe(input)
  await act(async () => root.render(<PdaScanner onScan={onScan} resolution={{ requestKey: 'original', outcome: 'accepted' }} />))
  expect(host.querySelector('input')).toBeNull()
})

test('原键明确失败才恢复手输编辑与全选；解除disabled不推断原结果', async () => {
  const onScan = vi.fn(() => ({ kind: 'pending', requestKey: 'original' }) as const)
  await act(async () => root.render(<PdaScanner onScan={onScan} />))
  const input = await manual('A01'); await enter(input)
  await act(async () => root.render(<PdaScanner onScan={onScan} disabled />))
  await act(async () => root.render(<PdaScanner onScan={onScan} />))
  expect(input.readOnly).toBe(true)
  await enter(input); expect(onScan).toHaveBeenCalledTimes(1)
  await act(async () => root.render(<PdaScanner onScan={onScan} resolution={{ requestKey: 'original', outcome: 'rejected' }} />))
  expect(input.readOnly).toBe(false)
  await vi.waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(3)
})

test('旧void调用仍能收起；未挂载组件的迟到失败不聚焦', async () => {
  await act(async () => root.render(<PdaScanner onScan={() => {}} />))
  await enter(await manual('I000123'))
  expect(host.querySelector('input')).toBeNull()
  let fail!: (reason: Error) => void
  await act(async () => root.render(<PdaScanner onScan={() => new Promise<never>((_resolve, reject) => { fail = reject })} />))
  await enter(await manual('I000123'))
  await act(async () => root.render(<button id="next">下一页</button>))
  host.querySelector<HTMLButtonElement>('#next')!.focus()
  await act(async () => fail(new Error('读取失败')))
  expect(document.activeElement).toBe(host.querySelector('#next'))
})
