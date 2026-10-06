// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import client from './client'
import { payExpenseClaimApi } from './finance'
const adapter = client.defaults.adapter
afterEach(() => { client.defaults.adapter = adapter })

test('费用跨期申请保留原付款日期账户与请求键，并返回申请而不是付款结果', async () => {
  const requests: InternalAxiosRequestConfig[] = []
  client.defaults.adapter = (async config => {
    requests.push(config)
    return { data: { success: true, data: { id: 99, applicationNo: 'BF99' } }, status: 202, statusText: 'Accepted', headers: {}, config }
  }) satisfies AxiosAdapter
  const original = Object.freeze({ accountId: 12, happenedAt: '2020-01-15', remark: '真实付款事实' })
  const application = await payExpenseClaimApi(81, original, 'original-key', '真实历史付款补录', { skipGlobalError: true })
  expect(application).toEqual({ id: 99, applicationNo: 'BF99' })
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe('/finance/expense-claims/81/pay')
  expect(requests[0].headers.get('X-Request-Key')).toBe('original-key')
  expect(JSON.parse(String(requests[0].data))).toEqual({ ...original, backfillRequest: true, backfillReason: '真实历史付款补录' })
  expect(requests[0].skipGlobalError).toBe(true)
})

test('费用普通付款保留原请求键且不自动带补录申请', async () => {
  const requests: InternalAxiosRequestConfig[] = []
  client.defaults.adapter = (async config => {
    requests.push(config)
    return { data: { success: true, data: { id: 81, status: 4, amount: 300 } }, status: 200, statusText: 'OK', headers: {}, config }
  }) satisfies AxiosAdapter
  expect(await payExpenseClaimApi(81, { accountId: 12 }, 'original-key')).toEqual({ id: 81, status: 4, amount: 300 })
  expect(JSON.parse(String(requests[0].data))).toEqual({ accountId: 12 })
  expect(requests[0].headers.get('X-Request-Key')).toBe('original-key')
})
