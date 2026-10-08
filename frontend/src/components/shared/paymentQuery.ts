import { todayYmd } from '@/lib/dateTime'

/** 账款 / 汇款单 / 对账单三类列表共用的查询条件；用不到的字段由开关关掉 */
export interface PaymentQueryValues {
  /** 单据编号（账款=关联单号，汇款单=收付款单号，对账单=对账单号） */
  docNo: string
  /** 往来方名称（供应商 / 客户） */
  partyName: string
  status: string
  /** 仅应付账款：0待确认 1已确认 */
  confirmStatus: string
  /** 主日期区间：账款=创建日，汇款单=汇款日，对账单=创建日 */
  startDate: string
  endDate: string
  /** 仅账款：到期日区间 */
  dueStart: string
  dueEnd: string
  minAmount: string
  maxAmount: string
}

export const EMPTY_PAYMENT_QUERY: PaymentQueryValues = {
  docNo: '', partyName: '', status: '', confirmStatus: '',
  startDate: todayYmd(), endDate: '', dueStart: '', dueEnd: '',
  minAmount: '', maxAmount: '',
}

/** 判断是否有生效的筛选条件 */
export function hasActiveQuery(v: PaymentQueryValues): boolean {
  return Object.values(v).some(x => String(x || '').trim() !== '')
}
