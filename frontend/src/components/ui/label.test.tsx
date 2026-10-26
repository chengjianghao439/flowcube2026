// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { getByRole } from '@testing-library/dom'
import { Label } from './label'
import { FormField } from '@/components/shared/FormField'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = []
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove() } })
function mount(children: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ root, host })
  act(() => root.render(children))
  return host
}

test('必填标记独立着色，保留字段名称、label关联和原生校验', () => {
  const host = mount(<FormField id="required-name" label="名称 *">{field => <input {...field} required defaultValue="原草稿" />}</FormField>)
  const input = getByRole(host, 'textbox', { name: '名称 *' }) as HTMLInputElement
  expect(host.querySelector('label > .text-destructive-ink')?.textContent).toBe('*')
  expect(host.querySelector('label')?.htmlFor).toBe(input.id)
  expect(input.required).toBe(true)
  expect(input.value).toBe('原草稿')
})

test('动态条件、Fragment和星号后的密码提示沿原文字呈现', () => {
  const required = true
  const host = mount(<><Label><>{'供应商'}{required ? ' *' : '（选填）'}</></Label><Label>新密码 *（至少 6 位）</Label></>)
  expect([...host.querySelectorAll('label')].map(label => label.textContent)).toEqual(['供应商 *', '新密码 *（至少 6 位）'])
  expect(host.querySelectorAll('.text-destructive-ink')).toHaveLength(2)
})

test('已有红色标记不重复包裹，通配符和乘法仍是普通文字', () => {
  const host = mount(<><Label>账号 <span className="text-destructive-ink">*</span></Label><Label>文件 *.csv</Label><Label>单价 * 数量</Label><Label>可选字段</Label></>)
  expect(host.querySelectorAll('.text-destructive-ink')).toHaveLength(1)
  expect(host.querySelectorAll('.text-destructive-ink .text-destructive-ink')).toHaveLength(0)
  expect([...host.querySelectorAll('label')].map(label => label.textContent)).toEqual(['账号 *', '文件 *.csv', '单价 * 数量', '可选字段'])
})
