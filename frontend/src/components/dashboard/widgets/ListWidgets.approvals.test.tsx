// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { ListPendingApprovals } from './ListWidgets'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
const state = vi.hoisted(() => ({ bizType: 'purchase_requisition' }))
vi.mock('@/hooks/useDashboard', () => ({ usePendingApprovalsBrief: () => ({ data: { list: [{ instanceId: 1, taskId: 1, bizType: state.bizType, bizId: 91, no: '待批原单', amount: 3, currentStep: 1 }], pagination: { total: 1 } } }) }))
let host: HTMLDivElement, root: Root
function Path() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useAuthStore.setState({ user: { id: 1, username: 'test', realName: '测试', roleId: 1, roleName: '测试' } }); useWorkspaceStore.setState({ tabs: [] }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
function render() { act(() => root.render(<MemoryRouter initialEntries={['/dashboard']}><ListPendingApprovals /><Path /></MemoryRouter>)) }
test.each([
  ['purchase_requisition', '/purchase-requisitions/91'], ['purchase_order', '/purchase/91'],
  ['sale_credit_override', '/credit-overrides?detailId=91'], ['product_price', '/price-change?detailId=91'],
  ['inventory_disposal', '/disposals?detailId=91'], ['expense_claim', '/finance/expenses?detailId=91'],
])('首页审批摘要准确进入%s原单', (bizType, path) => { state.bizType = bizType; render(); act(() => host.querySelector('button')!.click()); expect(host.querySelector('output')?.textContent).toBe(path) })
test.each(['unknown', '__proto__'])('未知业务%s不猜测原单路径', bizType => { state.bizType = bizType; render(); expect(host.querySelector('button')?.disabled).toBe(true); expect(host.textContent).toContain('暂不支持此单据类型') })
test('首页复用原业务标签仍保留已有查询', () => {
  state.bizType = 'expense_claim'; useWorkspaceStore.getState().addTab({ key: '/finance/expenses', title: '费用报销', path: '/finance/expenses?keyword=原查询' })
  render(); act(() => host.querySelector('button')!.click())
  const path = host.querySelector('output')!.textContent!
  expect(new URLSearchParams(path.split('?')[1]).get('keyword')).toBe('原查询')
  expect(new URLSearchParams(path.split('?')[1]).get('detailId')).toBe('91')
})
