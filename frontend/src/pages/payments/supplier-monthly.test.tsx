// @vitest-environment jsdom
import { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import MergedPage from '@/components/shared/MergedPage'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import api from '@/api/client'

// 真实供应商合并页、React Query、API封装及列表；只替换HTTP transport。
let host: HTMLDivElement, root: Root, cache: QueryClient
let calls: InternalAxiosRequestConfig[], monthlyFailure: boolean
let monthlyBalance: number
let largeMonthlyList: boolean
const adapter = api.defaults.adapter
const previousAuth = useAuthStore.getState()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  calls = []; monthlyFailure = false; monthlyBalance = 33.13; largeMonthlyList = false
  useAuthStore.getState().login('synthetic', null, { id: 9911, username: 'synthetic-finance', realName: '合成测试', roleId: 11, roleName: '财务专员', permissions: [P.PAYMENT_VIEW, P.PAYMENT_EXECUTE, P.PAYMENT_CONFIRM, P.REPORT_VIEW] })
  useWorkspaceStore.getState().closeAll()
  api.defaults.adapter = async config => {
    calls.push(config)
    const params = config.params ?? {}
    if (config.url === '/payments') {
      const monthly = params.settlementTypes === '2'
      if (monthly && monthlyFailure) throw new AxiosError('合成月结读取失败', 'ERR_BAD_RESPONSE', config, undefined, { config, status: 500, statusText: 'Error', headers: {}, data: { success: false, message: '合成月结读取失败' } })
      if (monthly && largeMonthlyList) {
        const page = Number(params.page), pageSize = Number(params.pageSize), start = (page - 1) * pageSize
        const list = Array.from({ length: Math.min(pageSize, 5001 - start) }, (_, index) => ({ id: 10000 + start + index, type: 1, orderNo: `PO-MONTHLY-${start + index}`, partyName: '月结供应商', totalAmount: 0.02, paidAmount: 0.01, balance: 0.01, status: 2 }))
        return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { list, pagination: { page, pageSize, total: 5001 }, summary: { totalAmount: 100.02, paidAmount: 50.01, balance: 50.01 } } } }
      }
      const list = [{ id: monthly ? 102 : 101, type: Number(params.type), typeName: '应付', orderNo: monthly ? 'PO-MONTHLY-NO-STATEMENT' : 'PO-CASH', partyName: monthly ? '合成月结供应商' : '合成现结供应商', totalAmount: monthly ? 40 : 100, paidAmount: monthly ? 40 - monthlyBalance : 30, balance: monthly ? monthlyBalance : 70, status: 2, statusName: '部分付款', confirmStatus: 1, dueDate: '2026-11-30', createdAt: '2026-03-24T00:00:00+08:00' }]
      return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { list, pagination: { page: 1, pageSize: 200, total: 1 }, summary: { totalAmount: monthly ? 40 : 100, paidAmount: monthly ? 40 - monthlyBalance : 30, balance: monthly ? monthlyBalance : 70 } } } }
    }
    if (config.url === '/payments/receipts' || config.url === '/payments/statements') {
      return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { list: [], pagination: { page: 1, pageSize: 200, total: 0 } } } }
    }
    throw new Error(`未允许的供应商测试端点：${config.method} ${config.url}`)
  }
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove(); api.defaults.adapter = adapter
  useAuthStore.setState(previousAuth, true); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals()
})
async function render(type: 1 | 2 = 1, active = true) {
  const path = `/payments/${type === 1 ? 'payable' : 'receivable'}`
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}>
    <SectionVisibilityContext.Provider value={active}><TabPathContext.Provider value={path}>
      <Suspense fallback="加载"><MergedPage /></Suspense>
    </TabPathContext.Provider></SectionVisibilityContext.Provider>
  </MemoryRouter></QueryClientProvider>))
  await act(async () => { await vi.dynamicImportSettled() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
const section = (label: string) => host.querySelector<HTMLElement>(`section[aria-label="${label}"]`)
async function click(text: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll('button')].find(node => node.textContent?.trim() === text)
  expect(button, text).toBeTruthy()
  await act(async () => button!.click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
const monthlyCalls = () => calls.filter(call => call.url === '/payments' && call.params?.settlementTypes === '2')

test('默认供应商往来显示未出对账单的月结采购欠款，和现结分区分数', async () => {
  await render()
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('PO-MONTHLY-NO-STATEMENT'))
  expect(host.querySelector('h1')?.textContent).toBe('供应商往来')
  expect(section('月结欠款')?.textContent).toContain('月结未结清金额')
  expect(section('月结欠款')?.textContent).toContain('33.13')
  expect(section('月结欠款')?.textContent).toContain('含未生成对账单')
  expect(section('月结欠款')?.textContent).not.toContain('PO-CASH')
  expect(section('现结账款')?.textContent).toContain('PO-CASH')
  expect(section('现结账款')?.textContent).toContain('70.00')
  expect(section('现结账款')?.textContent).not.toContain('33.13')
  expect(section('月结欠款')?.querySelectorAll('tbody button')).toHaveLength(0)
  expect(section('月结欠款')?.querySelector('thead')?.textContent).not.toContain('操作')
  expect(calls.filter(call => call.url?.includes('/statements'))).toHaveLength(0)
  expect(monthlyCalls()[0].params).toMatchObject({ type: '1', settlementTypes: '2', status: 'unsettled' })
  expect(monthlyCalls()[0].params).not.toHaveProperty('startDate')
  expect(monthlyCalls()[0].params).not.toHaveProperty('statementId')
  const cash = calls.find(call => call.url === '/payments' && call.params?.settlementTypes !== '2')!
  expect(cash.params).toMatchObject({ type: '1', settlementTypes: '1', status: 'unsettled' })
})

test('月结欠款变化只改变月结数字，现结查询与70元不受影响', async () => {
  await render()
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('33.13'))
  monthlyBalance = 18.25
  await act(async () => { await cache.invalidateQueries({ queryKey: ['payments'] }); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(section('月结欠款')?.textContent).toContain('18.25')
  expect(section('现结账款')?.textContent).toContain('70.00')
  expect(section('现结账款')?.textContent).not.toContain('18.25')
  expect(calls.filter(call => call.url === '/payments').every(call => ['1', '2'].includes(call.params.settlementTypes))).toBe(true)
})

test('月结超过取齐上限时明确截断，金额仍取全部5001笔的服务端汇总', async () => {
  largeMonthlyList = true
  await render()
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('50.01'))
  expect(section('月结欠款')?.textContent).toContain('当前显示前 5000 笔，共 5001 笔')
  expect(section('月结欠款')?.textContent).not.toContain('50.00')
  expect(monthlyCalls()).toHaveLength(25)
  expect(section('现结账款')?.textContent).toContain('70.00')
})

test('只有原账款查看权限也能看到月结欠款，不借报表权限或开放月结付款', async () => {
  useAuthStore.getState().updateUser({ permissions: [P.PAYMENT_VIEW] })
  await render()
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('33.13'))
  expect(section('月结欠款')?.querySelector('a')).toBeNull()
  expect([...host.querySelectorAll('button')].some(node => node.textContent === '登记付款')).toBe(false)
})

test('月结读取失败和刷新失败不显示为零，独立重试恢复且不影响现结', async () => {
  monthlyFailure = true
  await render()
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('合成月结读取失败'))
  expect(section('月结欠款')?.textContent).not.toContain('0.00')
  expect(section('现结账款')?.textContent).toContain('70.00')
  monthlyFailure = false; await click('重试', section('月结欠款')!)
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('33.13'))
  monthlyFailure = true
  await act(async () => { await cache.invalidateQueries({ queryKey: ['payments'] }); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(section('月结欠款')?.textContent).toContain('合成月结读取失败')
  expect(section('月结欠款')?.textContent).not.toContain('33.13')
  expect(section('现结账款')?.textContent).toContain('70.00')
})

test('客户往来维持现结原样，不增加供应商月结查询', async () => {
  await render(2)
  expect(section('月结欠款')).toBeNull()
  expect(monthlyCalls()).toHaveLength(0)
  expect(calls.find(call => call.url === '/payments')?.params).toMatchObject({ type: '2', settlementTypes: '1', status: 'unsettled' })
})

test('切换付款核销后月结查询停止，返回时仍属于独立只读区域', async () => {
  await render(); await click('付款核销')
  const before = monthlyCalls().length
  await act(async () => { await cache.invalidateQueries({ queryKey: ['payments'] }); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(monthlyCalls()).toHaveLength(before)
  await click('按单登记')
  await vi.waitFor(() => expect(section('月结欠款')?.textContent).toContain('33.13'))
  expect(section('月结欠款')?.querySelectorAll('tbody button')).toHaveLength(0)
})

test('隐藏的供应商往来页面不发起月结读取', async () => {
  await render(1, false)
  expect(monthlyCalls()).toHaveLength(0)
})
