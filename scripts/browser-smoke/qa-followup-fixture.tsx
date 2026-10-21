import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import api, { setApiClientBaseURL } from '../../frontend/src/api/client'
import { useAuthStore } from '../../frontend/src/store/authStore'
import { useWorkspaceStore, HOME_TAB } from '../../frontend/src/store/workspaceStore'
import { KeepAliveOutlet } from '../../frontend/src/components/layout/KeepAliveOutlet'
import { AppToast } from '../../frontend/src/components/shared/AppToast'
import Pick from '../../frontend/src/pages/pda/task'
import Sort from '../../frontend/src/pages/pda/sort'
import Forbidden from '../../frontend/src/pages/403'
import { PERMISSIONS as P } from '../../frontend/src/lib/permission-codes'
import { initDeviceBinding, saveDeviceCredential, saveDeviceSession } from '../../frontend/src/lib/pdaDeviceBinding'

// 真实页面、Scanner、Axios拦截器、Query、HashRouter、注册表和KeepAlive权限闸门。
// 只隔离网络传输与设备凭据；不会访问后端、数据库或真实账号。
const mode = new URLSearchParams(location.search).get('mode') ?? 'pick'
localStorage.clear(); sessionStorage.clear()
setApiClientBaseURL('https://qa-followup.invalid/api')
useAuthStore.getState().login('synthetic-qa-token', null, {
  id: 990001, username: 'qa-followup', realName: '本地合成验收', roleId: 81, roleName: '合成验收角色',
  permissions: [P.PRINT_TEMPLATE_VIEW, ...(mode === 'template-allowed' ? [P.PRINT_TEMPLATE_MANAGE] : [])],
})
useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
const calls: Array<{ method?: string; url?: string }> = []
const errors: string[] = []
window.addEventListener('error', event => errors.push(event.message))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let releaseLookup: (() => void) | null = null
function reject(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    config, status: 404, statusText: 'Not Found', headers: {},
    data: { success: false, message: '库存条码不存在或已失效', code: 'INVENTORY_BARCODE_NOT_FOUND' },
  })
}
api.defaults.adapter = async config => {
  calls.push({ method: config.method, url: config.url })
  let data: unknown
  if (config.url === '/warehouse-tasks/7') data = {
    id: 7, taskNo: 'WT-QA-007', status: 2, statusName: '待拣货', customerName: '合成验收',
    items: [{ id: 9, productId: 3, requiredQty: 2, pickedQty: 0 }],
  }
  else if (config.url === '/warehouse-tasks/7/pick-suggestions') data = { items: [{ id: 9, productId: 3, productCode: 'P003', productName: '合成测试商品', unit: '个', requiredQty: 2, pickedQty: 0, remaining: 2, suggestions: [] }] }
  else if (config.url === '/sorting-bins') data = []
  else if (config.url === '/sorting-bins/scan' || config.url?.startsWith('/inventory/containers/barcode/')) {
    await new Promise<void>(resolve => { releaseLookup = resolve })
    if (config.url === '/sorting-bins/scan') data = null
    else return reject(config)
  }
  else if (config.url === '/scan-logs/error') data = null
  else if (config.url === '/settings/logo') data = { url: '', updatedAt: null }
  else if (config.url === '/print-templates/preview-data') data = null
  else throw Error('禁止未声明网络端点: ' + config.method + ' ' + config.url)
  return { config, data: { success: true, data }, status: 200, statusText: 'OK', headers: {} }
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
function Harness() {
  const current = useLocation()
  useEffect(() => { window.__qaReady = current.pathname }, [current.pathname])
  return <><Routes>
    <Route path="/pda/task/:id" element={<Pick />} />
    <Route path="/pda/sort" element={<Sort />} />
    <Route path="/403" element={<Forbidden />} />
    <Route path="*" element={<KeepAliveOutlet />} />
  </Routes><AppToast placement="pda" /></>
}
async function mount() {
  await initDeviceBinding()
  await saveDeviceCredential('qa-device', 'synthetic-device-secret')
  await saveDeviceSession({ token: 'synthetic-device-ticket', warehouseId: 8, expiresAt: null, scopes: [] })
  createRoot(document.getElementById('root')!).render(<QueryClientProvider client={qc}><HashRouter><Harness /></HashRouter></QueryClientProvider>)
}
void mount().catch(error => errors.push(String(error)))
window.__qaInspect = () => {
  const input = document.querySelector<HTMLInputElement>('[data-scanner-manual][aria-label^="手动输入："]')
  const alerts = [...document.querySelectorAll<HTMLElement>('[role="alert"]')]
  const header = document.querySelector('header')
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    route: location.hash, input: input ? { value: input.value, readOnly: input.readOnly, focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd } : null,
    alerts: alerts.map(alert => alert.textContent), topFeedback: alerts.length === 1 && header?.nextElementSibling === alerts[0],
    toasts: document.querySelectorAll('.fc-toast').length, calls, errors,
    title: document.querySelector('h1')?.textContent, save: [...document.querySelectorAll('button')].some(button => button.textContent === '保存'),
  }
}
window.__qaReleaseLookup = () => { const release = releaseLookup; releaseLookup = null; release?.() }
declare global { interface Window { __qaReady: string; __qaInspect: () => unknown; __qaReleaseLookup: () => void } }
