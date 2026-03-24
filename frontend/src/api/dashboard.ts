import client from './client'
import type { ApiResponse } from '@/types'
import type { DashboardSummary, LowStockItem, TrendPoint, TopStockItem } from '@/types/dashboard'
export const getDashboardSummaryApi = () => client.get<ApiResponse<DashboardSummary>>('/dashboard/summary')
export const getLowStockApi         = (threshold?: number) => client.get<ApiResponse<LowStockItem[]>>('/dashboard/low-stock', { params: { threshold } })
export const getTrendApi            = (days?: number) => client.get<ApiResponse<TrendPoint[]>>('/dashboard/trend', { params: { days } })
export const getTopStockApi         = () => client.get<ApiResponse<TopStockItem[]>>('/dashboard/top-stock')
