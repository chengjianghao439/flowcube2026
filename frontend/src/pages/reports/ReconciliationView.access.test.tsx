// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ReceivablePage from './reconciliation-receivable'
import PayablePage from './reconciliation-payable'
import api from '@/api/client'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS as P } from '@/lib/permission-codes'

// 真实月结leaf、所有panel/弹窗与API client；仅在HTTP边界提供离线响应。
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const originalAdapter = api.defaults.adapter
let root: Root, host: HTMLDivElement, qc: QueryClient
let calls: InternalAxiosRequestConfig[]
const granted = [P.REPORT_VIEW, P.PAYMENT_VIEW, P.PAYMENT_EXECUTE, P.PAYMENT_CONFIRM]
function permissions(held: string[]) {
  useAuthStore.getState().updateUser({ permissions: held })
}
function visibleButton(label: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label && !button.closest('[hidden]'))
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function click(label: string, scope: ParentNode = document) {
  const button = visibleButton(label, scope)
  expect(button, label).toBeTruthy()
  await act(async () => button!.click()); await settle()
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function render(type: 1 | 2 = 2) {
  const path = `/reports/reconciliation/${type === 1 ? 'payable' : 'receivable'}`
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={path}>{type === 1 ? <PayablePage /> : <ReceivablePage />}</TabPathContext.Provider></MemoryRouter></QueryClientProvider>))
  await settle()
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.getState().login('offline', null, { id: 7, username: 'offline', realName: '测试', roleId: 5, roleName: '月结', permissions: granted })
  calls = []
  api.defaults.adapter = async config => {
    calls.push(config)
    const user = useAuthStore.getState().user
    const permission = config.url === '/customers' ? P.CUSTOMER_VIEW : config.url === '/suppliers' ? P.SUPPLIER_VIEW : config.url?.startsWith('/payments/') ? P.PAYMENT_VIEW : null
    if (permission && !hasPermission(user?.permissions ?? [], permission, user?.roleId)) {
      throw new AxiosError('forbidden', 'ERR_BAD_REQUEST', config, undefined, { config, status: 403, statusText: 'Forbidden', headers: {}, data: { message: '无账款查看权限' } })
    }
    const type = Number(config.params?.type ?? 2)
    let data: unknown
    if (config.url === '/reports/reconciliation') data = {
      list: [{ id: 101, type, orderNo: '月结原账款', partyName: '脱敏单位', totalAmount: 50, paidAmount: 0, balance: 50, status: 1, statusName: type === 1 ? '未付' : '未收', confirmStatus: 0, createdAt: '2026-10-01', sourcePath: null }],
      summary: {}, pagination: { page: 1, pageSize: 200, total: 1 },
    }
    else if (config.url === '/payments/statements') data = { list: [{ id: 11, type, statementNo: 'ST-offline', partyName: '脱敏单位', totalAmount: 50, settledAmount: 0, balance: 50, status: 2, statusName: '已确认' }], pagination: { page: 1, pageSize: 200, total: 1 } }
    else if (config.url === '/payments/receipts') data = { list: [{ id: 21, type, receiptNo: 'RC-offline', partyName: '脱敏单位', amount: 50, settledAmount: 0, balance: 50, status: 1, statusName: '待核销' }], pagination: { page: 1, pageSize: 200, total: 1 } }
    else if (config.url === '/customers' || config.url === '/suppliers') data = { list: [{ id: 42, code: 'PARTY-offline', name: '测试往来方', isActive: true }], pagination: { page: 1, pageSize: 200, total: 1 } }
    else if (config.url === '/payments/101/settlement-detail') data = { lines: [], returns: [] }
    else throw new Error(`测试未允许端点：${config.method} ${config.url}`)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
  }
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); qc.clear(); api.defaults.adapter = originalAdapter
  useAuthStore.getState().logout()
})

test.each([1, 2] as const)('REPORT_VIEW-only 月结%s默认原报表账款，不读受保护汇总或核销', async type => {
  permissions([P.REPORT_VIEW]); await render(type)
  expect(calls.map(call => call.url)).toEqual(['/reports/reconciliation'])
  expect(calls[0].params).toMatchObject({ type: String(type), settlementTypes: '2' })
  expect(host.textContent).toContain('月结原账款')
  expect(visibleButton('汇总对账')).toBeUndefined()
  expect(visibleButton(type === 1 ? '付款核销' : '收款核销')).toBeUndefined()
  expect(visibleButton('新建对账单')).toBeUndefined()
  await click('查询', host)
  const chooser = visibleButton(type === 1 ? '选择供应商' : '选择客户')!
  expect(chooser.disabled).toBe(true)
  expect(calls.map(call => call.url)).toEqual(['/reports/reconciliation'])
})

