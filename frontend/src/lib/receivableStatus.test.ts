import { describe, expect, it } from 'vitest'
import { getReceivableStatus } from './receivableStatus'
import type { SaleOrder } from '@/types/sale'
describe('销售应收存在性', () => {
  it('没有账款时不使用客户回退信息制造逾期', () => {
    expect(
      getReceivableStatus({
        receivableStatus: null,
        receivableOverdue: true,
      } as SaleOrder),
    ).toEqual({ label: '未生成应收', tone: 'draft' })
  })
  it('已有账款继续使用原状态', () => {
    expect(
      getReceivableStatus({ receivableStatus: 3 } as SaleOrder).label,
    ).toBe('已付清')
    expect(
      getReceivableStatus({ receivableStatus: 2 } as SaleOrder).label,
    ).toBe('部分付')
  })
})
