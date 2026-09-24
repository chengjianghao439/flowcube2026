import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
export interface OpLog { id:number; userId:number; userName:string; method:string; path:string; module:string; requestBody?:string; statusCode:number|null; ip?:string; createdAt:string }
export const getOpLogsApi = (p:object) => client.get<PaginatedData<OpLog>>('/oplogs', {listMode: 'summary', params:{ ...p, hideDevelopment: '1', hidePrintPolling: '1' }})
export const clearLogsApi = () => client.delete<null>('/oplogs/clear')
