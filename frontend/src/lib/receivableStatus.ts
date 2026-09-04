import type { SaleOrder } from '@/types/sale'
import type { StatusTone } from '@/lib/statusTone'
import { SETTLEMENT_TYPE } from '@/generated/status'

export interface ReceivableStatus {
  label: string
  tone: StatusTone
  /** 到期日（账期至 X），逾期/月结时用于悬停提示 */
  dueDate?: string | null
}

/** 回款状态只描述真实应收记录。无记录时不使用客户结算回退值制造未付/逾期；
 * 已有应收仍沿用账款快照及既有月结、部分付语义。 */
export function getReceivableStatus(order: SaleOrder): ReceivableStatus {
  const st = order.receivableStatus
  if (st == null) return { label: '未生成应收', tone: 'draft' }
  if (st === 3) return { label: '已付清', tone: 'success', dueDate: order.receivableDueDate }
  if (st === 2) return { label: '部分付', tone: 'active', dueDate: order.receivableDueDate }

  const monthly = order.receivableSettlementType === SETTLEMENT_TYPE.MONTHLY
  // 逾期：月结显示「逾期」，现结保持「未付」文案但同样标红
  if (order.receivableOverdue) {
    return monthly
      ? { label: '逾期', tone: 'danger', dueDate: order.receivableDueDate }
      : { label: '未付', tone: 'danger', dueDate: order.receivableDueDate }
  }
  if (monthly) return { label: '月结', tone: 'active', dueDate: order.receivableDueDate }
  return { label: '未付', tone: 'draft', dueDate: order.receivableDueDate }
}
