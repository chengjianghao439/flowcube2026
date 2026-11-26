// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getByRole, getByText } from '@testing-library/dom'
import { expect, test, vi } from 'vitest'
import PortalStatementsPage from './statements'

const { statements } = vi.hoisted(() => ({ statements: vi.fn() }))
vi.mock('@/api/portal', () => ({ getPortalStatementsApi: statements }))
vi.mock('@/hooks/useCustomers', () => ({ useCustomers: () => ({
  data: { list: [{ id: 42, code: 'C42', name: '合成客户', isActive: true }] },
  isFetching: false,
}) }))

test('客户选择先写查询草稿，确认后读取对账单，失败时隐藏成功条数并可按原客户重试', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  statements.mockRejectedValueOnce(new Error('合成读取失败')).mockResolvedValue({ list: [], pagination: { total: 0 } })

  async function click(element: HTMLElement) { await act(async () => element.click()) }
  async function selectCustomer() {
    await click(getByRole(host, 'button', { name: '查询' }))
    const filters = getByRole(document.body, 'dialog', { name: '查询客户对账单' })
    await click(getByText(filters, '选择要查看的客户'))
    const finder = getByRole(document.body, 'dialog', { name: '选择客户' })
    await click(getByText(finder, '合成客户'))
    await click(getByRole(finder, 'button', { name: '确认选择' }))
    expect(getByText(filters, '合成客户')).toBeTruthy()
    return filters
  }
  async function waitForText(text: string) {
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.textContent).toContain(text)
    })
  }

  try {
    await act(async () => root.render(<QueryClientProvider client={query}><PortalStatementsPage /></QueryClientProvider>))
    const canceled = await selectCustomer()
    await click(getByRole(canceled, 'button', { name: '取消' }))
    expect(statements).not.toHaveBeenCalled()
    const applied = await selectCustomer()
    await click(getByRole(applied, 'button', { name: '查询' }))
    await waitForText('对账单加载失败')
    expect(statements).toHaveBeenCalledExactlyOnceWith({ customerId: 42, page: 1, pageSize: 20 })
    expect(host.textContent).not.toContain('共 0 张')
    await click(getByRole(host, 'button', { name: '重试' }))
    await waitForText('共 0 张')
    expect(statements).toHaveBeenLastCalledWith({ customerId: 42, page: 1, pageSize: 20 })
    await click(getByRole(host, 'button', { name: '清空' }))
    expect(host.textContent).toContain('先选择一位客户')
    expect(host.textContent).not.toContain('共 0 张')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    query.clear()
  }
})
