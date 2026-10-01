import type { AxiosRequestConfig } from 'axios'
import { payloadClient as client } from './client'

export interface OperationRequestStatus {
  status: 'pending' | 'success' | 'failed' | 'not_found'
  data: unknown
  message: string
  resourceType?: string | null
  resourceId?: number | null
}

export const getOperationRequestStatusApi = (requestKey: string, action: string, config?: AxiosRequestConfig) =>
  client.get<OperationRequestStatus>(`/system/request-status/${encodeURIComponent(requestKey)}`, {
    ...config,
    params: { ...config?.params, action },
    skipGlobalError: true,
  })
