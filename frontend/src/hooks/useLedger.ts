import { useCompanyQueryKey } from '@/hooks/useCompanyQueryKey'
import { useQuery } from '@tanstack/react-query'
import {
  getTrialBalanceApi, getAccountLedgerApi,
  getIncomeStatementApi, getBalanceSheetApi, getCashFlowApi,
} from '@/api/accounting'

const QK = 'acct-ledger'

export const useTrialBalance = (period: string) =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'trial', period]), queryFn: () => getTrialBalanceApi(period), enabled: /^\d{6}$/.test(period) })

export const useAccountLedger = (accountId: number | null, period: string) =>
  useQuery({
    queryKey: useCompanyQueryKey([QK, 'account', accountId, period]),
    queryFn: () => getAccountLedgerApi(accountId as number, period),
    enabled: !!accountId && /^\d{6}$/.test(period),
  })

export const useIncomeStatement = (period: string) =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'income', period]), queryFn: () => getIncomeStatementApi(period), enabled: /^\d{6}$/.test(period) })

export const useBalanceSheet = (period: string) =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'balance', period]), queryFn: () => getBalanceSheetApi(period), enabled: /^\d{6}$/.test(period) })

export const useCashFlow = (period: string) =>
  useQuery({ queryKey: useCompanyQueryKey([QK, 'cashflow', period]), queryFn: () => getCashFlowApi(period), enabled: /^\d{6}$/.test(period) })
