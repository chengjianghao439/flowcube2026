import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { initializeWorkspaceHistoryGuard, disposeWorkspaceHistoryGuard } from '../../frontend/src/router/workspaceHistoryGuard'
import { KeepAliveOutlet } from '../../frontend/src/components/layout/KeepAliveOutlet'
import { useDirtyGuardStore } from '../../frontend/src/store/dirtyGuardStore'
let navigate: NavigateFunction
const errors: string[] = []
// 注册在 Router/guard 之前，模拟用户在浏览器完成遍历、恢复仍排队时点击确认。
let duringHashChange: (() => void) | null = null
window.addEventListener('hashchange', () => { const callback = duringHashChange; duringHashChange = null; callback?.() }, true)
window.addEventListener('error', event => errors.push(event.message))
const observedRoutes: string[] = []
function Harness() {
  const currentNavigate = useNavigate()
  const [ready, setReady] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setReady(true), 20); return () => clearTimeout(timer) }, [])
  if (ready) navigate = currentNavigate
  const location = useLocation()
  observedRoutes.push(location.pathname + location.search)
  return <><output>{location.pathname + location.search}</output>{ready && <KeepAliveOutlet />}</>
}
initializeWorkspaceHistoryGuard()
const root = createRoot(document.getElementById('root')!)
root.render(<HashRouter><Harness /></HashRouter>)
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10))
  if (!predicate()) throw new Error('等待状态超时: ' + JSON.stringify({ url: window.location.href, state: history.state, route: route(), pending: !!useDirtyGuardStore.getState().pendingConfirm, errors }))
}
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const route = () => document.querySelector('output')?.textContent
async function run() {
  await waitFor(() => typeof navigate === 'function')
  navigate('/sale/new?draft=abc', { state: { draft: 'retained' } })
  await waitFor(() => route() === '/sale/new?draft=abc')
  useDirtyGuardStore.getState().setDirty('/sale/new', true)
  const beforeUrl = window.location.href, beforeState = JSON.stringify(history.state)
  observedRoutes.length = 0
  history.back()
  await waitFor(() => !!useDirtyGuardStore.getState().pendingConfirm)
  assert(!observedRoutes.includes('/dashboard?from=list'), '确认前 Router 已渲染目标: ' + JSON.stringify(observedRoutes))
  assert(window.location.href === beforeUrl, '确认前完整 file URL 丢失')
  assert(JSON.stringify(history.state) === beforeState, '确认前 history state 丢失')
  assert(route() === '/sale/new?draft=abc', '确认前 HashRouter 已切页')
  useDirtyGuardStore.getState().resolveConfirm(false)
  history.back()
  await waitFor(() => !!useDirtyGuardStore.getState().pendingConfirm)
  assert(route() === '/sale/new?draft=abc', '取消后再次后退绕过确认')
  useDirtyGuardStore.getState().resolveConfirm(true)
  await waitFor(() => route() === '/dashboard?from=list')
  assert(window.location.href === beforeUrl.split('#')[0] + '#/dashboard?from=list', '确认后文档 query 或目标 query 丢失')
  history.forward()
  await waitFor(() => route() === '/sale/new?draft=abc')
  assert(JSON.stringify(history.state) === beforeState, '确认后前进历史丢失')
  navigate('/products?keyword=abc', { state: { view: 'products' } })
  await waitFor(() => route() === '/products?keyword=abc')
  useDirtyGuardStore.getState().setDirty('/products', true)
  const productsUrl = window.location.href
  history.go(-2)
  await waitFor(() => !!useDirtyGuardStore.getState().pendingConfirm)
  // 在第二次后退的恢复仍排队时确认，不能从错误的历史位置继续遍历。
  duringHashChange = () => useDirtyGuardStore.getState().resolveConfirm(true)
  history.back()
  await waitFor(() => route() === '/dashboard?from=list')
  history.go(2)
  await waitFor(() => route() === '/products?keyword=abc')
  const productState = JSON.stringify(history.state)
  history.replaceState({ external: true }, '', '#/dashboard?from=external')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  assert(window.location.href === productsUrl, '无 idx 时未保留完整 file 地址')
  assert(JSON.stringify(history.state) === productState, '无 idx 时当前 state 丢失')
  assert(route() === '/products?keyword=abc', '无 idx 时绕过确认')
  useDirtyGuardStore.getState().resolveConfirm(true)
  await waitFor(() => route() === '/dashboard?from=external')
  assert(errors.length === 0, errors.join('; '))
  return { status: 'passed', checks: ['file document URL/query', 'HashRouter capture order', 'history state', 'cancel/retry', 'confirm/back/forward', 'repeated/multi-step back', 'external state without idx'], errors }
}
run().then(result => { window.__navigationResult = result }).catch(error => {
  window.__navigationResult = { status: 'failed', message: error.message, errors }
}).finally(() => { root.unmount(); disposeWorkspaceHistoryGuard() })
declare global { interface Window { __navigationResult: unknown } }
