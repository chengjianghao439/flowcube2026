import type { SaleOrder } from '@/types/sale'
import type { StatusTone } from '@/lib/statusTone'
import { SETTLEMENT_TYPE } from '@/generated/status'

export interface ReceivableStatus {
  label: string
  tone: StatusTone
  /** 到期日（账期至 X），逾期/月结时用于悬停提示 */
  dueDate?: string | null
}

/**
 * 回款状态决策表（独立于订单状态，列表页与详情页共用同一份，避免两处口径漂移）：
 *   - 已付清 (receivableStatus=3) → 已付清
 *   - 部分付 (receivableStatus=2) → 部分付（保留，不细分逾期：它比逾期多一层信息）
 *   - 其余（未付 status=1 或未出库 null）：
 *       逾期 + 月结  → 逾期（红）
 *       逾期 + 现结  → 未付（红，文案保持「未付」，仅用颜色强调已过下单当天）
 *       月结未逾期    → 月结
 *       现结未逾期    → 未付（灰）
 *
 * 未出库订单没有应收记录（receivableStatus=null），但结算方式由后端
 * COALESCE(应收快照, 客户主数据, 月结) 回退出来（receivableSettlementType 恒非 null），
 * 现结未出库的到期日也已由后端回退成 DATE(下单日)，故现结逾期边界同样成立。
 */
export function getReceivableStatus(order: SaleOrder): ReceivableStatus {
  const st = order.receivableStatus
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
