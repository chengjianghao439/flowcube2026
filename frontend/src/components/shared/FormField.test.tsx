// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import userEvent from '@testing-library/user-event'
import { getByRole } from '@testing-library/dom'
import { FormField } from './FormField'
import { Input } from '@/components/ui/input'

test('共用字段关联标签和说明，保留原生校验、值及fieldset禁用', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = (disabled: boolean) => <fieldset disabled={disabled}><FormField id="shared-name" label="名称 *" description="保留原名称规则">
    {field => <Input {...field} defaultValue="原草稿" required maxLength={20} />}
  </FormField></fieldset>
  try {
    act(() => root.render(render(false)))
    const input = getByRole(host, 'textbox', { name: '名称 *' }) as HTMLInputElement
    const user = userEvent.setup()
    await act(async () => { await user.click(host.querySelector('label')!) })
    expect(document.activeElement).toBe(input)
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('保留原名称规则')
    expect(input.required).toBe(true); expect(input.maxLength).toBe(20)
    input.value = '仍未保存'
    act(() => root.render(render(true)))
    expect(input.matches(':disabled')).toBe(true)
    expect(input.value).toBe('仍未保存')
  } finally { act(() => root.unmount()); host.remove() }
})
