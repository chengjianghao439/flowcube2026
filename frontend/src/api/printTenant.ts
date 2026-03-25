import apiClient from './client'
import type { ApiResponse } from '@/types'

export interface TenantQuotas {
  maxQueueJobs: number | null
  maxConcurrentPrinting: number | null
  monthlyPrintQuota: number | null
  policyTemplate: string | null
  queueUtilization: number | null
  concurrentUtilization: number | null
}

export interface TenantDashboard {
  tenantId: number
  windowDays: number
  queueLength: number
  pendingCount: number
  printingCount: number
  successRate: number | null
  avgLatencyMs: number | null
  doneCount: number
  failedCount: number
  quotas: TenantQuotas
  policy: {
    explorationMode: string
    explorationRate: number | null
    weights: { err: number; lat: number; hb: number }
    latScoreScaleMs: number
    explorationAdaptive: Record<string, number>
  }
}

export interface TenantSettingsPayload {
  tenantId?: number
  maxQueueJobs?: number | null
  maxConcurrentPrinting?: number | null
  explorationMode?: 'adaptive' | 'fixed'
  explorationRate?: number | null
  explorationMin?: number | null
  explorationMax?: number | null
  explorationBase?: number | null
  explorationKErr?: number | null
  explorationKLat?: number | null
  explorationLatNormMs?: number | null
  weightErr?: number | null
  weightLat?: number | null
  weightHb?: number | null
  latScoreScaleMs?: number | null
  monthlyPrintQuota?: number | null
  policyTemplate?: string | null
}

export interface PolicyTemplateItem {
  key: 'stable' | 'speed' | 'balanced'
  label: string
  description: string
}

export interface TenantBillingMonth {
  yearMonth: string
  jobCount: number
  copyCount: number
  updatedAt: string
}

export interface PrintAlertItem {
  id: number
  tenantId: number
  alertType: string
  severity: string
  title: string
  message: string
  context: unknown
  createdAt: string
  acknowledgedAt: string | null
  acknowledgedBy: number | null
}

export interface TenantSettingsResponse {
  settings: TenantSettingsPayload & { hasDbRow: boolean; updatedAt?: string | null }
  effective: Record<string, unknown>
}

export async function getPrintTenantDashboard(params?: { tenantId?: number; windowDays?: number }) {
  const res = await apiClient.get<ApiResponse<TenantDashboard>>('/print-jobs/tenant-dashboard', { params })
  return res.data.data
}

export async function getPrintTenantsOverview(windowDays?: number) {
  const res = await apiClient.get<ApiResponse<TenantDashboard[]>>('/print-jobs/tenants-overview', {
    params: { windowDays },
  })
  return res.data.data
}

export async function getPrintTenantSettings(params?: { tenantId?: number }) {
  const res = await apiClient.get<ApiResponse<TenantSettingsResponse>>('/print-jobs/tenant-settings', { params })
  return res.data.data
}

export async function putPrintTenantSettings(body: TenantSettingsPayload) {
  const res = await apiClient.put<ApiResponse<TenantSettingsResponse & { message: string }>>(
    '/print-jobs/tenant-settings',
    body,
  )
  return res.data.data
}

export async function getPrintPolicyTemplates() {
  const res = await apiClient.get<ApiResponse<PolicyTemplateItem[]>>('/print-jobs/policy-templates')
  return res.data.data
}

export async function applyPrintPolicyTemplate(body: { template: PolicyTemplateItem['key']; tenantId?: number }) {
  const res = await apiClient.post<ApiResponse<TenantSettingsResponse & { message: string }>>(
    '/print-jobs/tenant-settings/apply-template',
    body,
  )
  return res.data.data
}

export async function getPrintTenantBilling(params?: { tenantId?: number; months?: number }) {
  const res = await apiClient.get<
    ApiResponse<{ tenantId: number; currentYearMonth: string; months: TenantBillingMonth[] }>
  >('/print-jobs/tenant-billing', { params })
  return res.data.data
}

export async function getPrintAlerts(params?: { tenantId?: number; limit?: number; unackOnly?: boolean }) {
  const res = await apiClient.get<ApiResponse<PrintAlertItem[]>>('/print-jobs/alerts', {
    params: {
      ...params,
      unackOnly: params?.unackOnly ? '1' : undefined,
    },
  })
  return res.data.data
}

export async function ackPrintAlert(id: number) {
  await apiClient.post(`/print-jobs/alerts/${id}/ack`)
}
