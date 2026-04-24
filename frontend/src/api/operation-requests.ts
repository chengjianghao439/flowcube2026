import { payloadClient as client } from './client'
import type { ApiResponse } from '@/types'

export interface OperationRequestStatus {
  status: 'pending' | 'success' | 'failed' | 'not_found'
  data: unknown
  message: string
  resourceType?: string | null
  resourceId?: number | null
}

export const getOperationRequestStatusApi = (requestKey: string, action: string) =>
  client.get<ApiResponse<OperationRequestStatus>>(`/system/request-status/${encodeURIComponent(requestKey)}`, {
    params: { action },
    skipGlobalError: true,
  })
