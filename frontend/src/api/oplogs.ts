import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
export interface OpLog { id:number; userId:number; userName:string; method:string; path:string; module:string; requestBody?:string; statusCode:number; ip?:string; createdAt:string }
export const getOpLogsApi = (p:object) => client.get<PaginatedData<OpLog>>('/oplogs', {params:p})
export const clearLogsApi = () => client.delete<null>('/oplogs/clear')
