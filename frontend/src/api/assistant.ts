import axios from 'axios'
import client, { ApiClientError, getApiClientBaseURL } from './client'
import { useAuthStore } from '@/store/authStore'
import type { ApiResponse } from '@/types'

export class AssistantRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}

/** 小满与 ERP 使用同一服务器、登录与续期；未知结果交给原任务恢复。 */
export async function requestAssistant<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const baseURL = getApiClientBaseURL()
  const generation = useAuthStore.getState().sessionGeneration
  try {
    const response = await client.request<ApiResponse<T>>({
      url: `/assistant${path}`, method: body === undefined ? 'GET' : 'POST', data: body,
      baseURL, signal, timeout: 60000, skipGlobalError: true,
      _erpApiFallbackTried: true, _authSessionGeneration: generation,
    })
    if (signal?.aborted || generation !== useAuthStore.getState().sessionGeneration || baseURL !== getApiClientBaseURL()) {
      throw new DOMException('连接或登录状态已变化', 'AbortError')
    }
    const envelope = response.data
    if (!envelope || envelope.success !== true || !envelope.data || typeof envelope.data !== 'object') {
      throw new AssistantRequestError('暂时没能取得完整结果，请查询原任务后再继续。', 502)
    }
    return envelope.data
  } catch (cause) {
    if (axios.isCancel(cause)) throw new DOMException('请求已中止', 'AbortError')
    if (cause instanceof ApiClientError) throw new AssistantRequestError(cause.message, cause.status ?? 0, cause.code ?? undefined)
    throw cause
  }
}
