import client from './client'
import type { ApiResponse } from '@/types'
import type { PrintTemplate, CreateTemplateParams, UpdateTemplateParams } from '@/types/print-template'

export const getPrintTemplateListApi   = (params?: { type?: number }) => client.get<ApiResponse<PrintTemplate[]>>('/print-templates', { params })
export const getPrintTemplateDetailApi = (id: number)                  => client.get<ApiResponse<PrintTemplate>>(`/print-templates/${id}`)
export const createPrintTemplateApi    = (data: CreateTemplateParams)  => client.post<ApiResponse<{ id: number }>>('/print-templates', data)
export const updatePrintTemplateApi    = ({ id, ...data }: UpdateTemplateParams) => client.put<ApiResponse<null>>(`/print-templates/${id}`, data)
export const setDefaultTemplateApi     = (id: number)                  => client.post<ApiResponse<null>>(`/print-templates/${id}/default`)
export const deletePrintTemplateApi    = (id: number)                  => client.delete<ApiResponse<null>>(`/print-templates/${id}`)