test('同时有账款查看权保持默认汇总；写动作仍需要执行权', async () => {
  permissions([P.REPORT_VIEW, P.PAYMENT_VIEW]); await render()
  expect(calls.map(call => call.url)).toEqual(['/payments/statements'])
  expect(host.textContent).toContain('ST-offline')
  expect(visibleButton('新建对账单')).toBeUndefined()
  await click('收款核销', host)
  expect(visibleButton('登记收款')).toBeUndefined()
  expect(calls.map(call => call.url)).toEqual(['/payments/statements', '/payments/receipts'])
})

test.each(['statements', 'receipts'] as const)('撤回查看权停止%s读与浮层，重新授权恢复请求子页、筛选及未应用输入', async kind => {
  await render()
  if (kind === 'receipts') await click('收款核销', host)
  await click('查询', host)
  await change(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, 'FILTER-kept')
  await click('查询', document.querySelector('[role="dialog"]')!)
  await click('查询', host)
  await change(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, 'DRAFT-kept')
  const protectedCalls = calls.filter(call => call.url?.startsWith('/payments/')).length
  await act(async () => permissions([P.REPORT_VIEW])); await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(visibleButton('汇总对账', host)).toBeUndefined()
  expect(visibleButton('收款核销', host)).toBeUndefined()
  expect(calls.at(-1)?.url).toBe('/reports/reconciliation')
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ['payment-statements'] })
    await qc.invalidateQueries({ queryKey: ['payment-receipts'] })
  }); await settle()
  expect(calls.filter(call => call.url?.startsWith('/payments/'))).toHaveLength(protectedCalls)
  await act(async () => permissions(granted)); await settle()
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe('DRAFT-kept')
  await click('取消', document.querySelector('[role="dialog"]')!)
  const finalRead = calls.filter(call => call.url === `/payments/${kind}`).at(-1)
  expect(finalRead?.params[kind === 'statements' ? 'statementNo' : 'receiptNo']).toBe('FILTER-kept')
  expect(host.querySelector('button.border-primary')?.textContent).toBe(kind === 'statements' ? '汇总对账' : '收款核销')
})

test('CONFIRM-only 不提供无法读取的结算确认入口或请求 protected detail', async () => {
  permissions([P.REPORT_VIEW, P.PAYMENT_CONFIRM]); await render(1)
  await click('全部账款', host)
  expect(host.textContent).toContain('待确认')
  expect(visibleButton('确认结算')).toBeUndefined()
  expect(calls.every(call => call.url === '/reports/reconciliation')).toBe(true)
})

test('确认弹窗撤回查看或确认权均暂停原detail读与浮层，恢复原选中单', async () => {
  await render(1); await click('全部账款', host); await click('确认结算', host)
  expect(calls.at(-1)?.url).toBe('/payments/101/settlement-detail')
  for (const held of [[P.REPORT_VIEW, P.PAYMENT_CONFIRM], [P.REPORT_VIEW, P.PAYMENT_VIEW]]) {
    await act(async () => permissions(held)); await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const count = calls.length
    await act(async () => { await qc.invalidateQueries({ queryKey: ['payment-settlement'] }) }); await settle()
    expect(calls).toHaveLength(count)
    await act(async () => permissions(granted)); await settle()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('月结原账款')
  }
})

test.each([1, 2] as const)('合法月结%s选择往来方按真实主数据查看权读取并保留查询原值', async type => {
  permissions([...granted, P.CUSTOMER_VIEW, P.SUPPLIER_VIEW]); await render(type)
  expect(calls.map(call => call.url)).toEqual(['/payments/statements'])
  await click('查询', host)
  await change(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, 'DOC-kept')
  await click(type === 1 ? '选择供应商' : '选择客户')
  expect(calls.at(-1)?.url).toBe(type === 1 ? '/suppliers' : '/customers')
  const row = [...document.querySelectorAll('[role="row"]')].find(el => el.textContent?.includes('测试往来方'))!
  expect(row).toBeTruthy()
  await act(async () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await settle()
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe('DOC-kept')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('测试往来方')
  await click('查询', document.querySelector('[role="dialog"]')!)
  expect(calls.at(-1)?.params).toMatchObject({ statementNo: 'DOC-kept', partyName: '测试往来方' })
})
