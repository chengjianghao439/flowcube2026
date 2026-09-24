// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReconciliationView from './ReconciliationView'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const fixture = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
  confirmRecord: null as Record<string, unknown> | null,
}))
vi.mock('@/api/reports', () => ({ getReconciliationApi: async () => ({ list: fixture.list, pagination: { total: fixture.list.length }, summary: {} }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/StatementPanel', () => ({ StatementPanel: () => <div /> }))
vi.mock('@/components/shared/ReceiptPanel', () => ({ ReceiptPanel: () => <div /> }))
vi.mock('@/components/shared/PaymentQueryDialog', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/shared/PaymentQueryDialog')>(),
  PaymentQueryDialog: () => null,
}))
vi.mock('@/components/shared/payments/SettlementConfirmDialog', () => ({ SettlementConfirmDialog: ({ open, record }: { open: boolean; record: Record<string, unknown> | null }) => {
  fixture.confirmRecord = open ? record : null
  return open ? <div>确认弹窗已打开</div> : null
} }))

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  fixture.confirmRecord = null
  fixture.list = [{
    id: 101, type: 1, orderNo: 'PC-TEST', partyName: '供应商一', totalAmount: 50,
    paidAmount: 0, balance: 50, status: 1, statusName: '未付', confirmStatus: 0,
    dueDate: null, createdAt: '2026-09-24', sourcePath: '/purchase/1', sourceOrderNo: 'PC-TEST',
    receiptPath: null, receiptTaskNo: null,
  }]
  useAuthStore.setState({ user: { roleId: 1, permissions: [] } as never })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })

async function render(type: 1 | 2) {
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={client}><ReconciliationView type={type} /></QueryClientProvider></MemoryRouter>)
  })
  await act(async () => host.querySelectorAll('button').forEach(b => { if (b.textContent === '全部账款') b.click() }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

it('供应商月结待确认行可打开结算确认，且保留原单入口', async () => {
  await render(1)
  const action = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '确认结算')
  expect(action).toBeTruthy()
  expect(host.textContent).toContain('待确认')
  await act(async () => action!.click())
  expect(fixture.confirmRecord).toMatchObject({ id: 101, orderNo: 'PC-TEST', totalAmount: 50 })
  expect(host.textContent).toContain('确认弹窗已打开')
})

it('月结客户和无确认权限的供应商不显示确认入口', async () => {
  await render(2)
  expect(host.textContent).not.toContain('确认结算')
})

it('没有财务确认权限时，供应商仍能看到待确认状态但不能执行确认', async () => {
  useAuthStore.setState({ user: { roleId: 5, permissions: [] } as never })
  await render(1)
  expect(host.textContent).toContain('待确认')
  expect(host.textContent).not.toContain('确认结算')
  expect(host.textContent).toContain('原单')
})

it('普通财务具备确认权限可以操作，已确认应付不再显示入口', async () => {
  useAuthStore.setState({ user: { roleId: 5, permissions: [PERMISSIONS.PAYMENT_CONFIRM] } as never })
  await render(1)
  expect(host.textContent).toContain('确认结算')
  fixture.list = fixture.list.map(r => ({ ...r, confirmStatus: 1 }))
  client.invalidateQueries({ queryKey: ['reconciliation'] })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(host.textContent).not.toContain('确认结算')
})
