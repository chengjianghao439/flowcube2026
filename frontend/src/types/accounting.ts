/** 会计核算类型（文档 10 · Phase 0 科目地基） */

export interface Account {
  id: number
  code: string
  name: string
  category: number      // 1资产 2负债 3权益 4成本 5损益(收入) 6损益(费用)
  balanceDir: number    // 1借 2贷
  parentId: number | null
  level: number
  isLeaf: number        // 1明细科目(可记账) 0汇总科目(有下级)
  auxType: number       // 0无 1往来单位
  isActive: number      // 1启用 0停用
  isPreset: number      // 1系统预置
  sortOrder: number
  remark: string | null
  createdAt: string
  children?: Account[]   // 仅树形接口包含
}

export interface CreateAccountParams {
  code: string
  name: string
  category: number
  balanceDir?: number
  parentId?: number | null
  auxType?: number
  sortOrder?: number
  remark?: string | null
}

export interface UpdateAccountParams {
  name?: string
  category?: number
  balanceDir?: number
  auxType?: number
  sortOrder?: number
  remark?: string | null
}

// ── 展示用静态枚举（分类标识，非业务规则） ──────────────────────────────
export const ACCOUNT_CATEGORY_LABELS: Record<number, string> = {
  1: '资产', 2: '负债', 3: '权益', 4: '成本', 5: '收入', 6: '费用',
}
export const BALANCE_DIR_LABELS: Record<number, string> = { 1: '借', 2: '贷' }
export const AUX_TYPE_LABELS: Record<number, string> = { 0: '无', 1: '往来单位' }

/** 资产/成本/费用 借；负债/权益/收入 贷（仅用于新建时预填方向，最终以后端为准） */
export function defaultBalanceDir(category: number): number {
  return (category === 1 || category === 4 || category === 6) ? 1 : 2
}

// ── 记账凭证（Phase 1） ──────────────────────────────────────────────
export interface VoucherEntry {
  id: number
  lineNo: number
  accountId: number
  accountCode: string
  accountName: string
  direction: number      // 1借 2贷
  amount: number
  summary: string | null
  auxType: number
  auxId: number | null
  auxName: string | null
}

export interface Voucher {
  id: number
  voucherNo: string
  voucherDate: string
  period: string
  sourceType: string
  sourceTypeName: string
  sourceId: number | null
  sourceNo: string | null
  summary: string | null
  totalDebit: number
  totalCredit: number
  status: number         // 1已生成 2已过账 3已冲销
  isReversal: number
  reversedId: number | null
  createdAt: string
  entries?: VoucherEntry[]
}

export interface GenerateStats {
  created: number
  updated: number
  unchanged: number
  reversed: number
  empty: number
  total: number
}

export interface ReconciliationItem {
  name: string
  voucher: number
  business: number
  diff: number
  matched: boolean
}

export interface ManualEntryInput {
  accountId: number
  direction: number
  amount: number
  summary?: string | null
  auxType?: number
  auxId?: number | null
  auxName?: string | null
}
export interface CreateManualVoucherParams {
  voucherDate: string
  summary?: string | null
  entries: ManualEntryInput[]
}

export const VOUCHER_STATUS_LABELS: Record<number, string> = { 1: '已生成', 2: '已过账', 3: '已冲销' }

// ── 总账 / 报表（Phase 2） ──────────────────────────────────────────────
export interface TrialBalanceRow {
  accountId: number
  code: string
  name: string
  category: number
  categoryName: string
  balanceDir: number
  level: number
  isLeaf: boolean
  openingDebit: number
  openingCredit: number
  periodDebit: number
  periodCredit: number
  closingDebit: number
  closingCredit: number
}
export interface TrialBalance {
  period: string
  start: string
  end: string
  list: TrialBalanceRow[]
  totals: {
    openingDebit: number; openingCredit: number
    periodDebit: number; periodCredit: number
    closingDebit: number; closingCredit: number
  }
  balanced: { period: boolean; closing: boolean }
}

export interface LedgerEntry {
  voucherId: number
  voucherNo: string
  voucherDate: string
  summary: string | null
  auxName: string | null
  debit: number
  credit: number
  balance: number
}
export interface AccountLedger {
  account: { id: number; code: string; name: string; balanceDir: number }
  period: string
  openingBalance: number
  closingBalance: number
  list: LedgerEntry[]
}

export interface ReportRow { name: string; amount: number; bold?: boolean }
export interface IncomeStatement { period: string; rows: ReportRow[]; profit: number }
export interface CashFlow { period: string; rows: ReportRow[]; net: number }
export interface BalanceSheetItem { code: string; name: string; amount: number }
export interface BalanceSheet {
  period: string
  asOf: string
  assets: BalanceSheetItem[]
  liabilities: BalanceSheetItem[]
  equity: BalanceSheetItem[]
  assetTotal: number
  liabTotal: number
  equityTotal: number
  liabEquityTotal: number
  balanced: boolean
}

// ── 发票（Phase 3） ──────────────────────────────────────────────────
export interface Invoice {
  id: number
  invoiceType: number       // 1进项 2销项
  invoiceTypeName: string
  invoiceCode: string | null
  invoiceNo: string | null
  partyName: string
  partyTaxNo: string | null
  amountNoTax: number
  taxRate: number
  taxAmount: number
  amountWithTax: number
  invoiceDate: string
  status: number
  statusName: string
  sourceType: string | null
  sourceId: number | null
  sourceNo: string | null
  remark: string | null
  operatorName: string | null
  createdAt: string
}
export interface CreateInvoiceParams {
  invoiceType: number
  invoiceCode?: string | null
  invoiceNo: string
  partyName: string
  partyTaxNo?: string | null
  amountNoTax: number
  taxRate: number
  taxAmount: number
  amountWithTax: number
  invoiceDate: string
  sourceType?: string | null
  sourceId?: number | null
  sourceNo?: string | null
  remark?: string | null
}
// 状态标签按 invoiceType 分：进项 1待认证2已认证3已抵扣；销项 1已开具2已红冲
export const INVOICE_STATUS_LABELS: Record<number, Record<number, string>> = {
  1: { 1: '待认证', 2: '已认证', 3: '已抵扣' },
  2: { 1: '已开具', 2: '已红冲' },
}

// ── 会计期间 / 期末结转（增强②） ────────────────────────────────────────────
export interface AccountingPeriod {
  period: string
  closed: boolean
  closedByName: string | null
  closedAt: string | null
  closingStatus: 'current' | 'stale' | 'missing' | 'not_required'
  yearClosingStatus: 'current' | 'stale' | 'missing' | 'not_required' | null
}

export const CLOSING_STATUS_LABELS: Record<string, string> = {
  current: '结转已最新', stale: '结转需更新', missing: '未生成结转', not_required: '无需结转',
}

// 凭证来源类型（用于筛选下拉；展示直接用后端 sourceTypeName）
export const VOUCHER_SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'purchase_settle', label: '采购结算' },
  { value: 'sale_revenue', label: '销售收入' },
  { value: 'sale_cogs', label: '销售成本' },
  { value: 'receipt_in', label: '收款' },
  { value: 'payment_out', label: '付款' },
  { value: 'expense_pay', label: '费用报销' },
  { value: 'purchase_return', label: '采购退货' },
  { value: 'sale_return', label: '销售退货' },
  { value: 'stock_check', label: '盘点盈亏' },
  { value: 'period_close', label: '期末损益结转' },
  { value: 'period_close_year', label: '年度利润结转' },
  { value: 'manual', label: '手工凭证' },
]
