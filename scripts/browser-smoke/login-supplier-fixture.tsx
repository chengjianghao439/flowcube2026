import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import AppRouter from '../../frontend/src/router'
import api from '../../frontend/src/api/client'
import { useAuthStore } from '../../frontend/src/store/authStore'
import { useWorkspaceStore } from '../../frontend/src/store/workspaceStore'
import { clearAuthPersistedState } from '../../frontend/src/lib/authSession'
import { WIDGETS } from '../../frontend/src/components/dashboard/registry'
import { hasPermission } from '../../frontend/src/lib/permissions'
import type { User } from '../../frontend/src/types'
import approved from '../../tests/fixtures/qa-roles-approved-20261021.json'

// 原始AppRouter/AppLayout、页面、权限、工作区、登录表单和CSS；只使用合成HTTP。
localStorage.clear(); sessionStorage.clear()
useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false })
useWorkspaceStore.getState().closeAll()
const calls: { method?: string; url?: string; params: unknown }[] = []
const errors: string[] = []
const routes: string[] = []
let monthlyFailure = false
let currentUser: User | null = null
const recordRoute = () => { routes.push(location.hash) }
window.addEventListener('hashchange', recordRoute)
window.addEventListener('popstate', recordRoute)
window.addEventListener('error', event => errors.push(event.message))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
function userOf(code: string) {
  if (code === 'no-permissions' || code === 'payment-only') {
    return { id: 9999, username: code, realName: '合成低权限账号', roleId: 99, roleName: '合成低权限角色', permissions: code === 'payment-only' ? ['payment.view'] : [] }
  }
  const role = approved.roles.find(item => item.code === code)
  if (!role) throw new Error('未声明的合成岗位')
  return { id: 9900 + role.id, username: code, realName: '合成页面验收', roleId: role.id, roleName: role.name, permissions: [...role.after] }
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
api.defaults.adapter = async config => {
  calls.push({ method: config.method, url: config.url, params: config.params })
  const params = config.params ?? {}
  let data: unknown
  if (config.url === '/auth/login') {
    const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    currentUser = userOf(input.username)
    data = { token: 'synthetic-browser-token', refreshToken: null, user: currentUser }
  } else if (config.url === '/settings/logo') data = { url: '' }
  else if (config.url === '/printer-bindings') data = { defaultBindings: {} }
  else if (config.url === '/notifications') data = { items: [], total: 0 }
  else if (config.url === '/reports/role-workbench') data = { sections: [], summary: { totalAlerts: 0 }, topAlert: null }
  else if (config.url?.startsWith('/dashboard/') && !hasPermission(currentUser?.permissions, 'dashboard.view', currentUser?.roleId)) {
    throw new AxiosError('无操作权限', 'ERR_BAD_REQUEST', config, undefined, { config, status: 403, statusText: 'Forbidden', headers: {}, data: { success: false, message: '无操作权限' } })
  }
  else if (config.url === '/dashboard/low-stock') data = []
  // 使用真实布局DTO隐藏所有卡片，让浏览器验收聚焦导航；不替换仪表盘组件。
  else if (config.url === '/dashboard/layout') data = { widgets: WIDGETS.map(widget => ({ id: widget.id, visible: false, w: widget.defaultW })) }
  else if (config.url === '/fulfillment/issues') data = { list: [], pagination: { page: 1, pageSize: 200, total: 0 }, summary: { open: 0, mine: 0, overdue: 0, unassigned: 0 } }
  else if (config.url === '/payments') {
    const monthly = params.settlementTypes === '2'
    if (monthly && monthlyFailure) throw new AxiosError('合成月结读取失败', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 500, statusText: 'Error', headers: {}, data: { success: false, message: '合成月结读取失败' } })
    data = {
      list: [{ id: monthly ? 302 : 301, type: 1, typeName: '应付', orderNo: monthly ? 'PO-MONTHLY-NO-STATEMENT' : 'PO-CASH', partyName: monthly ? '合成月结供应商' : '合成现结供应商', totalAmount: monthly ? 40 : 100, paidAmount: monthly ? 6.87 : 30, balance: monthly ? 33.13 : 70, status: 2, statusName: '部分付款', confirmStatus: 1, dueDate: '2026-11-30', createdAt: '2026-03-24T00:00:00+08:00' }],
      pagination: { page: 1, pageSize: 200, total: 1 }, summary: { totalAmount: monthly ? 40 : 100, paidAmount: monthly ? 6.87 : 30, balance: monthly ? 33.13 : 70 },
    }
  } else throw new Error('禁止未声明HTTP端点：' + config.method + ' ' + config.url)
  return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
}
if (new URLSearchParams(location.search).get('mode') === 'supplier') {
  currentUser = userOf('preset_finance_specialist')
  useAuthStore.getState().login('synthetic-browser-token', null, currentUser)
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={qc}><AppRouter /></QueryClientProvider>)

window.__loginSupplierInspect = () => ({
  hash: location.hash, title: document.querySelector('h1')?.textContent, errors, routes, calls,
  authenticated: useAuthStore.getState().isAuthenticated,
  permissionError: document.body.textContent?.includes('无操作权限') ?? false,
  tabs: useWorkspaceStore.getState().tabs.map(tab => tab.path),
  monthly: document.querySelector('section[aria-label="月结欠款"]')?.textContent,
  cash: document.querySelector('section[aria-label="现结账款"]')?.textContent,
  monthlyActions: [...document.querySelectorAll('section[aria-label="月结欠款"] tbody button')].map(button => button.textContent),
  overflow: document.documentElement.scrollWidth > innerWidth,
})
window.__loginSupplierSwitchAccount = () => {
  // 同一浏览器保留管理员持久标签，模拟旧缓存仍在的新登录；新账号必须清空它们。
  const previousTabs = localStorage.getItem('flowcube-workspace')
  clearAuthPersistedState(); qc.clear()
  if (previousTabs) localStorage.setItem('flowcube-workspace', previousTabs)
  void useWorkspaceStore.persist.rehydrate()
  window.location.hash = '#/reports/role-workbench'
}
window.__loginSupplierFailMonthly = async () => {
  monthlyFailure = true
  await qc.invalidateQueries({ queryKey: ['payments', 'supplier-monthly-outstanding'] })
}
declare global {
  interface Window {
    __loginSupplierInspect: () => unknown
    __loginSupplierSwitchAccount: () => void
    __loginSupplierFailMonthly: () => Promise<void>
  }
}
