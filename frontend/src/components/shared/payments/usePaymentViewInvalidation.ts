import { useQueryClient } from '@tanstack/react-query'

/**
 * 账款类写操作（登记收付款、应付结算确认）成功后统一失效的缓存。
 *
 * 账款页与对账页读的是两个不同的 query key，改完钱两边都要失效，否则在对账页登记完付款、
 * 切回账款页看到的还是旧余额；账龄/敞口看板与资金账户余额同样随收付款变化。
 * 原来这套失效写在 usePaymentActions 里，弹窗拆成独立组件后由本 hook 复用同一口径。
 */
export function usePaymentViewInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['reconciliation'] })
    qc.invalidateQueries({ queryKey: ['finance-dashboard'] })
    qc.invalidateQueries({ queryKey: ['finance-accounts'] })
  }
}
