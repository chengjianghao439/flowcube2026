// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { queryClient } from './queryClient'
import { useCompanyStore } from '@/store/companyStore'
import { useVouchers } from '@/hooks/useVouchers'
import apiClient from '@/api/client'
import { downloadExport } from './exportDownload'
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/api/accounting', () => ({ getVouchersApi: vi.fn(async () => ({ list: [{ id: useCompanyStore.getState().companyId }], pagination: { total: 1 } })) }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn() }))
vi.mock('@sentry/react', () => ({ withScope: vi.fn(), captureException: vi.fn() }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); useCompanyStore.setState({ companyId: 1, companyName: null }) })

it('切换账套后已挂载会计查询立即读取新账套', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  let visible: unknown
  function Probe() { const result = useVouchers({}); useEffect(() => { visible = result.data?.list[0]?.id }, [result.data]); return null }
  await act(async () => { root.render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(visible).toBe(1)
  await act(async () => { useCompanyStore.getState().setCompany(2, '乙账套'); await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(visible).toBe(2)
  await act(async () => root.unmount())
})

it('导出使用统一客户端的二进制请求', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['excel']), headers: { 'content-disposition': "attachment; filename*=UTF-8''test.xlsx" } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['old']), headers: new Headers() })))
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await downloadExport('/export/fixed-assets', { keyword: '设备' })
  expect(get).toHaveBeenCalledWith('/export/fixed-assets', expect.objectContaining({ responseType: 'blob', params: { keyword: '设备' } }))
})

it('错误边界通过认证客户端上报，不单独拼服务器地址', async () => {
  useAuthStore.setState({ token: 'test-only-token' })
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const boundary = new GlobalErrorBoundary({ children: null })
  boundary.componentDidCatch(new Error('audit render failure'), { componentStack: 'Audit' })
  await Promise.resolve()
  expect(post).toHaveBeenCalledWith('/system/error-report', expect.objectContaining({ message: 'audit render failure' }), expect.objectContaining({ skipGlobalError: true }))
})
