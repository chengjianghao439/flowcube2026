// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import LoginPage from './index'

const auth = vi.hoisted(() => ({
  mutate: vi.fn(), isPending: false, error: null as Error | null, redirect: vi.fn(), applyBase: vi.fn(),
}))
vi.mock('@/hooks/useAuth', () => ({ useLogin: (target: string) => {
  auth.redirect(target)
  return { mutate: auth.mutate, isPending: auth.isPending, error: auth.error }
} }))
vi.mock('@/lib/apiOrigin', () => ({ applyErpApiBaseFromStorage: auth.applyBase }))

let host: HTMLDivElement, root: Root
async function render() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/sale' } } }]}>
      <LoginPage />
    </MemoryRouter>,
  ))
}
async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  auth.isPending = false; auth.error = null
  localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

test('保留已记住的账号、原目标回跳及密码原值提交', async () => {
  localStorage.setItem('flowcube-saved-username', 'operator')
  await render()
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe('operator')
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('')
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await fill('password', ' sample password ')
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(auth.applyBase).toHaveBeenCalledOnce()
  expect(auth.mutate).toHaveBeenCalledWith({ username: 'operator', password: ' sample password ' })
  expect(auth.redirect).toHaveBeenLastCalledWith('/sale')
  expect(localStorage.length).toBe(1)
})

test('密码可显隐，提交中锁定控件并阻止再次提交', async () => {
  await render()
  await fill('username', 'operator'); await fill('password', 'sample-password')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!.click())
  expect(host.querySelector<HTMLInputElement>('#password')!.type).toBe('text')
  auth.isPending = true
  await render()
  expect(host.querySelector('form')!.getAttribute('aria-busy')).toBe('true')
  expect([...host.querySelectorAll<HTMLInputElement | HTMLButtonElement>('form input, form button')].every(el => el.disabled)).toBe(true)
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(auth.mutate).not.toHaveBeenCalled()
})

test('登录错误在表单内可被辅助技术定位，输入内容保留用于重试', async () => {
  await render()
  await fill('username', 'operator'); await fill('password', 'sample-password')
  auth.error = new Error('网络连接失败，请稍后重试')
  await render()
  const alert = host.querySelector('[role="alert"]')!
  expect(alert.textContent).toContain(auth.error.message)
  expect(alert.id).not.toBe('')
  expect(host.querySelector('form')!.getAttribute('aria-describedby')).toContain(alert.id)
  expect(host.querySelector<HTMLInputElement>('#username')!.value).toBe('operator')
  expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('sample-password')
})
