import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payloadClient } from '@/api/client'

export interface VatReport {
  period: string
  salesTaxAmount: number
  inputTaxAmount: number
  netPayable: number
  taxDue: number
  adjustments: Array<{ item: string; amount: number }>
}
export interface IncomeTaxReport {
  period: string
  revenue: number
  expense: number
  profitTotal: number
  taxableIncome: number
  taxRate: number
  taxDue: number
  adjustments: Array<{ item: string; amount: number }>
}
export interface TaxAdjustment {
  id: number
  period: string
  taxType: number
  adjustItem: string
  amount: number
  remark: string | null
}

export function getTaxVatApi(companyId: number, period: string) {
  return payloadClient.get<VatReport>('/accounting/tax/vat', { params: { companyId, period } })
}
export function getTaxIncomeApi(companyId: number, period: string) {
  return payloadClient.get<IncomeTaxReport>('/accounting/tax/income', { params: { companyId, period } })
}
export function getTaxAdjustmentsApi(companyId: number, period: string, taxType: number) {
  return payloadClient.get<TaxAdjustment[]>('/accounting/tax/adjustments', { params: { companyId, period, taxType } })
}
export function createTaxAdjustmentApi(data: { companyId: number; period: string; taxType: number; adjustItem: string; amount: number }) {
  return payloadClient.post('/accounting/tax/adjustments', data)
}
export function deleteTaxAdjustmentApi(id: number, companyId: number) {
  return payloadClient.delete(`/accounting/tax/adjustments/${id}`, { params: { companyId } })
}

export function useTaxVat(companyId: number, period: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tax-vat', companyId, period],
    queryFn: () => getTaxVatApi(companyId, period).then(r => r ?? null),
    enabled,
  })
}

export function useTaxIncome(companyId: number, period: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tax-income', companyId, period],
    queryFn: () => getTaxIncomeApi(companyId, period).then(r => r ?? null),
    enabled,
  })
}

export function useTaxAdjustments(companyId: number, period: string, taxType: number, enabled: boolean) {
  return useQuery({
    queryKey: ['tax-adjustments', companyId, period, taxType],
    queryFn: () => getTaxAdjustmentsApi(companyId, period, taxType).then(r => r ?? []),
    enabled,
  })
}

export function useCreateTaxAdjustment(companyId: number, period: string, tab: 'vat' | 'income') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { adjustItem: string; amount: number }) =>
      createTaxAdjustmentApi({
        companyId,
        period,
        taxType: tab === 'vat' ? 1 : 2,
        adjustItem: data.adjustItem,
        amount: data.amount,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tax-adjustments', companyId, period, tab === 'vat' ? 1 : 2] })
      qc.invalidateQueries({ queryKey: ['tax-vat', companyId, period] })
      qc.invalidateQueries({ queryKey: ['tax-income', companyId, period] })
    },
  })
}

export function useDeleteTaxAdjustment(companyId: number, period: string, tab: 'vat' | 'income') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTaxAdjustmentApi(id, companyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-adjustments', companyId, period, tab === 'vat' ? 1 : 2] }),
  })
}
