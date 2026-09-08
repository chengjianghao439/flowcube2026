import { payloadClient as client } from './client'

import type { PrintTemplate, CreateTemplateParams, UpdateTemplateParams } from '@/types/print-template'

export const getPrintTemplateListApi   = (params?: { type?: number }) => client.get<PrintTemplate[]>('/print-templates', { params })
export const getPrintTemplateDetailApi = (id: number)                  => client.get<PrintTemplate>(`/print-templates/${id}`)
export const createPrintTemplateApi    = (data: CreateTemplateParams)  => client.post<{ id: number }>('/print-templates', data)
export const updatePrintTemplateApi    = ({ id, ...data }: UpdateTemplateParams) => client.put<null>(`/print-templates/${id}`, data)
export const deletePrintTemplateApi    = (id: number, config?: Parameters<typeof client.delete>[1]) => client.delete<null>(`/print-templates/${id}`, config)

/** 只取一条有权限的真实预览记录，不触发业务列表全量读取。 */
export const getPrintTemplatePreviewApi = (type: number, signal?: AbortSignal) => client.get<import('@/lib/printTemplatePreview').PrintTemplatePreview | null>('/print-templates/preview-data', { params: { type }, signal, listMode: 'summary', skipGlobalError: true })
