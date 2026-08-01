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
  { value: 'manual', label: '手工凭证' },
]
