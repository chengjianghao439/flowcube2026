// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import TaxFilingPage from './index'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/exportDownload', () => ({ downloadExport: vi.fn() }))
const originalAdapter = apiClient.defaults.adapter
const originalAuth = useAuthStore.getState()
const originalOnline = onlineManager.isOnline()
let host: HTMLDivElement, root: Root, client: QueryClient
let fail = false, defer = false, deferDelete = false, released: Array<() => void> = [], amount = 1.23
let requests: Array<{ method: string; url: string; period: string }>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fail = false; defer = false; deferDelete = false; amount = 1.23; requests = []; released = []
  useAuthStore.setState({ token: 'synthetic-tax-transport', user: { id: 311, username: 'tax-fixture', realName: '财务', roleId: 81, roleName: '财务', permissions: [PERMISSIONS.ACCOUNTING_LEDGER_VIEW, PERMISSIONS.ACCOUNTING_PERIOD_MANAGE] } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  apiClient.defaults.adapter = (async config => {
    const url = config.url ?? ''
    requests.push({ method: config.method ?? 'get', url, period: String(config.params?.period ?? '') })
    if (defer || (deferDelete && config.method === 'delete')) await new Promise<void>(resolve => { released.push(resolve) })
    if (fail) throw new AxiosError('合成读取故障', 'ERR_BAD_RESPONSE', config, undefined, { data: { success: false, message: '合成读取故障' }, status: 500, statusText: 'Error', headers: {}, config })
    if (config.method === 'delete') amount = 0
    const data = config.method === 'delete' ? null : url.endsWith('/vat')
      ? { period: '202610', salesTaxAmount: 0, inputTaxAmount: 0, taxDue: amount, netPayable: 0, adjustments: [] }
      : url.endsWith('/income')
        ? { period: '202610', revenue: 0, expense: 0, profitTotal: 0, taxableIncome: 0, taxDue: 0, taxRate: 0.25, adjustments: [] }
        : amount ? [{ id: 15, period: '202610', taxType: 1, adjustItem: '合成调整', amount, remark: null }] : []
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config }
  }) satisfies AxiosAdapter
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  released.forEach(resolve => resolve())
  await act(async () => root.unmount())
  await client.cancelQueries(); client.clear(); host.remove()
  apiClient.defaults.adapter = originalAdapter
  useAuthStore.setState(originalAuth, true)
  onlineManager.setOnline(originalOnline)
})
async function render() {
  await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/accounting/tax']}><TaxFilingPage /></MemoryRouter></QueryClientProvider>) })
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) }) }
function visibleText() { return [...host.querySelectorAll('h1,h2,p,span,button,td')].filter(el => !el.closest('[hidden]')).map(el => el.textContent).join(' ') }
function button(text: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === text && !el.closest('[hidden]')) }
function period(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="YYYYMM"]')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
test('真实hook与表格：读取未完成不显示假零额或空调整项', async () => {
  defer = true
  await render()
  expect(visibleText()).toContain('正在加载报税数据')
  expect(visibleText()).not.toContain('¥0.00')
  expect(visibleText()).not.toContain('无调整项')
})
test('真实transport失败显示可重试状态，成功重试后才展示金额', async () => {
  fail = true
  await render(); await settle()
  expect(visibleText()).toContain('报税数据加载失败')
  expect(visibleText()).not.toContain('¥0.00')
  expect(button('添加')).toBeUndefined()
  fail = false
  await act(async () => button('重试')!.click()); await settle()
  expect(visibleText()).toContain('¥1.23')
  expect(visibleText()).toContain('合成调整')
})
test.each(['2', '202613', '202600'])('非法期间%s不读取或提交调整', async value => {
  await render(); await settle(); requests.length = 0
  period(value); await settle()
  expect(requests).toEqual([])
  expect(visibleText()).toContain('请输入有效的申报期间')
  expect(button('添加')).toBeUndefined()
})
test('删除调整后列表和所属期间税额一起刷新', async () => {
  await render(); await settle()
  expect(visibleText()).toContain('¥1.23')
  const before = requests.filter(request => request.url.endsWith('/vat')).length
  await act(async () => button('删除')!.click()); await settle()
  expect(requests.filter(request => request.url.endsWith('/vat')).length).toBeGreaterThan(before)
  expect(visibleText()).not.toContain('¥1.23')
  expect(visibleText()).toContain('无调整项')
})
test('删除挂起后切换期间，成功失效原期间并保留新期间缓存', async () => {
  await render(); await settle()
  const originalPeriod = host.querySelector<HTMLInputElement>('input[placeholder="YYYYMM"]')!.value
  const nextPeriod = originalPeriod === '209912' ? '209911' : '209912'
  deferDelete = true
  await act(async () => button('删除')!.click()); await settle()
  expect(requests.some(request => request.method === 'delete')).toBe(true)
  period(nextPeriod); await settle()
  const nextReads = requests.filter(request => request.url.endsWith('/vat') && request.period === nextPeriod).length
  deferDelete = false
  await act(async () => released.forEach(resolve => resolve())); await settle()
  expect(client.getQueryState(['tax-vat', 1, originalPeriod])?.isInvalidated).toBe(true)
  expect(requests.filter(request => request.url.endsWith('/vat') && request.period === nextPeriod)).toHaveLength(nextReads)
})
test('仅查看权限可以读报表但不提供添加与删除', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.ACCOUNTING_LEDGER_VIEW] } })
  await render(); await settle()
  expect(visibleText()).toContain('¥1.23')
  expect(button('添加')).toBeUndefined()
  expect(button('删除')).toBeUndefined()
})
test('后台重读失败后不把旧税额继续呈现为正常结果', async () => {
  await render(); await settle()
  expect(visibleText()).toContain('¥1.23')
  fail = true
  await act(async () => { await client.invalidateQueries({ queryKey: ['tax-vat'] }) }); await settle()
  expect(visibleText()).toContain('报税数据加载失败')
  expect(visibleText()).not.toContain('¥1.23')
  expect(button('添加')).toBeUndefined()
})
test('离线暂停不发送读取请求，不显示假零额', async () => {
  onlineManager.setOnline(false)
  await render(); await settle()
  expect(requests).toEqual([])
  expect(visibleText()).toContain('报税数据读取已暂停')
  expect(visibleText()).not.toContain('¥0.00')
  expect(button('添加')).toBeUndefined()
})
