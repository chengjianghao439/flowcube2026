import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { initializeWorkspaceHistoryGuard, disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { KeepAliveOutlet } from './KeepAliveOutlet'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/router/routeRegistry', () => ({
  PATH_TITLES: {}, isRegisteredErpRoute: () => true,
  resolveRouteComponent: () => null, resolveRoutePermission: () => null, resolveRouteTitle: (path: string) => path,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

export function navigationCases() {
  let root: ReturnType<typeof createRoot>
  let host: HTMLDivElement
  let navigate: NavigateFunction
  let rendered: string[]
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(predicate()).toBe(true)
  }
  const route = () => host.querySelector('output')?.textContent
  const pending = () => useDirtyGuardStore.getState().pendingConfirm !== null
  beforeEach(async () => {
    initializeWorkspaceHistoryGuard()
    useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null })
    useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
    window.history.replaceState({ idx: 0 }, '', '#/dashboard?from=list')
    host = document.createElement('div'); document.body.append(host)
    root = createRoot(host); rendered = []
    function Harness() {
      navigate = useNavigate()
      const location = useLocation()
      const path = location.pathname + location.search
      rendered.push(path)
      return <><output>{path}</output><KeepAliveOutlet /></>
    }
    await act(async () => root.render(<HashRouter><Harness /></HashRouter>))
    await act(async () => navigate('/sale/new?draft=abc', { state: { draft: 'retained' } }))
    useDirtyGuardStore.getState().setDirty('/sale/new', true)
    rendered = []
  })
  afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); disposeWorkspaceHistoryGuard() })

  test('dirty 后退先确认，取消保留完整文档地址、query、history state 和 Router 页面', async () => {
    const before = { url: window.location.href, state: window.history.state }
    await act(async () => { window.history.back(); await waitFor(pending) })
    expect(window.location.href).toBe(before.url)
    expect(window.history.state).toEqual(before.state)
    expect(route()).toBe('/sale/new?draft=abc')
    expect(rendered).not.toContain('/dashboard?from=list')
    await act(async () => useDirtyGuardStore.getState().resolveConfirm(false))
    expect(route()).toBe('/sale/new?draft=abc')
    expect(window.location.href).toBe(before.url)
    // 取消没有吞掉历史记录，第二次后退仍须确认。
    await act(async () => { window.history.back(); await waitFor(pending) })
    expect(route()).toBe('/sale/new?draft=abc')
    expect(window.location.href).toBe(before.url)
  })

  test('确认后退到原目标，保持文档query及前进历史，dirty 页面不会绕过确认', async () => {
    const base = window.location.href.split('#')[0]
    const beforeState = window.history.state
    await act(async () => { window.history.back(); await waitFor(pending) })
    expect(route()).toBe('/sale/new?draft=abc')
    await act(async () => { useDirtyGuardStore.getState().resolveConfirm(true); await waitFor(() => window.location.hash === '#/dashboard?from=list') })
    expect(route()).toBe('/dashboard?from=list')
    expect(window.location.href).toBe(`${base}#/dashboard?from=list`)
    expect(pending()).toBe(false)
    await act(async () => { window.history.forward(); await waitFor(() => window.location.hash === '#/sale/new?draft=abc') })
    expect(route()).toBe('/sale/new?draft=abc')
    expect(window.history.state).toEqual(beforeState)
  })

  test('连续后退不会覆盖待确认目标，多步后退确认后保留整条前进历史', async () => {
    await act(async () => navigate('/products?keyword=abc', { state: { view: 'products' } }))
    useDirtyGuardStore.getState().setDirty('/products', true)
    const beforeUrl = window.location.href
    await act(async () => { window.history.go(-2); await waitFor(pending) })
    expect(route()).toBe('/products?keyword=abc')
    await act(async () => {
      window.history.back()
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(window.location.href).toBe(beforeUrl)
    await act(async () => { useDirtyGuardStore.getState().resolveConfirm(true); await waitFor(() => window.location.hash === '#/dashboard?from=list') })
    expect(route()).toBe('/dashboard?from=list')
    await act(async () => { window.history.go(2); await waitFor(() => window.location.hash === '#/products?keyword=abc') })
    expect(route()).toBe('/products?keyword=abc')
    expect(window.history.state.usr).toEqual({ view: 'products' })
  })

  test('外部无 idx 的 history 变化也保留当前页面，确认后才通知 Router', async () => {
    const before = { url: window.location.href, state: window.history.state }
    await act(async () => {
      window.history.replaceState({ external: true }, '', '#/dashboard?from=external')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    expect(pending()).toBe(true)
    expect(route()).toBe('/sale/new?draft=abc')
    expect(window.location.href).toBe(before.url)
    expect(window.history.state).toEqual(before.state)
    await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
    expect(route()).toBe('/dashboard?from=external')
    expect(window.history.state).toEqual({ external: true })
  })

  test('干净页面的后退直接交给真实 HashRouter', async () => {
    useDirtyGuardStore.getState().setDirty('/sale/new', false)
    await act(async () => { window.history.back(); await waitFor(() => window.location.hash === '#/dashboard?from=list') })
    expect(route()).toBe('/dashboard?from=list')
    expect(pending()).toBe(false)
  })
}
