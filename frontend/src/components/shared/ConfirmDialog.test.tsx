// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { getByRole } from '@testing-library/dom'
import { ConfirmDialog } from './ConfirmDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
afterEach(() => { for (const { root, host } of roots.splice(0)) { act(() => root.unmount()); host.remove() } })
function render(loading = false) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push({ root, host })
  const cancel = vi.fn(), confirm = vi.fn()
  act(() => root.render(<ConfirmDialog open title="放弃未保存输入？" description={'关闭后本次输入不会保存。\n可返回表单继续编辑。'} confirmText="放弃并关闭" cancelText="继续编辑" loading={loading} onCancel={cancel} onConfirm={confirm} />))
  return { cancel, confirm }
}

test('浏览器确认框将完整说明关联给弹窗，继续编辑只取消确认', () => {
  const { cancel, confirm } = render()
  const dialog = getByRole(document.body, 'dialog', { name: '放弃未保存输入？', description: /关闭后本次输入不会保存。\s+可返回表单继续编辑。/ })
  act(() => getByRole(dialog, 'button', { name: '继续编辑' }).click())
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(confirm).not.toHaveBeenCalled()
})

test('处理中的确认框禁止确认、取消和Escape触发原操作', () => {
  const { cancel, confirm } = render(true)
  const dialog = getByRole(document.body, 'dialog')
  expect(getByRole(dialog, 'button', { name: '继续编辑' }).hasAttribute('disabled')).toBe(true)
  expect(getByRole(dialog, 'button', { name: '处理中…' }).hasAttribute('disabled')).toBe(true)
  act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(cancel).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
})
