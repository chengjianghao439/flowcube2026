// @vitest-environment jsdom
// Render the real page and API client; only the HTTP transport returns synthetic DTOs.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, getByRole, getByLabelText, getByText, queryByText } from '@testing-library/dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import type { ContainerLogItem } from '@/api/inventory'
import TracePage from './trace'

const container = {
  containerId: 7, barcode: 'I000007', productId: 3, productCode: 'SYN3',
  productName: '合成追溯商品', warehouseId: 2, warehouseName: '合成原仓',
  locationId: 5, locationCode: 'A-05', remainingQty: 120, unit: '个',
  containerKind: 'inventory',
}
const baseLog: ContainerLogItem = {
  type: 2, qty: 80, moveType: 2, moveTypeName: '销售出库',
  refType: 'sale', refNo: 'SO-TRACE-001', remark: null,
  operatorName: '合成经办人', productName: container.productName,
  createdAt: '2026-10-27T01:30:00+08:00',
}
const oldAdapter = apiClient.defaults.adapter
const oldEnv = apiClient.defaults.env
const oldBaseURL = apiClient.defaults.baseURL
let host: HTMLDivElement
let root: Root
let logs: ContainerLogItem[]
let requests: string[]

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  requests = []
  setApiClientBaseURL('http://trace.fixture.invalid/api')
  apiClient.defaults.adapter = 'fetch'
  apiClient.defaults.env = {
    ...oldEnv,
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      requests.push(url.pathname)
      let data: unknown
      if (url.pathname === '/api/inventory/containers/barcode/I000007') data = container
      else if (url.pathname === '/api/inventory/containers/7/logs') data = logs
      else throw new Error(`Unexpected request: ${url.pathname}`)
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    },
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  apiClient.defaults.adapter = oldAdapter
  apiClient.defaults.env = oldEnv
  setApiClientBaseURL(oldBaseURL ?? '/api')
})

async function trace(log: Partial<ContainerLogItem>) {
  logs = [{ ...baseLog, ...log }]
  await act(async () => root.render(<TracePage />))
  await act(async () => fireEvent.change(getByLabelText(host, '库存或塑料盒条码'), { target: { value: container.barcode } }))
  await act(async () => fireEvent.click(getByRole(host, 'button', { name: '查询' })))
  expect(getByRole(host, 'heading', { name: '条码流水（1 条）' })).toBeTruthy()
  expect(requests).toEqual(['/api/inventory/containers/barcode/I000007', '/api/inventory/containers/7/logs'])
}

test.each([
  { name: '正量出库', type: 2, qty: 80, expected: '-80' },
  { name: '已带负号的出库', type: 2, qty: -80, expected: '-80' },
  { name: '入库', type: 1, qty: 80, expected: '+80' },
  { name: '正调整', type: 3, qty: 7.5, expected: '+7.5' },
  { name: '负调整', type: 3, qty: -7.5, expected: '-7.5' },
  { name: '零入库', type: 1, qty: 0, expected: '0' },
  { name: '零出库', type: 2, qty: 0, expected: '0' },
  { name: '零调整', type: 3, qty: 0, expected: '0' },
  { name: '未知方向正量', type: 99, qty: 80, expected: '+80' },
  { name: '未知方向负量', type: 99, qty: -80, expected: '-80' },
  { name: '未知方向零量', type: 99, qty: 0, expected: '0' },
])('$name按库存方向显示 $expected', async ({ type, qty, expected }) => {
  // Deliberately keep the label unchanged: direction comes from type, never copy.
  await trace({ type, qty })
  const quantity = getByText(host, expected, { exact: true })
  expect(quantity.classList.contains('text-destructive-ink')).toBe(expected.startsWith('-'))
  expect(logs[0].qty).toBe(qty)
  expect(getByText(host, '销售出库')).toBeTruthy()
  expect(getByText(host, '单据 SO-TRACE-001')).toBeTruthy()
  expect(getByText(host, '2026-10-27 01:30')).toBeTruthy()
  expect(getByText(host, '操作人 合成经办人')).toBeTruthy()
})

test.each(['销售出库', 'SO-TRACE-001', '销售出库 SO-TRACE-001'])('只收起与类型/单号完全重复的备注：%s', async remark => {
  await trace({ remark })
  expect(queryByText(host, remark, { exact: true, selector: 'div.mt-1' })).toBeNull()
  expect(getByText(host, '销售出库')).toBeTruthy()
  expect(getByText(host, '单据 SO-TRACE-001')).toBeTruthy()
})

test.each([
  '销售出库 SO-TRACE-001（客户要求分批）',
  '自 I000006 拆入 80',
  '盘点调整 SC-001（差异 -7.5）',
  '销售出库  SO-TRACE-001',
])('保留真实业务备注或非完全重复文字：%s', async remark => {
  await trace({ remark })
  expect(getByText(host, (_, element) => element?.textContent === remark, { selector: 'div.mt-1' })).toBeTruthy()
})

test('没有类型与单号时不隐藏备注', async () => {
  await trace({ moveTypeName: null, refNo: null, remark: '销售出库 SO-TRACE-001' })
  expect(getByText(host, '销售出库 SO-TRACE-001')).toBeTruthy()
})
