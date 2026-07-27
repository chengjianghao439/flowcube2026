import { payloadClient as client } from './client'

/** 资金账户。currentBalance 是流水投影，服务端重算，前端只读 */
export interface FinanceAccount {
  id: number
  code: string
  name: string
  type: 1 | 2 | 3 | 4 | 5
  typeName: string
  accountNo?: string | null
  bankName?: string | null
  holder?: string | null
  openingBalance: number
  currentBalance: number
  isActive: boolean
  sortOrder: number
  remark?: string | null
  createdAt: string
}

export interface AccountTransaction {
  id: number
  accountId: number
  accountName?: string
  direction: 1 | 2
  directionName: string
  amount: number
  bizType: 1 | 2 | 3 | 4
  bizTypeName: string
  bizId?: number | null
  bizNo?: string | null
  partyName?: string | null
  balanceAfter: number
  happenedAt: string
  remark?: string | null
  operatorName?: string | null
  createdAt: string
}

export const getAccountsApi = (p: object = {}) =>
  client.get<{ list: FinanceAccount[]; summary: { totalBalance:number; accountCount:number }; pagination: unknown }>(
    '/finance/accounts', { params: p })

/** 收付款弹窗的账户下拉：只返回启用的 */
export const getActiveAccountsApi = () => client.get<FinanceAccount[]>('/finance/accounts/active')

export const getAccountApi = (id: number) => client.get<FinanceAccount>(`/finance/accounts/${id}`)

export const createAccountApi = (d: object) => client.post<{ id:number; code:string }>('/finance/accounts', d)
export const updateAccountApi = (id: number, d: object) => client.put<unknown>(`/finance/accounts/${id}`, d)
export const deleteAccountApi = (id: number) => client.delete<unknown>(`/finance/accounts/${id}`)

/** 余额调整：填目标余额，服务端补一笔差额流水（不直接改余额，留痕） */
export const adjustAccountApi = (id: number, d: { targetBalance: number; happenedAt?: string; remark?: string }) =>
  client.post<{ id:number; balance:number; diff:number }>(`/finance/accounts/${id}/adjust`, d)

export const getAccountTransactionsApi = (p: { accountId?: number; bizType?: string; direction?: string; startDate?: string; endDate?: string; pageSize?: number }) =>
  client.get<{ list: AccountTransaction[]; summary: { inAmount:number; outAmount:number }; pagination: unknown }>(
    '/finance/accounts/transactions', { params: p })

export const checkAccountConsistencyApi = () =>
  client.get<{ checked:number; mismatchCount:number; mismatches: Array<{ id:number; code:string; name:string; recorded:number; expected:number }> }>(
    '/finance/accounts/consistency')

// ── 费用报销 ──────────────────────────────────────────────────────────────────

export interface ExpenseCategory {
  id: number
  code: string
  name: string
  isActive: boolean
  sortOrder: number
  remark?: string | null
}

export interface ExpenseClaimItem {
  id?: number
  categoryId: number
  categoryName?: string
  amount: number
  happenedAt: string
  description?: string | null
}

export interface ExpenseClaim {
  id: number
  claimNo: string
  title?: string | null
  applicantId: number
  applicantName: string
  totalAmount: number
  /** 1草稿 2待审批 3已批准 4已付款 5已驳回 6已取消 */
  status: 1 | 2 | 3 | 4 | 5 | 6
  statusName: string
  statusTone: string
  itemCount?: number
  submittedAt?: string | null
  approvedByName?: string | null
  approvedAt?: string | null
  rejectReason?: string | null
  paidAccountId?: number | null
  paidAccountName?: string | null
  paidAt?: string | null
  paidByName?: string | null
  remark?: string | null
  createdAt: string
}

export const getExpenseCategoriesApi = (activeOnly = false) =>
  client.get<ExpenseCategory[]>('/finance/expense-categories', { params: activeOnly ? { activeOnly: '1' } : {} })
export const createExpenseCategoryApi = (d: { name: string; sortOrder?: number; remark?: string }) =>
  client.post<{ id:number; code:string }>('/finance/expense-categories', d)
export const updateExpenseCategoryApi = (id: number, d: { name: string; isActive: boolean; sortOrder?: number; remark?: string }) =>
  client.put<unknown>(`/finance/expense-categories/${id}`, d)
export const deleteExpenseCategoryApi = (id: number) =>
  client.delete<unknown>(`/finance/expense-categories/${id}`)

export const getExpenseClaimsApi = (p: object) =>
  client.get<{ list: ExpenseClaim[]; summary: { totalAmount:number; pendingAmount:number; paidAmount:number }; pagination: unknown }>(
    '/finance/expense-claims', { params: p })
export const getExpenseClaimApi = (id: number) =>
  client.get<ExpenseClaim & { items: ExpenseClaimItem[] }>(`/finance/expense-claims/${id}`)
export const createExpenseClaimApi = (d: { title?: string; items: ExpenseClaimItem[]; remark?: string }) =>
  client.post<{ id:number; claimNo:string; totalAmount:number }>('/finance/expense-claims', d)
export const updateExpenseClaimApi = (id: number, d: { title?: string; items?: ExpenseClaimItem[]; remark?: string }) =>
  client.put<unknown>(`/finance/expense-claims/${id}`, d)

export const submitExpenseClaimApi   = (id: number) => client.post<unknown>(`/finance/expense-claims/${id}/submit`)
export const withdrawExpenseClaimApi = (id: number) => client.post<unknown>(`/finance/expense-claims/${id}/withdraw`)
export const cancelExpenseClaimApi   = (id: number) => client.post<unknown>(`/finance/expense-claims/${id}/cancel`)
export const approveExpenseClaimApi  = (id: number) => client.post<unknown>(`/finance/expense-claims/${id}/approve`)
export const rejectExpenseClaimApi   = (id: number, reason: string) =>
  client.post<unknown>(`/finance/expense-claims/${id}/reject`, { reason })
export const payExpenseClaimApi = (id: number, d: { accountId: number; happenedAt?: string; remark?: string }) =>
  client.post<unknown>(`/finance/expense-claims/${id}/pay`, d)

// ── 资金看板 ──────────────────────────────────────────────────────────────────

export interface FinanceDashboard {
  range: { startDate: string; endDate: string }
  summary: {
    totalBalance: number; accountCount: number
    inAmount: number; outAmount: number; netAmount: number; expenseTotal: number
  }
  accounts: Array<{ id:number; code:string; name:string; typeName:string; balance:number; share:number }>
  monthly: Array<{ month:string; inAmount:number; outAmount:number; netAmount:number }>
  byBizType: Array<{ bizType:number; bizTypeName:string; inAmount:number; outAmount:number; txCount:number }>
  expenseByCategory: Array<{ categoryName:string; amount:number; claimCount:number; share:number }>
  pending: { approveAmount:number; approveCount:number; payAmount:number; payCount:number }
}

export const getFinanceDashboardApi = (p: { startDate?: string; endDate?: string } = {}) =>
  client.get<FinanceDashboard>('/finance/dashboard', { params: p })
