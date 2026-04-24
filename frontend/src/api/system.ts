import { payloadClient as client } from './client'
import type { ApiResponse } from '@/types'

export interface SystemHealthIssue {
  checkType: string
  severity: 'high' | 'medium' | 'low' | 'danger' | 'warning' | 'fix_failed' | string
  relatedId: number | null
  relatedTable: string | null
  message: string
}

export interface SystemHealthRunSummary {
  runId: string
  triggeredBy: string
  checkedAt: string
  elapsedMs: number
  totalIssues: number
  hasHigh: boolean
  severity: {
    high: number
    medium: number
    low: number
  }
}

export interface SystemHealthRunResult {
  runId: string
  triggeredBy: string
  checkedAt: string
  elapsedMs: number
  healthy: boolean
  hasHigh: boolean
  totalIssues: number
  severity: {
    high: number
    medium: number
    low: number
  }
  issues: SystemHealthIssue[]
  checkErrors: Array<{ checkType: string; error: string }>
}

export interface SystemHealthLog {
  id: number
  run_id: string
  check_type: string
  severity: string
  related_id: number | null
  related_table: string | null
  message: string
  created_at: string
}

export interface SystemAutoFixResult {
  fixId: string
  triggeredBy: string
  fixedAt: string
  fixedCount: number
  failedCount: number
  totalFixes: number
  fixes: Array<{
    fixType: string
    relatedId?: number | null
    relatedTable?: string | null
    action: string
    success: boolean
  }>
  errors: Array<{ fixType: string; error: string }>
}

export interface SystemAutoFixType {
  checkType: string
  description: string
  risk: string
}

export const runSystemHealthApi = () =>
  client.get<ApiResponse<SystemHealthRunResult>>('/system/health')

export const getSystemHealthLogsApi = (limit = 100) =>
  client.get<ApiResponse<SystemHealthLog[]>>('/system/health/logs', { params: { limit } })

export const getSystemHealthRunsApi = (limit = 20) =>
  client.get<ApiResponse<SystemHealthRunSummary[]>>('/system/health/runs', { params: { limit } })

export const runSystemAutoFixApi = () =>
  client.post<ApiResponse<SystemAutoFixResult>>('/system/health/autofix')

export const getSystemAutoFixTypesApi = () =>
  client.get<ApiResponse<SystemAutoFixType[]>>('/system/health/autofix/types')
