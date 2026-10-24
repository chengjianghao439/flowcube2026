// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { getByRole } from '@testing-library/dom'
import { ContentTabs } from './ContentTabs'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const hosts: HTMLDivElement[] = []
afterEach(() => { hosts.splice(0).forEach(host => host.remove()) })

test('内容首次访问才挂载，方向键/Home/End关联面板，切回保留输入并忽略禁用项', async () => {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host); const mount = vi.fn(); const change = vi.fn()
  function Lazy() { useEffect(() => { mount() }, []); return <p>统计内容</p> }
  function Example() {
    const [value, setValue] = useState('info')
    return <ContentTabs label="样本内容" value={value} onValueChange={next => { change(next); setValue(next) }} tabs={[
      { value: 'info', label: '基本资料', content: <input aria-label="草稿" defaultValue="原值" /> },
      { value: 'blocked', label: '暂不可用', disabled: true, content: <p>禁止内容</p> },
      { value: 'stats', label: '统计', content: <Lazy /> },
    ]} />
  }
  try {
    act(() => root.render(<Example />))
    expect(mount).not.toHaveBeenCalled()
    const draft = getByRole(host, 'textbox', { name: '草稿' }) as HTMLInputElement
    draft.value = '未保存'
    const user = userEvent.setup()
    act(() => getByRole(host, 'tab', { name: '基本资料' }).focus())
    await act(async () => { await user.keyboard('{ArrowRight}') })
    const tab = getByRole(host, 'tab', { name: '统计' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById(tab.getAttribute('aria-controls')!)?.textContent).toContain('统计内容')
    expect(mount).toHaveBeenCalledOnce()
    await act(async () => { await user.keyboard('{Home}') })
    expect(getByRole(host, 'textbox', { name: '草稿' })).toBe(draft)
    expect(draft.value).toBe('未保存')
    await act(async () => { await user.keyboard('{End}') })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(mount).toHaveBeenCalledOnce()
    change.mockClear()
    await act(async () => { await user.click(getByRole(host, 'tab', { name: '基本资料' })) })
    expect(change).toHaveBeenCalledExactlyOnceWith('info')
  } finally { act(() => root.unmount()) }
})
