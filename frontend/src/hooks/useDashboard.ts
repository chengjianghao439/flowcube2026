import { useApprovalReadScope } from '@/hooks/useApprovalReadScope'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDashboardSummaryApi, getLowStockApi, getTrendApi, getTopStockApi,
  getIncomingPurchasesApi, getCreditWarningApi, getDashboardLayoutApi, saveDashboardLayoutApi,
} from '@/api/dashboard'
import {
  getPdaPerformanceApi, getWarehouseOpsApi, getRoleWorkbenchApi,
  getSaleStatsApi, getPurchaseStatsApi, getInventoryStatsApi, getPdaAnomalyApi,
} from '@/api/reports'
import { getFinanceDashboardApi } from '@/api/finance'
import { getAgingApi } from '@/api/payments'
import { listPendingApprovalsApi } from '@/api/approvals'
import { getRelativeDateRange } from '@/lib/dateRange'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import type { DashboardLayout } from '@/types/dashboard'
import { usePermission } from './usePermission'
import { visibleWorkbench } from '@/lib/workbench'
import { PENDING_APPROVAL_PERMISSIONS } from '@/lib/approvalBusiness'

// 图表/统计类小组件的默认区间：在模块加载时求值一次，保证同一页面生命周期内 queryKey 稳定
// （趋势看板不需要秒级更新区间；刷新页面自然取新区间）。
const RANGE_180 = getRelativeDateRange(180)
const RANGE_30 = getRelativeDateRange(30)

// ── 基础库存/单据数据（原有） ──────────────────────────────────────────────────
// 文档可见不等于工作区可见；KeepAlive 隐藏页必须关闭查询与定时器。
export function useDashboardSummary() {
  const active = useActiveWorkspaceTab()
  return useQuery({ queryKey: ['dashboard-summary'], queryFn: () => getDashboardSummaryApi().then(r => r!), enabled: active, refetchInterval: active ? 60000 : false })
}
export const useLowStock         = (threshold=10) => useQuery({ queryKey:['low-stock',threshold], queryFn:()=>getLowStockApi(threshold).then(r=>r||[]) })
export const useTrend            = (days=7) => useQuery({ queryKey:['trend',days], queryFn:()=>getTrendApi(days).then(r=>r||[]) })
export const useTopStock         = () => useQuery({ queryKey:['top-stock'], queryFn:()=>getTopStockApi().then(r=>r||[]) })
export function usePdaPerformance() {
  const active = useActiveWorkspaceTab()
  return useQuery({ queryKey: ['pda-performance'], queryFn: () => getPdaPerformanceApi().then(r => r!), enabled: active, refetchInterval: active ? 30000 : false })
}
export const useIncomingPurchases = () => useQuery({ queryKey:['incoming-purchases'], queryFn:()=>getIncomingPurchasesApi().then(r=>r ?? { dueToday:[], dueThisWeek:[], overdue:[] }) })

// ── 扩展数据源（复用 reports / finance / payments 接口）─────────────────────────
// 这些 hook 只在对应小组件被渲染时调用，而小组件仅在用户有相应权限时才挂载，
// 因此无权限用户不会触发这些请求；相同 queryKey 在多个小组件间自动去重共享缓存。
export function useWarehouseOps() {
  const active = useActiveWorkspaceTab()
  return useQuery({ queryKey: ['dash-warehouse-ops'], queryFn: () => getWarehouseOpsApi().then(r => r!), enabled: active, refetchInterval: active ? 60000 : false })
}
export const useFinanceDashboard = () => useQuery({ queryKey:['dash-finance',RANGE_180], queryFn:()=>getFinanceDashboardApi(RANGE_180).then(r=>r!), staleTime:300000 })
export const useAging           = () => useQuery({ queryKey:['dash-aging'], queryFn:()=>getAgingApi(8).then(r=>r!), staleTime:300000 })
export const useCreditWarning    = () => useQuery({ queryKey:['dash-credit-warning'], queryFn:()=>getCreditWarningApi().then(r=>r!), staleTime:300000 })
export function useRoleWorkbench() {
  const active = useActiveWorkspaceTab()
  const { can } = usePermission()
  return useQuery({ queryKey: ['role-workbench'], queryFn: () => getRoleWorkbenchApi().then(r => r!), select: data => visibleWorkbench(data, can), enabled: active, staleTime: 60_000, refetchInterval: active ? 60_000 : false })
}
export const useSaleStats       = () => useQuery({ queryKey:['dash-sale-stats',RANGE_180], queryFn:()=>getSaleStatsApi(RANGE_180).then(r=>r!), staleTime:300000 })
export const usePurchaseStats   = () => useQuery({ queryKey:['dash-purchase-stats',RANGE_180], queryFn:()=>getPurchaseStatsApi(RANGE_180).then(r=>r!), staleTime:300000 })
export const useInventoryStats  = () => useQuery({ queryKey:['dash-inventory-stats'], queryFn:()=>getInventoryStatsApi({}).then(r=>r!), staleTime:300000 })
export const usePdaAnomaly      = () => useQuery({ queryKey:['dash-anomaly',RANGE_30], queryFn:()=>getPdaAnomalyApi(RANGE_30).then(r=>r!), staleTime:300000 })
/** 与完整待办同一来源集合；首页仅单批摘要，每60s刷新。 */
export function usePendingApprovalsBrief() {
  const active = useActiveWorkspaceTab()
  const scope = useApprovalReadScope()
  const { can } = usePermission()
  const enabled = active && can(PENDING_APPROVAL_PERMISSIONS)
  const query = useQuery({ queryKey: ['dash-pending-approvals', scope.key], queryFn: async ({ signal }) => {
    const result = await listPendingApprovalsApi({ page: 1, pageSize: 5 }, true, { signal, baseURL: scope.server, _authSessionGeneration: scope.generation, _erpApiFallbackTried: true })
    if (!scope.isCurrent()) throw new Error('审批待办读取上下文已变化，请重试')
    return result
  }, enabled, subscribed: enabled, refetchInterval: enabled ? 60000 : false, placeholderData: undefined, staleTime: 0 })
  return { ...query, data: enabled && scope.isCurrent() && !query.isFetching && !query.isPaused ? query.data : undefined }
}

// ── 个性化布局存取 ─────────────────────────────────────────────────────────────
export const useDashboardLayout = () => useQuery({
  queryKey: ['dashboard-layout'],
  queryFn: () => getDashboardLayoutApi(),
  staleTime: Infinity,
})
export const useSaveDashboardLayout = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layout: DashboardLayout) => saveDashboardLayoutApi(layout),
    onSuccess: (data) => { if (data) qc.setQueryData(['dashboard-layout'], data) },
  })
}
