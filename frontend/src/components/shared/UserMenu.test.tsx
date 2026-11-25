// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import UserMenu from './UserMenu'

let root: Root
let host: HTMLDivElement
let queryClient: QueryClient
let navigate: NavigateFunction

async function press(user: ReturnType<typeof userEvent.setup>, key: string) {
  await act(async () => user.keyboard(key))
  // Radix moves focus on the next task after roving or unmounting its focus scope.
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
}

function Harness() {
  navigate = useNavigate()
  return <UserMenu />
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  queryClient = new QueryClient()
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={queryClient}><Harness /></QueryClientProvider></MemoryRouter>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
  host.remove()
})

test('键盘打开用户菜单、在操作间移动并用 Escape 回到触发器', async () => {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: /用户菜单/ })
  trigger.focus()
  await press(user, '{ArrowDown}')
  const menu = screen.getByRole('menu')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '我的信息' }))
  await press(user, '{ArrowDown}')
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '修改密码' }))
  await press(user, '{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('从用户菜单打开密码弹窗后，关闭弹窗可以继续使用原入口', async () => {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: /用户菜单/ })
  trigger.focus()
  await press(user, '{ArrowDown}')
  await press(user, '{ArrowDown}')
  await press(user, '{Enter}')
  const dialog = screen.getByRole('dialog', { name: '修改密码' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(within(dialog).getByLabelText(/当前密码/)).toBe(document.activeElement)
  await press(user, '{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('鼠标重复点用户按钮可以收起，外部路由切换也会关闭菜单', async () => {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: /用户菜单/ })
  await act(async () => user.click(trigger))
  expect(screen.getByRole('menu')).toBeTruthy()
  await act(async () => user.click(trigger))
  expect(screen.queryByRole('menu')).toBeNull()
  await act(async () => user.click(trigger))
  expect(screen.getByRole('menu')).toBeTruthy()
  await act(async () => navigate('/dashboard'))
  expect(screen.queryByRole('menu')).toBeNull()
})
