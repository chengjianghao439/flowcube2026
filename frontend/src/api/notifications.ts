import client from './client'
import type { ApiResponse } from '@/types'

export interface NotificationItem {
  type: string
  icon: string
  text: string
  path: string
}

export interface NotificationData {
  total: number
  items: NotificationItem[]
  counts: Record<string, number>
}

export const getNotificationsApi = () =>
  client.get<ApiResponse<NotificationData>>('/notifications')
