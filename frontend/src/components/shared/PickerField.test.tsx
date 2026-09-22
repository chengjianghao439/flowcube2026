// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { PickerField } from './PickerField'

test('禁用选择器同时禁用清除，避免保存期间改变已选项', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'), root = createRoot(host), clear = vi.fn()
  try {
    act(() => root.render(<PickerField value="客户一" placeholder="选择客户" onOpen={vi.fn()} onClear={clear} disabled />))
    const button = host.querySelector<HTMLButtonElement>('[aria-label="清除选择"]')!
    act(() => button.click())
    expect(clear).not.toHaveBeenCalled()
    expect(button.disabled).toBe(true)
  } finally { act(() => root.unmount()) }
})
