import { createRequire } from 'node:module'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { CreateSaleParams } from '@/types/sale'
import { getApiClientBaseURL, setApiClientBaseURL } from './client'
import { createReceiptApi, getReceiptDetailApi, settleReceiptApi } from './payments'
import { executeCommercialSaleApi } from './sale-commercial'
import { getSaleDetailApi } from './sale'

type ContractServer = {
  origin: string
  token: string
  requests: Array<{ method: string; path: string; requestKey?: string; status: number }>
  mutations: Array<{ action: string; key: string; body: unknown; resourceId?: number }>
  close: () => Promise<void>
}
type AgentClient = {
  get(path: string): Promise<unknown>
  post(path: string, body: unknown, options: { requestKey: string }): Promise<unknown>
}
type AgentTool = {
  run(client: AgentClient, options: { payload: unknown; requestKey: string }): Promise<{ created: unknown; verified?: unknown }>
  settle(client: AgentClient, options: { receiptId: number; allocations: unknown[]; requestKey: string }): Promise<{ result: unknown }>
  detail(client: AgentClient, options: { receiptId: number }): Promise<unknown>
}
const require = createRequire(import.meta.url)
const { startContractServer } = require('../../../tests/helpers/erp-xiaoman-contract-server') as {
  startContractServer: () => Promise<ContractServer>
}
const { FlowClient } = require('../../../agent/src/flow.js') as {
  FlowClient: new (origin: string, token: string, options: { clientId: string }) => AgentClient
}
const { getTool } = require('../../../agent/src/tools.js') as { getTool: (name: string) => AgentTool }
const saleTool = getTool('sale.create_draft')
const paymentTool = getTool('payments.receipt_suggest')
const saleBody: CreateSaleParams = {
  customerId: 11,
  customerName: '合成客户',
  warehouseId: 21,
  warehouseName: '合成仓库',
  items: [{ productId: 31, productName: '合成商品', productCode: 'TEST-31', unit: '个', quantity: 2, unitPrice: 12 }],
}
const receiptBody = {
  type: 2 as const,
  partyId: 11,
  partyName: '合成客户',
  amount: 25.5,
  paymentDate: '2026-01-05',
  accountId: 41,
}

let server: ContractServer
let agent: AgentClient
const initialBase = getApiClientBaseURL()
const initialToken = useAuthStore.getState().token

beforeAll(async () => {
  server = await startContractServer()
  setApiClientBaseURL(server.origin + '/api')
  useAuthStore.setState({ token: server.token })
  agent = new FlowClient(server.origin, server.token, { clientId: 'xiaoman-contract' })
})

afterAll(async () => {
  setApiClientBaseURL(initialBase)
  useAuthStore.setState({ token: initialToken })
  await server?.close()
})

const createSale = (body: CreateSaleParams, requestKey: string) => executeCommercialSaleApi({
  operation: { action: 'create', body },
  requestKey,
  baseURL: server.origin + '/api',
  userId: 7,
  sessionGeneration: useAuthStore.getState().sessionGeneration,
  uncertain: true,
  queryHint: { action: 'sale.create', resourceType: 'sale_order' },
})

test('ERP 创建销售草稿，小满用同一键回传单号并按服务器 ID 回查', async () => {
  const requestKey = 'contract-sale-original'
  const created = await createSale(saleBody, requestKey)
  expect(created).toEqual({ id: 101, orderNo: 'SO-CONTRACT-101' })
  const retry = await saleTool.run(agent, { payload: saleBody, requestKey })
  expect(retry.created).toEqual(created)
  const detail = await getSaleDetailApi(101)
  expect(retry.verified).toEqual(detail)
  expect(detail).toMatchObject({ id: 101, orderNo: 'SO-CONTRACT-101', status: 1 })
  expect(server.mutations.filter(entry => entry.action === 'sale.create')).toEqual([
    { action: 'sale.create', key: requestKey, body: saleBody },
  ])
  expect(server.requests.filter(entry => entry.requestKey === requestKey)).toEqual([
    { method: 'POST', path: '/api/sale', requestKey, status: 201 },
    { method: 'POST', path: '/api/sale/', requestKey, status: 201 },
  ])
})

