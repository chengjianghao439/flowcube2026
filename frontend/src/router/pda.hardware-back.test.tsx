// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaRouter from './pda'

const state = vi.hoisted(() => ({
  back: undefined as ((event: { canGoBack: boolean }) => void | Promise<void>) | undefined,
  minimize: vi.fn(async () => {}),
  authenticated: true,
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, callback: typeof state.back) => {
      state.back = callback
      return { remove: vi.fn() }
    }),
    minimizeApp: state.minimize,
  },
}))
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } }
})
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (value: { isAuthenticated: boolean }) => unknown) => select({ isAuthenticated: state.authenticated }) }))
vi.mock('@/components/pda/PdaConnectionGate', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/pda/PdaRoutePermission', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/pda/PdaNetworkBar', () => ({ default: () => null }))
vi.mock('@/components/shared/AppToast', () => ({ AppToast: () => null }))
vi.mock('@/hooks/usePdaUpdate', () => ({ usePdaUpdate: () => ({ newVersion: null, dismiss: vi.fn(), checkUpdate: vi.fn() }) }))
vi.mock('@/pages/pda', () => ({ default: function Home() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/pda/picking')}>进入拣货</button>
} }))
vi.mock('@/pages/pda/picking', () => ({ default: () => <div>拣货页面</div> }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.back = undefined
  state.minimize.mockClear()
  state.authenticated = true
  window.history.replaceState(null, '', '/#/pda')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  window.history.replaceState(null, '', '/')
})

test('PDA 实体返回键从拣货页回到工作台，工作台再返回则退到后台', async () => {
  await act(async () => { root.render(<PdaRouter />) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(host.textContent).toContain('进入拣货')
  await act(async () => { host.querySelector('button')!.click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(host.textContent).toContain('拣货页面')
  expect(state.back).toBeDefined()

  await act(async () => {
    await state.back!({ canGoBack: true })
    await new Promise(resolve => setTimeout(resolve, 30))
  })
  expect(window.location.hash).toBe('#/pda')
  expect(host.textContent).toContain('进入拣货')

  await act(async () => { await state.back!({ canGoBack: true }) })
  expect(state.minimize).toHaveBeenCalledTimes(1)
})

test('从外部直达作业页时，实体返回键回到工作台', async () => {
  window.history.replaceState(null, '', '/#/pda/picking')
  await act(async () => { root.render(<PdaRouter />) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(host.textContent).toContain('拣货页面')
  await act(async () => { await state.back!({ canGoBack: false }) })
  expect(window.location.hash).toBe('#/pda')
})

test('登录页实体返回键退到后台', async () => {
  state.authenticated = false
  window.history.replaceState(null, '', '/#/pda/login')
  await act(async () => { root.render(<PdaRouter />) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await state.back!({ canGoBack: false }) })
  expect(state.minimize).toHaveBeenCalledTimes(1)
})
