import { Package, Boxes, Wallet, ShoppingCart, ClipboardList, Truck, ScanLine, HandCoins, CreditCard, Landmark, Gauge } from 'lucide-react'
import { StatTile } from '../StatTile'
import { money } from '../chartTheme'
import {
  useDashboardSummary, useWarehouseOps, useAging, useFinanceDashboard, useCreditWarning,
} from '@/hooks/useDashboard'

// KPI 磁贴：薄组件，各自取数后交给通用 StatTile 渲染。同源磁贴共用一个 hook（同 queryKey），
// React Query 自动去重——一行 5 个库存 KPI 只发一次 /dashboard/summary。

// —— 库存 / 单据（dashboard.view）——
export function KpiTotalSkus() {
  const { data, isLoading } = useDashboardSummary()
  return <StatTile label="在库 SKU 数" value={data?.totalSkus ?? '—'} hint="种商品有库存" icon={Package} loading={isLoading} />
}
export function KpiTotalQty() {
  const { data, isLoading } = useDashboardSummary()
  return <StatTile label="库存总数量" value={data ? data.totalQty.toFixed(0) : '—'} hint="各仓库汇总" icon={Boxes} tone="info" loading={isLoading} />
}
export function KpiTotalValue() {
  const { data, isLoading } = useDashboardSummary()
  return <StatTile label="库存总价值" value={data ? `¥${(data.totalValue / 10000).toFixed(2)}万` : '—'} hint="按成本价估算" icon={Wallet} tone="primary" loading={isLoading} />
}
export function KpiPendingPurchase() {
  const { data, isLoading } = useDashboardSummary()
  const n = data?.pendingPurchaseOrders ?? 0
  return <StatTile label="待处理采购" value={data?.pendingPurchaseOrders ?? '—'} hint="草稿 + 已提交" icon={ShoppingCart} tone={n > 0 ? 'warning' : 'primary'} trend={n > 0 ? 'up' : undefined} loading={isLoading} />
}
export function KpiPendingSale() {
  const { data, isLoading } = useDashboardSummary()
  const n = data?.pendingSaleOrders ?? 0
  return <StatTile label="待处理销售" value={data?.pendingSaleOrders ?? '—'} hint="待占库 + 部分占库 + 已占库" icon={ClipboardList} tone={n > 0 ? 'warning' : 'primary'} trend={n > 0 ? 'up' : undefined} loading={isLoading} />
}

// —— 今日作业（report.view）——
export function KpiShippedToday() {
  const { data, isLoading } = useWarehouseOps()
  return <StatTile label="今日出库" value={data?.summary.shippedToday ?? '—'} hint="单已出库" icon={Truck} tone="success" loading={isLoading} />
}
export function KpiScanToday() {
  const { data, isLoading } = useWarehouseOps()
  return <StatTile label="今日扫码量" value={data?.summary.scanCount ?? '—'} hint={data ? `拣货 ${data.summary.pickQty.toFixed(0)} 件` : '次扫描操作'} icon={ScanLine} tone="info" loading={isLoading} />
}

// —— 账款 / 资金（payment.view / finance.account.view）——
export function KpiReceivable() {
  const { data, isLoading } = useAging()
  const s = data?.receivable
  return <StatTile label="未清应收" value={s ? money(s.total) : '—'} hint={s ? `${s.totalCount} 笔未收回` : '加载应收余额'} icon={HandCoins} tone="info" loading={isLoading} />
}
export function KpiPayable() {
  const { data, isLoading } = useAging()
  const s = data?.payable
  return <StatTile label="应付敞口" value={s ? money(s.total) : '—'} hint={s && s.overdueAmount > 0 ? `逾期 ${money(s.overdueAmount)}` : `${s?.totalCount ?? 0} 笔待支付`} icon={CreditCard} tone={s && s.overdueAmount > 0 ? 'warning' : 'primary'} loading={isLoading} />
}
export function KpiAccountBalance() {
  const { data, isLoading } = useFinanceDashboard()
  return <StatTile label="账户余额合计" value={data ? money(data.summary.totalBalance) : '—'} hint={data ? `${data.summary.accountCount} 个启用账户` : undefined} icon={Landmark} tone="primary" loading={isLoading} />
}

// —— 授信预警（sale.credit.view）——
export function KpiCreditWarning() {
  const { data, isLoading } = useCreditWarning()
  const over = data?.overCount ?? 0
  const high = data?.highRiskCount ?? 0
  const top = data?.top?.[0]
  const hint = over > 0
    ? `超限 ${over} 家` + (high > 0 ? ` · 高危 ${high} 家` : '')
    : (high > 0 ? `${high} 家接近额度（≥90%）` : `${data?.totalCustomers ?? 0} 家客户在用信`)
  return <StatTile label="授信预警" value={over > 0 ? `${over} 家超限` : '正常'} hint={top ? `${top.customerName} ${top.usageRatePct}%` : hint} icon={Gauge} tone={over > 0 ? 'danger' : (high > 0 ? 'warning' : 'success')} loading={isLoading} />
}
