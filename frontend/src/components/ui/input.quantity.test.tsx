// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Input } from './input'
import { toast } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
let host: HTMLDivElement, root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.clearAllMocks() })
afterEach(() => { act(() => root.unmount()); host.remove() })
function enter(value: string) {
  const input = host.querySelector('input')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  return input
}

test.each(['1.234', '1.0001', '0.001', '1e-3'])('数量拒绝 %s，不传给业务回调也不悄悄取整', value => {
  const change = vi.fn()
  act(() => root.render(<Input quantity type="number" value="1.23" onChange={change} />))
  expect(enter(value).value).toBe('1.23')
  expect(change).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith('数量最多保留两位小数')
})

test.each(['1.2300', '0.01', '123e-2', '', '0'])('数量接受有效精度 %s', value => {
  const change = vi.fn()
  act(() => root.render(<Input quantity type="number" defaultValue="1" onChange={change} />))
  enter(value)
  expect(change).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
})

test('整数商品拒绝小数，金额四位输入不受数量校验影响', () => {
  const change = vi.fn()
  act(() => root.render(<Input quantity type="number" step="1" value="1" onChange={change} />))
  enter('1.5')
  expect(change).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith('该商品数量只能是整数')
  act(() => root.render(<Input type="number" step="0.01" value="1" onChange={change} />))
  enter('1.2345')
  expect(change).toHaveBeenCalledOnce()
})

test('粘贴三位小数被拒绝且给出提示', () => {
  act(() => root.render(<Input quantity type="number" defaultValue="2" />))
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => '1.234' } })
  act(() => host.querySelector('input')!.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(toast.error).toHaveBeenCalledWith('数量最多保留两位小数')
})

test('采购建议失焦写入不发送非法数量', () => {
  const save = vi.fn()
  act(() => root.render(<Input quantity type="number" defaultValue="2" onBlur={e => save(Number(e.target.value))} />))
  const input = enter('2.345')
  act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(save).not.toHaveBeenCalled()
})

test('受控输入拒绝三位小数后仍能继续修改合法值', () => {
  function Form() { const [value, setValue] = useState('1.2'); return <Input quantity type="number" value={value} onChange={e => setValue(e.target.value)} /> }
  act(() => root.render(<Form />))
  enter('1.234')
  expect(enter('1.24').value).toBe('1.24')
})
