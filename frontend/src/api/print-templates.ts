import { payloadClient as client } from './client'

import type { PrintTemplate, CreateTemplateParams, UpdateTemplateParams } from '@/types/print-template'

export const getPrintTemplateListApi   = (params?: { type?: number }) => client.get<PrintTemplate[]>('/print-templates', { params })
export const getPrintTemplateDetailApi = (id: number)                  => client.get<PrintTemplate>(`/print-templates/${id}`)
export const createPrintTemplateApi    = (data: CreateTemplateParams)  => client.post<{ id: number }>('/print-templates', data)
export const updatePrintTemplateApi    = ({ id, ...data }: UpdateTemplateParams) => client.put<null>(`/print-templates/${id}`, data)
export const setDefaultTemplateApi     = (id: number)                  => client.post<null>(`/print-templates/${id}/default`)
export const deletePrintTemplateApi    = (id: number)                  => client.delete<null>(`/print-templates/${id}`)
