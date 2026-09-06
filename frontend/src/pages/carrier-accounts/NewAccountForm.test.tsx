// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { NewAccountForm } from './NewAccountForm'

test('快捷新增只提交名称、平台和月结号，失败保留输入便于重试', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const save = vi.fn().mockRejectedValue(new Error('网络暂不可用'))
  try {
    await act(async () => root.render(<NewAccountForm saving={false} onCreate={save} onCancel={() => {}} />))
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    for (const [id, value] of [['new-account-name', '仓库顺丰'], ['new-account-monthly', '00123']]) {
      await act(async () => { const el = host.querySelector<HTMLInputElement>(`#${id}`)!; set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(save).toHaveBeenCalledWith({ name: '仓库顺丰', platformCode: 'sf', monthlyAccount: '00123' })
    expect(host.textContent).toContain('网络暂不可用')
    expect(host.querySelector<HTMLInputElement>('#new-account-monthly')!.value).toBe('00123')
    expect(host.querySelectorAll('input')).toHaveLength(2)
  } finally { await act(async () => root.unmount()); host.remove() }
})
