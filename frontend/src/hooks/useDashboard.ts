import { useQuery } from '@tanstack/react-query'
import { getDashboardSummaryApi, getLowStockApi, getTrendApi, getTopStockApi } from '@/api/dashboard'
import { getPdaPerformanceApi } from '@/api/reports'
export const useDashboardSummary = () => useQuery({ queryKey:['dashboard-summary'], queryFn:()=>getDashboardSummaryApi().then(r=>r!), refetchInterval:60000 })
export const useLowStock         = (threshold=10) => useQuery({ queryKey:['low-stock',threshold], queryFn:()=>getLowStockApi(threshold).then(r=>r||[]) })
export const useTrend            = (days=7) => useQuery({ queryKey:['trend',days], queryFn:()=>getTrendApi(days).then(r=>r||[]) })
export const useTopStock         = () => useQuery({ queryKey:['top-stock'], queryFn:()=>getTopStockApi().then(r=>r||[]) })
export const usePdaPerformance   = () => useQuery({ queryKey:['pda-performance'], queryFn:()=>getPdaPerformanceApi().then(r=>r!), refetchInterval:30000 })
