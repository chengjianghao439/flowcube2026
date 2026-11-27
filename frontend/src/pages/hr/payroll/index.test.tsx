// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HrPayrollPage from './index'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import * as hrApi from '@/api/hr'

vi.mock('@/api/hr', () => ({
  getHrEmployeesApi: vi.fn(),
  createHrEmployeeApi: vi.fn(),
  getHrPayrollsApi: vi.fn(),
  createHrPayrollApi: vi.fn(),
  getHrPayrollDetailApi: vi.fn(),
  updateHrPayrollLineApi: vi.fn(),
  calculateHrPayrollApi: vi.fn(),
  payHrPayrollApi: vi.fn(),
}))

describe('HrPayrollPage', () => {
  let host: HTMLDivElement
  let root: Root
  let qc: QueryClient

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    useAuthStore.getState().login('test', null, {
      id: 1,
      username: 'finance',
      realName: '财务',
      roleId: 5,
      roleName: '财务',
      permissions: [PERMISSIONS.ACCOUNTING_LEDGER_VIEW, PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE],
    })
    vi.mocked(hrApi.getHrEmployeesApi).mockResolvedValue({
      list: [{ id: 1, empNo: 'E001', name: '张三', idCardNo: null, departmentId: 1, departmentName: '仓储部', status: 1, isActive: true, hireDate: '2026-01-01' }],
      pagination: { page: 1, pageSize: 100, total: 1 },
    })
    vi.mocked(hrApi.getHrPayrollsApi).mockResolvedValue({
      list: [{ id: 10, payrollNo: 'PAY-202611', period: '202611', status: 1, empCount: 1, totalGross: 8000, totalSocialCompany: 1200, totalTax: 200, totalNet: 7200, createdAt: '2026-11-01' }],
      pagination: { page: 1, pageSize: 50, total: 1 },
    })
    vi.mocked(hrApi.getHrPayrollDetailApi).mockResolvedValue({
      id: 10,
      payrollNo: 'PAY-202611',
      period: '202611',
      status: 1,
      empCount: 1,
      totalGross: 8000,
      totalSocialCompany: 1200,
      totalTax: 200,
      totalNet: 7200,
      createdAt: '2026-11-01',
      lines: [{ id: 101, employeeId: 1, empNo: 'E001', employeeName: '张三', grossEntered: true, gross: 8000, socialCompany: 1200, socialPersonal: 600, tax: 200, net: 7200 }],
    })
    vi.mocked(hrApi.calculateHrPayrollApi).mockResolvedValue({ id: 10 })
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    qc.clear()
    host.remove()
    useAuthStore.getState().logout()
  })

  it('展示员工档案与月度工资单，点击工资单加载明细并支持触发核算个税', async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <HrPayrollPage />
        </QueryClientProvider>,
      )
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    expect(host.textContent).toContain('工资管理')
    expect(host.textContent).toContain('张三')
    expect(host.textContent).toContain('PAY-202611')

    const payrollBtn = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('PAY-202611'))
    expect(payrollBtn).toBeTruthy()
    await act(async () => payrollBtn!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    expect(hrApi.getHrPayrollDetailApi).toHaveBeenCalledWith(10)
    expect(host.textContent).toContain('工资明细 · 202611')

    const calcBtn = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('核算个税'))
    expect(calcBtn).toBeTruthy()
    await act(async () => calcBtn!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

    expect(hrApi.calculateHrPayrollApi).toHaveBeenCalledWith(10)
  })
})
