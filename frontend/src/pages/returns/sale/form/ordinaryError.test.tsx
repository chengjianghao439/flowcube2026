// @vitest-environment jsdom
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient from '@/api/client'
import { AppToast } from '@/components/shared/AppToast'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import SaleReturnFormPage from './index'

// 来源、提交 API、payloadClient、Axios 拦截器与提示组件均使用真实实现。
// 仅隔离本用例不会操作的主数据选择器，避免发出额外查询。
vi.mock('@/components/finder', () => ({ CustomerFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <span>仓一</span> }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))

const originalAdapter = apiClient.defaults.adapter
const originalBaseURL = apiClient.defaults.baseURL
const path = '/returns/sale/new?sourceId=80&sourceNo=SO80'
const source = {
  id: 80, orderNo: 'SO80', customerId: 1, customerName: '原客户', warehouseId: 1, warehouseName: '仓一',
  items: [{ sourceItemId: 30, productId: 1, productCode: 'OLD', productName: '原成交商品', unit: '个', quantity: 10, returnedQty: 2, remainingQty: 8, unitPrice: 8.1234, amount: 81.234 }],
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); localStorage.clear()
  useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useDirtyGuardStore.setState({ dirtyTabs: {} })
  useWorkspaceStore.getState().addTab({ ...buildWorkspaceTabRegistrationFromPath(path), title: '原单退货' })
  apiClient.defaults.baseURL = 'https://original.example.test/api'
})
afterEach(() => { apiClient.defaults.adapter = originalAdapter; apiClient.defaults.baseURL = originalBaseURL })

async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }

test.each([
  { kind: '409 source quota rejection', status: 409, message: '原单可退数量已变化，请核对' },
  { kind: '400 invalid input', status: 400, message: '退货明细不符合原单要求' },
  { kind: 'network error', status: null, message: '无法连接服务器，请检查网络与后端服务是否正常' },
])('ordinary create displays $kind through real Axios, payloadClient and AppToast', async ({ status, message }) => {
  const requests: InternalAxiosRequestConfig[] = []
  apiClient.defaults.adapter = async config => {
    if (config.method === 'get' && config.url === '/returns/sale/source-order') {
      return { config, data: { success: true, data: source }, status: 200, statusText: 'OK', headers: {} }
    }
    if (config.method === 'post' && config.url === '/returns/sale') {
      requests.push(config)
      if (status === null) throw new AxiosError('Network Error', 'ERR_NETWORK', config)
      throw new AxiosError('request failed', 'ERR_BAD_REQUEST', config, undefined, {
        config, status, statusText: 'Rejected', headers: {}, data: { success: false, code: 'BUSINESS_ERROR', message },
      })
    }
    throw new Error(`Unexpected adapter request: ${config.method} ${config.url}`)
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><AppToast /><TabPathContext.Provider value={path}><SaleReturnFormPage /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>))
    await flush()
    expect(host.textContent).toContain('原成交商品')
    const create = [...host.querySelectorAll('button')].find(button => button.textContent === '创建退货单')!
    expect(create.disabled).toBe(false)
    await act(async () => create.click()); await flush()
    expect(requests).toHaveLength(1)
    // 必须验证员工实际看见的提示，不能只断言调用参数。
    expect([...document.querySelectorAll('.fc-toast')].some(toast => toast.textContent?.includes(message))).toBe(true)
    expect(host.textContent).toContain('新建销售退货单')
    expect(host.textContent).not.toContain('已创建，可查看单据')
    expect((host.querySelector('input[placeholder="输入原单号"]') as HTMLInputElement).value).toBe('SO80')
    expect((host.querySelector('input[placeholder="数量"]') as HTMLInputElement).value).toBe('8')
    expect((host.querySelector('input[placeholder="单价"]') as HTMLInputElement).value).toBe('8.1234')
    expect(create.disabled).toBe(false)
    expect(useWorkspaceStore.getState().activeKey).toBe(buildWorkspaceTabRegistrationFromPath(path).key)
    await act(async () => create.click()); await flush()
    expect(requests).toHaveLength(2)
    expect(requests[1].headers.get('X-Request-Key')).toBe(requests[0].headers.get('X-Request-Key'))
    expect(requests[0].headers.get('X-Request-Key')).toBeTruthy()
    for (const request of requests) {
      expect(request.baseURL).toBe('https://original.example.test/api')
      expect(request._authSessionGeneration).toBe(useAuthStore.getState().sessionGeneration)
      expect(request._erpApiFallbackTried).toBe(true)
      expect(JSON.parse(request.data)).toMatchObject({ saleOrderId: 80, saleOrderNo: 'SO80', items: [{ sourceItemId: 30, quantity: 8, unitPrice: 8.1234 }] })
    }
  } finally {
    await act(async () => root.unmount()); host.remove(); cache.clear()
  }
})