test('小满登记收款、ERP 复用原键，ERP 核销后小满复用核销原键并回查', async () => {
  const requestKey = 'contract-receipt-original'
  const original = await paymentTool.run(agent, { payload: receiptBody, requestKey })
  expect(original.created).toEqual({
    id: 201, receiptNo: 'RC-CONTRACT-201', amount: 25.5, settledAmount: 0, balance: 25.5, applied: [],
  })
  expect(await createReceiptApi({ ...receiptBody, allocations: [] }, requestKey)).toEqual(original.created)
  const allocations = [{ recordId: 51, amount: 25.5 }]
  const settleKey = 'contract-settle-original'
  const settled = await settleReceiptApi(201, allocations, settleKey)
  expect(settled).toEqual({
    id: 201, receiptNo: 'RC-CONTRACT-201', settledAmount: 25.5, balance: 0,
    applied: [{ recordId: 51, orderNo: 'SO-CONTRACT-AR-51', amount: 25.5, settled: true }],
  })
  expect((await paymentTool.settle(agent, { receiptId: 201, allocations, requestKey: settleKey })).result).toEqual(settled)
  const detail = await getReceiptDetailApi(201)
  expect(await paymentTool.detail(agent, { receiptId: 201 })).toEqual(detail)
  expect(detail).toMatchObject({ id: 201, amount: 25.5, settledAmount: 25.5, balance: 0, status: 3, settlements: [{ recordId: 51, amount: 25.5 }] })
  expect(server.mutations.filter(entry => entry.action.startsWith('payment.'))).toEqual([
    { action: 'payment.receipt.create', key: requestKey, body: { ...receiptBody, allocations: [] } },
    { action: 'payment.receipt.settle', key: settleKey, body: { allocations }, resourceId: 201 },
  ])
  expect(server.requests.filter(entry => [requestKey, settleKey].includes(entry.requestKey ?? '')).map(entry => entry.status)).toEqual([201, 201, 200, 200])
})

test('销售缺商品、收款缺资金账户、核销缺目标时两端收到同一校验结果', async () => {
  const serverError = { status: 400, code: 'VALIDATION_ERROR' }
  const originalMutations = server.mutations.length
  const invalidSale = { ...saleBody, items: [] }
  await expect(createSale(invalidSale, 'invalid-sale-erp')).rejects.toMatchObject(serverError)
  await expect(saleTool.run(agent, { payload: invalidSale, requestKey: 'invalid-sale-xiaoman' })).rejects.toMatchObject(serverError)

  // Deliberately simulate malformed requests; normal TypeScript callers require these fields.
  const invalidReceipt = { ...receiptBody, accountId: undefined, allocations: [] }
  await expect(createReceiptApi(invalidReceipt as unknown as Parameters<typeof createReceiptApi>[0], 'invalid-receipt-erp', undefined, { skipGlobalError: true })).rejects.toMatchObject(serverError)
  await expect(paymentTool.run(agent, { payload: invalidReceipt, requestKey: 'invalid-receipt-xiaoman' })).rejects.toMatchObject(serverError)

  const invalidAllocation = [{ amount: 25.5 }]
  await expect(settleReceiptApi(201, invalidAllocation as Parameters<typeof settleReceiptApi>[1], 'invalid-settle-erp', undefined, { skipGlobalError: true })).rejects.toMatchObject(serverError)
  await expect(paymentTool.settle(agent, { receiptId: 201, allocations: invalidAllocation, requestKey: 'invalid-settle-xiaoman' })).rejects.toMatchObject(serverError)
  expect(server.mutations).toHaveLength(originalMutations)
})
