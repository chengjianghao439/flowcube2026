// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AppRouter from './index'
import PdaRouter from './pda'

// Keep the actual HashRouter, route tree, navigation and auth guards. Replace
// connection/device and page rendering boundaries so no API/session is needed.
const state = vi.hoisted(() => ({ authenticated: true, navigate: undefined as NavigateFunction | undefined }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) => select({ isAuthenticated: state.authenticated }) }))
vi.mock('@/components/pda/PdaConnectionGate', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/erp/ErpDesktopConnectionGate', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/pda/PdaRoutePermission', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/desktop/DesktopUpdateBridge', () => ({ DesktopUpdateBridge: () => null }))
vi.mock('@/components/desktop/DesktopQuitUnloadBridge', () => ({ DesktopQuitUnloadBridge: () => null }))
vi.mock('@/components/desktop/DesktopPrintClientBridge', () => ({ default: () => null }))
vi.mock('@/layouts/AppLayout', async () => {
  const { useLocation, useNavigate } = await import('react-router-dom')
  return { default: function ErpBoundary() {
    state.navigate = useNavigate()
    const location = useLocation()
    return <div data-client="erp">{location.pathname}{location.search}</div>
  } }
})
vi.mock('@/layouts/PdaLayout', async () => {
  const { Outlet, useLocation, useNavigate } = await import('react-router-dom')
  return { default: function PdaBoundary() {
    state.navigate = useNavigate()
    const location = useLocation()
    return <div data-client="pda">{location.pathname}{location.search}<Outlet /></div>
  } }
})
vi.mock('@/pages/pda', () => ({ default: () => <span>仓库作业</span> }))
vi.mock('@/pages/pda/sale-return-receive', () => ({ default: () => <span>退货收货</span> }))
vi.mock('@/pages/pda/sale-return-putaway', () => ({ default: () => <span>退货上架</span> }))
vi.mock('@/pages/login', () => ({ default: () => <span>ERP 登录</span> }))
vi.mock('@/pages/pda/login', () => ({ default: () => <span>PDA 登录</span> }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.authenticated = true
  state.navigate = undefined
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  window.history.replaceState(null, '', '/')
})
async function renderAt(path: string) {
  window.history.replaceState(null, '', `/#${path}`)
  await act(async () => { root.render(<AppRouter />) })
}
async function navigate(to: string | number) {
  await act(async () => {
    if (typeof to === 'number') state.navigate!(to)
    else state.navigate!(to)
    // Hash history back/forward emits popstate on the next task.
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

test.each(['/dashboard', '/sale/31', '/accounting/vouchers'])('ERP wildcard matches %s', async path => {
  await renderAt(path)
  expect(host.querySelector('[data-client="erp"]')?.textContent).toBe(path)
  expect(host.querySelector('[data-client="pda"]')).toBeNull()
})

test.each([['/pda', '仓库作业'], ['/pda/sale-return/31/receive', '退货收货'], ['/pda/sale-return/31/putaway', '退货上架']])('PDA child %s wins over ERP wildcard', async (path, title) => {
  await renderAt(path)
  expect(host.querySelector('[data-client="pda"]')?.textContent).toContain(title)
  expect(host.querySelector('[data-client="erp"]')).toBeNull()
})

test.each([['/dashboard', '/sale/31?from=dashboard', 'erp'], ['/pda', '/pda/sale-return/31/putaway', 'pda']])('absolute navigation and browser back preserve %s client', async (from, to, client) => {
  await renderAt(from)
  await navigate(to)
  expect(window.location.hash).toBe(`#${to}`)
  expect(host.querySelector(`[data-client="${client}"]`)?.textContent).toContain(to)
  await navigate(-1)
  expect(window.location.hash).toBe(`#${from}`)
  expect(host.querySelector(`[data-client="${client}"]`)).not.toBeNull()
})

test.each([['/dashboard', '/pda'], ['/pda', '/dashboard']])('cross-client navigation from %s is restored', async (from, to) => {
  await renderAt(from)
  await navigate(to)
  expect(window.location.hash).toBe(`#${from}`)
})

test.each([['/sale/31', '/login', 'ERP 登录'], ['/pda/sale-return/31/putaway', '/pda/login', 'PDA 登录']])('unauthenticated %s redirects to its own login', async (path, login, label) => {
  state.authenticated = false
  await renderAt(path)
  expect(window.location.hash).toBe(`#${login}`)
  expect(host.textContent).toBe(label)
})

test.each([true, false])('独立 PDA 构建复用认证与业务路由 authenticated=%s', async authenticated => {
  state.authenticated = authenticated
  window.history.replaceState(null, '', '/#/pda')
  await act(async () => { root.render(<PdaRouter />) })
  expect(host.textContent).toContain(authenticated ? '仓库作业' : 'PDA 登录')
  expect(host.querySelector('[data-client="erp"]')).toBeNull()
})
