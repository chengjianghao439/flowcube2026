// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { readRefundRecords } from '@/lib/supplierRefundRecovery'
import CreateRefundPage from './CreateRefundPage'

const pagePath = '/supplier-refunds/new?purchaseReturnId=997201'
const originalAdapter = client.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
const unexpected: string[] = []
let root: Root | undefined, host: HTMLDivElement, queryClient: QueryClient

function sourceForPrice(price: unknown) {
  const boundary = price === '9999999999.99999999'
  const gross = boundary ? '100000000.0000' : '6.0000'
  const paid = boundary ? '1000000000.0000' : '30.0000'
  return {
    purchaseReturnId: 997201, returnNo: 'GUI-PR997201', purchaseOrderId: 997202,
    orderNo: 'GUI-PO997202', supplierId: 997210, warehouseId: 997212,
    grossAmount: gross, availableAmount: gross, paymentRecordId: 997205,
    currentPaidAmount: paid,
    items: [{ id: 997203, purchaseItemId: 997204, productId: 997211,
      unit: '个', quantity: boundary ? '0.01' : '2.00', unitPrice: price }],
    itemLabels: [{ id: 997203, productCode: 'GUI-RFP997211', productName: '合成原价商品',
      articleNumber: null, spec: null, color: null }],
    entries: [{ entryId: 997206, recordId: 997205, originalAmount: paid,
      availableAmount: paid, receiptId: null, paymentDate: '2026-10-16', receipt: null,
      out: { id: 997207, bizNo: 'GUI-PO997202', amount: paid } }],
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  requests.length = 0
  unexpected.length = 0
  setApiClientBaseURL('/a')
  useAuthStore.getState().login('offline-price', null, {
    id: 900001, username: 'price-fixture', realName: '合成原价验收', roleId: 2,
    roleName: '合成角色', permissions: ['supplier.refund.view', 'supplier.refund.create',
      'purchase.order.view', 'return.order.view', 'payment.view', 'finance.account.view'],
  })
  useWorkspaceStore.setState({ tabs: [], activeKey: '/supplier-refunds' })
  host = document.createElement('div')
  document.body.append(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  queryClient.clear()
  host.remove()
  client.defaults.adapter = originalAdapter
  localStorage.clear()
  expect(unexpected).toEqual([])
  expect(requests.every(request => request.method === 'get')).toBe(true)
})

async function renderPrice(price: unknown) {
  client.defaults.adapter = async config => {
    requests.push(config)
    let data: unknown
    if (config.method === 'get' && config.url === '/supplier-refunds/source') {
      expect(config.params).toEqual({ purchaseReturnId: 997201 })
      data = sourceForPrice(price)
    } else if (config.method === 'get' && config.url === '/finance/accounts/active') {
      data = [{ id: 997208, name: '合成收入账户', isActive: true }]
    } else {
      unexpected.push(`${config.method} ${config.url}`)
      throw Error('Unexpected refund price transport')
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
  }
  root = createRoot(host)
  await act(async () => root!.render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pagePath]}>
        <TabPathContext.Provider value={pagePath}><CreateRefundPage /></TabPathContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  const section = host.querySelector('[aria-label="准确退款来源"]')
  expect(section).not.toBeNull()
  return section!.querySelector('tbody tr')!.querySelectorAll('td')[2]
}

async function fill(label: string, value: string) {
  const input = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement
  expect(input).not.toBeNull()
  await act(async () => {
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

test.each(['3.0000', '3.00000000', '3.00000001', '9999999999.99999999'])(
  '真实退款新建页原成交单价 %s 保留服务端全部位数', async price => {
    const cell = await renderPrice(price)
    expect(cell.textContent).toBe(`¥${price}`)
    if (price !== '9999999999.99999999') {
      expect([...host.querySelectorAll('dl dd')].map(element => element.textContent))
        .toEqual(['¥6.00', '¥6.00', '¥30.00'])
    }
    expect(readRefundRecords()).toEqual([])
  },
)

test.each([null, undefined, '', 'not-a-price', 'NaN', 'Infinity', '3e0',
  '-3.00000000', '3.000000001', '10000000000.00000000', 3])(
  '真实退款新建页无效原价 %s 仅显示缺值，不补零或截成合法价格', async price => {
    const cell = await renderPrice(price)
    expect(cell.textContent).toBe('—')
    expect(readRefundRecords()).toEqual([])
  },
)

test('八位来源价格不放宽现金分位，原金额输入及未提交草稿保留', async () => {
  await renderPrice('3.00000001')
  await fill('真实银行回款日', '2026-10-16')
  await fill('收入账户', '997208')
  await fill('原付款分配997206退款金额', '0.01')
  expect(host.textContent).toContain('本次退款合计 ¥0.01')
  await fill('原付款分配997206退款金额', '0.001')
  await act(async () => {
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === '保存退款草稿')!
    expect(save.disabled).toBe(false)
    save.click()
  })
  expect(host.textContent).toContain('准确两位退款分配')
  expect((host.querySelector('[aria-label="原付款分配997206退款金额"]') as HTMLInputElement).value).toBe('0.001')
  expect(readRefundRecords()).toEqual([])
})
