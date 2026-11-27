import { payloadClient as client } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
import type { PaginatedData } from '@/types'

export interface HrEmployee {
  id: number
  empNo: string
  name: string
  idCardNo: string | null
  departmentId: number | null
  departmentName: string | null
  hireDate: string | null
  status: number
  isActive: boolean
}

export interface HrPayroll {
  id: number
  period: string
  payrollNo: string
  totalGross: number
  totalSocialCompany: number
  totalTax: number
  totalNet: number
  status: number
  empCount: number
  createdAt: string
}

export interface HrPayrollLine {
  id: number
  employeeId: number
  employeeName: string
  empNo: string
  grossEntered: boolean
  gross: number | null
  socialCompany: number
  socialPersonal: number
  tax: number
  net: number
}

export interface HrPayrollDetail extends HrPayroll {
  lines: HrPayrollLine[]
}

export const getHrEmployeesApi = (params?: { page?: number; pageSize?: number; keyword?: string }) =>
  client.get<PaginatedData<HrEmployee>>('/hr/employees', { params })

export const createHrEmployeeApi = (body: {
  empNo?: string
  name: string
  idCardNo?: string | null
  departmentName?: string | null
  hireDate?: string | null
}) => client.post<{ id: number; empNo: string }>('/hr/employees', body)

export const getHrPayrollsApi = (params?: { page?: number; pageSize?: number; period?: string }) =>
  client.get<PaginatedData<HrPayroll>>('/hr/payrolls', { params })

export const createHrPayrollApi = (period: string) =>
  client.post<{ id: number; payrollNo: string }>('/hr/payrolls', { period })

export const getHrPayrollDetailApi = (id: number) =>
  client.get<HrPayrollDetail>(`/hr/payrolls/${id}`)

export const updateHrPayrollLineApi = (id: number, lineId: number, gross: number, requestKey: string) =>
  client.patch<unknown>(`/hr/payrolls/${id}/lines/${lineId}`, { gross }, { headers: withRequestKeyHeaders(requestKey) })

export const calculateHrPayrollApi = (id: number) =>
  client.post<unknown>(`/hr/payrolls/${id}/calculate`)

export const payHrPayrollApi = (id: number, paidDate?: string) =>
  client.post<unknown>(`/hr/payrolls/${id}/pay`, paidDate ? { paidDate } : {})
