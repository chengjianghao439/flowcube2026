// @vitest-environment jsdom
import { act, StrictMode } from 'react'
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

test.each([0, 1])('桌面原生框等待时父组件刷新，响应 %i 只调用最新回调一次', async response => {
  let settle!: (value: { response: number }) => void
  const showMessageBox = vi.fn(() => new Promise<{ response: number }>(resolve => { settle = resolve }))
  Object.defineProperty(window, 'flowcubeDesktop', { configurable: true, value: { isDesktop: true, showMessageBox } })
  try {
    const initial = render()
    const { root } = roots.at(-1)!
    const confirm = vi.fn(), cancel = vi.fn()
    act(() => root.render(<ConfirmDialog open title="放弃未保存输入？" description={'关闭后本次输入不会保存。\n可返回表单继续编辑。'} confirmText="放弃并关闭" cancelText="继续编辑" onConfirm={confirm} onCancel={cancel} />))
    await act(async () => settle({ response }))
    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledTimes(response === 0 ? 1 : 0)
    expect(cancel).toHaveBeenCalledTimes(response === 0 ? 0 : 1)
    expect(initial.cancel).not.toHaveBeenCalled()
    expect(initial.confirm).not.toHaveBeenCalled()
  } finally { Reflect.deleteProperty(window, 'flowcubeDesktop') }
})

test('桌面严格模式每次打开只弹一次，关闭重开及卸载后丢弃旧窗口结果', async () => {
  const completions: Array<(value: { response: number }) => void> = []
  const showMessageBox = vi.fn(() => new Promise<{ response: number }>(resolve => completions.push(resolve)))
  Object.defineProperty(window, 'flowcubeDesktop', { configurable: true, value: { isDesktop: true, showMessageBox } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const confirm = vi.fn(), cancel = vi.fn()
  const show = (open: boolean) => act(() => root.render(<StrictMode><ConfirmDialog open={open} title="删除？" description="请核对" onConfirm={confirm} onCancel={cancel} /></StrictMode>))
  try {
    show(true)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    await act(async () => completions[0]({ response: 0 }))
    expect(confirm).toHaveBeenCalledOnce()
    show(false); show(true)
    show(false); show(true)
    await act(async () => completions[1]({ response: 0 }))
    expect(confirm).toHaveBeenCalledOnce()
    await act(async () => completions[2]({ response: 1 }))
    expect(cancel).toHaveBeenCalledOnce()
    show(false); show(true)
    act(() => root.render(null))
    await act(async () => completions[3]({ response: 0 }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(showMessageBox).toHaveBeenCalledTimes(4)
  } finally {
    act(() => root.unmount()); host.remove()
    Reflect.deleteProperty(window, 'flowcubeDesktop')
  }
})

test('提示所指对象或危险等级切换时，旧点击不能授权当前操作', async () => {
  const completions: Array<(value: { response: number }) => void> = []
  const showMessageBox = vi.fn(() => new Promise<{ response: number }>(resolve => completions.push(resolve)))
  Object.defineProperty(window, 'flowcubeDesktop', { configurable: true, value: { isDesktop: true, showMessageBox } })
  try {
    const first = render()
    const { root } = roots.at(-1)!
    const confirm = vi.fn(), cancel = vi.fn()
    act(() => root.render(<ConfirmDialog open title="删除订单 B？" description="删除后不能恢复" variant="destructive" confirmText="删除订单" onConfirm={confirm} onCancel={cancel} />))
    await act(async () => completions[0]({ response: 0 }))
    expect(first.confirm).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    await act(async () => completions[1]({ response: 0 }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
  } finally { Reflect.deleteProperty(window, 'flowcubeDesktop') }
})
