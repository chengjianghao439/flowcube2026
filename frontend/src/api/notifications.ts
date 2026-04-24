import { payloadClient as client } from './client'
import type { ApiResponse } from '@/types'

export interface NotificationItem {
  code?: string
  type: string
  icon: string
  text: string
  path: string
  category?: 'finance' | 'inventory' | 'operations' | 'system'
  priority?: number
  dedupeKey?: string
}

export interface NotificationData {
  total: number
  items: NotificationItem[]
  counts: Record<string, number>
}

export const getNotificationsApi = () =>
  client.get<ApiResponse<NotificationData>>('/notifications')
