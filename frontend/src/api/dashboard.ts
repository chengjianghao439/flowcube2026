import { payloadClient as client } from './client'

import type { DashboardSummary, LowStockItem, TrendPoint, TopStockItem, IncomingPurchases, DashboardLayout, CreditWarning } from '@/types/dashboard'
export const getDashboardSummaryApi = () => client.get<DashboardSummary>('/dashboard/summary')
export const getLowStockApi         = (threshold?: number) => client.get<LowStockItem[]>('/dashboard/low-stock', { params: { threshold } })
export const getTrendApi            = (days?: number) => client.get<TrendPoint[]>('/dashboard/trend', { params: { days } })
export const getTopStockApi         = () => client.get<TopStockItem[]>('/dashboard/top-stock')
export const getIncomingPurchasesApi = () => client.get<IncomingPurchases>('/dashboard/incoming-purchases')
export const getCreditWarningApi = () => client.get<CreditWarning>('/dashboard/credit-warning')

/** 读取当前用户的仪表盘布局；从未个性化时后端返回 null，由前端回落到默认布局 */
export const getDashboardLayoutApi  = () => client.get<DashboardLayout | null>('/dashboard/layout')
export const saveDashboardLayoutApi = (layout: DashboardLayout) => client.put<DashboardLayout>('/dashboard/layout', layout)
