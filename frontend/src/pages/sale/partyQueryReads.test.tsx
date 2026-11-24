// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useAuthStore } from '@/store/authStore'
import InboundTaskQueryDialog from '@/pages/inbound-tasks/InboundTaskQueryDialog'
import SaleQueryDialog from './SaleQueryDialog'

vi.mock('@/components/shared/OperatorSelectField', () => ({ default: () => null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => null }))

const adapter = apiClient.defaults.adapter
const read = vi.fn()
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, client: QueryClient
const initial = {
  keyword: '', remark: '', operatorId: null, operatorName: '', status: '',
  productId: null, productName: '', productCode: '', warehouseId: null, warehouseName: '',
  startDate: '', endDate: '', customerId: 42, customerName: '原客户', supplierId: 42, supplierName: '原供应商',
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  read.mockReset()
  setApiClientBaseURL('https://synthetic.invalid/api')
  apiClient.defaults.adapter = async config => {
    read(config.url, config.params)
    return { config, status: 200, statusText: 'OK', headers: {}, data: {
      success: true, data: { list: [], pagination: { page: 1, pageSize: 200, total: 0 } },
    } }
  }
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  client.clear()
  useAuthStore.getState().logout()
  apiClient.defaults.adapter = adapter
  setApiClientBaseURL('/api')
})

test.each([
  { label: '客户', url: '/customers', view: PERMISSIONS.SALE_ORDER_VIEW, lookup: PERMISSIONS.CUSTOMER_VIEW, Dialog: SaleQueryDialog },
  { label: '供应商', url: '/suppliers', view: PERMISSIONS.INBOUND_ORDER_VIEW, lookup: PERMISSIONS.SUPPLIER_VIEW, Dialog: InboundTaskQueryDialog },
])('$label 仅在有查看权限且打开选择器时读取，切走和撤权暂停', async ({ label, url, view, lookup, Dialog }) => {
  const apply = vi.fn()
  const login = (permissions: string[]) => useAuthStore.setState({ token: 'fixture', user: {
    id: 19, roleId: 19, roleName: '合成角色', username: 'fixture', realName: '合成人员', permissions,
  } })
  const draw = (open: boolean, active = true) => act(async () => root.render(
    <QueryClientProvider client={client}><SectionVisibilityContext.Provider value={active}>
      <Dialog open={open} initial={initial} onApply={apply} onClose={() => {}} />
    </SectionVisibilityContext.Provider></QueryClientProvider>,
  ))
  const picker = () => [...document.querySelectorAll<HTMLButtonElement>('button.fc-picker-trigger')]
    .find(button => button.closest('label')?.firstElementChild?.textContent === label)!
  const search = () => document.querySelector<HTMLInputElement>(`input[placeholder="搜索${label}名称、编码…"]`)
  const click = (button: HTMLButtonElement) => act(async () => button.click())
  const requestCount = () => read.mock.calls.filter(call => call[0] === url).length

  login([view])
  await draw(false)
  expect(requestCount()).toBe(0)
  await draw(true)
  expect(picker().disabled).toBe(true)
  expect(picker().textContent).toBe(`原${label}`)
  const applyButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查询')!
  await click(applyButton)
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ customerId: 42, supplierId: 42 }))
  expect(requestCount()).toBe(0)

  await draw(false)
  await act(async () => login([view, lookup]))
  await draw(true)
  expect(requestCount()).toBe(0)
  expect(picker().disabled).toBe(false)
  await click(picker())
  await vi.waitFor(() => expect(requestCount()).toBe(1))

  await act(async () => {
    const input = search()!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '待选名称')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await draw(true, false)
  expect(search()).toBeNull()
  await act(async () => {
    await client.invalidateQueries()
    await new Promise(resolve => setTimeout(resolve, 320))
  })
  expect(requestCount()).toBe(1)
  await draw(true)
  expect(search()?.value).toBe('待选名称')
  await vi.waitFor(() => expect(read).toHaveBeenCalledWith(url, expect.objectContaining({ keyword: '待选名称' })))
  await draw(true, false)
  const requestsBeforeRevocation = requestCount()
  await act(async () => login([view]))
  await draw(true)
  expect(picker().disabled).toBe(true)
  expect(requestCount()).toBe(requestsBeforeRevocation)
})
