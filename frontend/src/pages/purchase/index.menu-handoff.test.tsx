// @vitest-environment jsdom
// Real purchase page, table, menu and dialogs; only query/mutation boundaries
// and unrelated lookup controls are synthetic. No HTTP or business writes.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { getByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PurchasePage from './index'

const io = vi.hoisted(() => ({ status: 2, mutate: vi.fn(), submit: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/usePurchase', () => ({
  usePurchaseList: () => ({ data: { list: [{ id: 42, orderNo: 'PO-SYNTHETIC42', status: io.status, canCloseRemaining: true, totalAmount: 12.34 }], pagination: { total: 1 } }, isLoading: false, isError: false }),
  useConfirmPurchase: () => ({ mutate: io.mutate, isPending: false }),
  useWithdrawConfirmPurchase: () => ({ mutate: io.mutate, isPending: false }),
  useApprovePurchase: () => ({ mutate: io.mutate, isPending: false }),
  useRejectPurchase: () => ({ mutate: io.mutate, isPending: false }),
  useCancelPurchase: () => ({ mutate: io.mutate, isPending: false }),
  useClosePurchase: () => ({ submit: io.submit, isPending: false, blocked: false }),
  usePurchaseDetail: () => ({ data: undefined }),
}))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useUserOptions', () => ({ useUserOptions: () => ({ options: [] }), userOptionLabel: () => '' }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null, SupplierFinder: () => null }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: () => null }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })

test.each([
  { status: 2, action: '撤回确认', title: '撤回确认' },
  { status: 5, action: '审批通过', title: '审批通过' },
  { status: 5, action: '驳回', title: '驳回采购单 PO-SYNTHETIC42' },
  { status: 2, action: '结束剩余采购', title: '结束剩余采购' },
  { status: 1, action: '取消', title: '取消采购单' },
])('$action 从真实行菜单交接后弹窗可访问，取消后回原行并能打开查询', async ({ status, action, title }) => {
  io.status = status
  await act(async () => root.render(<MemoryRouter initialEntries={['/purchase?range=all']}><PurchasePage /></MemoryRouter>)); await settle()
  const user = userEvent.setup()
  await act(async () => user.click(getByRole(host, 'button', { name: '更多操作' }))); await settle()
  const source = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
  await act(async () => user.click(getByRole(document.body, 'menuitem', { name: action }))); await settle()
  const dialog = getByRole(document.body, 'dialog', { name: title })
  expect(document.querySelector('[role="menu"][data-state="open"]')).toBeNull()
  expect(dialog.getAttribute('aria-hidden')).not.toBe('true')
  expect(dialog.contains(document.activeElement)).toBe(true)
  await act(async () => user.click(getByRole(dialog, 'button', { name: '取消' }))); await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.style.pointerEvents).not.toBe('none')
  expect(document.activeElement).toBe(source)
  await act(async () => user.click(getByRole(host, 'button', { name: '查询' }))); await settle()
  expect(getByRole(document.body, 'dialog', { name: '查询采购单' })).toBeTruthy()
  expect(io.mutate).not.toHaveBeenCalled(); expect(io.submit).not.toHaveBeenCalled()
})
