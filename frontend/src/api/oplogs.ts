import { payloadClient as client } from './client'
import type { ApiResponse, PaginatedData } from '@/types'
export interface OpLog { id:number; userId:number; userName:string; method:string; path:string; module:string; requestBody?:string; statusCode:number; ip?:string; createdAt:string }
export const getOpLogsApi = (p:object) => client.get<ApiResponse<PaginatedData<OpLog>>>('/oplogs', {params:p})
export const clearLogsApi = () => client.delete<ApiResponse<null>>('/oplogs/clear')
