import { getApiClientBaseURL, payloadClient as client } from './client'
import { collectAllRecords } from './allRecords'
import { useAuthStore } from '@/store/authStore'
import type { AxiosRequestConfig } from 'axios'
import type { PaginatedData } from '@/types'
export interface OpLog { id:number; userId:number; userName:string; method:string; path:string; module:string; requestBody?:string; statusCode:number|null; ip?:string; createdAt:string }
export const getOpLogsApi = (p:object, config?: AxiosRequestConfig) => client.get<PaginatedData<OpLog>>('/oplogs', { ...config, listMode: 'summary', params:{ ...p, hideDevelopment: '1', hidePrintPolling: '1' }})
/** 操作日志列表专用；旧 summary 调用仍按原页读取。 */
export const getAllOpLogsApi = (params: object, signal?: AbortSignal) => {
  const baseURL = getApiClientBaseURL(), generation = useAuthStore.getState().sessionGeneration
  const config: AxiosRequestConfig = { baseURL, _authSessionGeneration: generation, _erpApiFallbackTried: true, automaticReplay: false, signal }
  const assertCurrent = () => {
    if (getApiClientBaseURL() !== baseURL || useAuthStore.getState().sessionGeneration !== generation) throw Error('日志读取上下文已变化，请按当前范围重试')
  }
  return collectAllRecords<PaginatedData<OpLog>>(async page => {
    assertCurrent()
    const batch = await getOpLogsApi({ ...params, page, pageSize: 200 }, config)
    assertCurrent()
    return batch
  }, signal)
}
export const clearLogsApi = () => client.delete<null>('/oplogs/clear')
