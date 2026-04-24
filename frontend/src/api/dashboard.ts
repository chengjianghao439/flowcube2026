import { payloadClient as client } from './client'

import type { DashboardSummary, LowStockItem, TrendPoint, TopStockItem } from '@/types/dashboard'
export const getDashboardSummaryApi = () => client.get<DashboardSummary>('/dashboard/summary')
export const getLowStockApi         = (threshold?: number) => client.get<LowStockItem[]>('/dashboard/low-stock', { params: { threshold } })
export const getTrendApi            = (days?: number) => client.get<TrendPoint[]>('/dashboard/trend', { params: { days } })
export const getTopStockApi         = () => client.get<TopStockItem[]>('/dashboard/top-stock')
