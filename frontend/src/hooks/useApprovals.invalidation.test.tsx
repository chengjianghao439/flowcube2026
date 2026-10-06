// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useConfirmPurchase, useWithdrawConfirmPurchase, useCancelPurchase } from './usePurchase'
import { useDisposalMutation } from './useDisposal'
import ExpensesPage from '@/pages/finance/expenses'
import PriceChangePage from '@/pages/price-change'
import RequisitionFormPage from '@/pages/purchase-requisitions/form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { GlobalConfirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { useSubmitCreditOverride, useCancelCreditOverride, useApproveCreditOverride, useRejectCreditOverride } from './useCreditOverrides'
vi.mock('@/lib/pdaRuntime', () => ({ syncPdaLabelPrinterBinding: vi.fn(async () => null) }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/lib/apiOrigin', () => ({ applyErpApiBaseFromStorage: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/shared/TableActionsMenu', () => ({ default: ({ items }: { items: Array<{ label: string; onClick: () => void }> }) => <div>{items.map(item => <button key={item.label} onClick={item.onClick}>{item.label}</button>)}</div> }))
const originalAdapter = api.defaults.adapter
let qc: QueryClient, root: Root, host: HTMLDivElement, fail: boolean | 'unknown', requisitionStatus: number
const keys = ['approval-pending', 'dash-pending-approvals']
function resetQueues() { for (const key of keys) qc.setQueryData([key, 'owner'], { list: [], pagination: { total: 1 } }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fail = false; requisitionStatus = 2
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('离线边界，禁止真实服务器探测') }))
  useAuthStore.setState({ user: { id: 7, username: 'fixture', realName: '测试', roleId: 1, roleName: '测试' } })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); resetQueues(); qc.setQueryData(['products'], { id: 11 }); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.defaults.adapter = async config => {
    if (fail === 'unknown' && config.method === 'post') throw new AxiosError('response lost', 'ERR_NETWORK', config)
    if (fail && config.method === 'post') throw new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, { config, status: 409, statusText: 'Conflict', headers: {}, data: { success: false, message: '拒绝' } })
    const data = config.url === '/finance/expense-claims' ? { list: [{ id: 11, claimNo: 'EXP11', title: '费用', applicantName: '员工', status: 2, totalAmount: 2 }], pagination: { page: 1, pageSize: 200, total: 1 }, summary: {} }
      : config.url === '/price-change' ? { list: [{ id: 11, requestNo: 'PRICE11', productName: '商品', status: 1, newPrice: 2, priceType: 'sale' }], pagination: { page: 1, pageSize: 200, total: 1 } }
      : config.url === '/purchase-requisitions/11' && config.method === 'get' ? { id: 11, requisitionNo: 'PR11', title: '请购', status: requisitionStatus, statusName: '待审', statusTone: 'warning', warehouseId: 1, warehouseName: '测试仓', items: [] }
      : config.method === 'get' ? [] : config.url?.endsWith('/approve') ? { id: 11, finished: false } : null
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
  }
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); api.defaults.adapter = originalAdapter; vi.unstubAllGlobals() })
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 35)) }) }
function render(child: React.ReactNode) { act(() => root.render(<QueryClientProvider client={qc}><MemoryRouter>{child}<GlobalConfirmDialog /></MemoryRouter></QueryClientProvider>)) }
function invalidated(value: boolean) { for (const key of keys) expect(qc.getQueryState([key, 'owner'])?.isInvalidated).toBe(value) }
function PurchaseActions() {
  const confirm = useConfirmPurchase(), withdraw = useWithdrawConfirmPurchase(), cancel = useCancelPurchase()
  return <>{[['confirm', confirm], ['withdraw', withdraw], ['cancel', cancel]].map(([name, mutation]) => <button key={String(name)} onClick={() => { if (typeof mutation !== 'string') mutation.mutate(11) }}>{String(name)}</button>)}</>
}
function DisposalActions() { const mutations = useDisposalMutation(); return <>{(['submit', 'approve', 'cancel'] as const).map(name => <button key={name} onClick={() => mutations[name].mutate(11)}>{name}</button>)}</> }
test.each([['采购', PurchaseActions, ['confirm', 'withdraw', 'cancel']], ['处置', DisposalActions, ['submit', 'approve', 'cancel']]] as const)('%s原成功回调失效统一待办两key，原拒绝不误刷新', async (_name, Actions, labels) => {
  render(<Actions />)
  for (const label of labels) {
    resetQueues(); fail = true; act(() => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click()); await flush(); invalidated(false)
    fail = false; act(() => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click()); await flush(); invalidated(true)
  }
})
test('报销真实页面原批准回调成功才刷新统一待办，错误仍保留原页', async () => {
  render(<ExpensesPage />); await flush(); await flush()
  const approve = [...host.querySelectorAll('button')].find(b => b.textContent === '批准')!
  expect(approve).toBeDefined()
  fail = true; act(() => approve.click()); await flush(); invalidated(false)
  fail = false; act(() => approve.click()); await flush(); invalidated(true)
})

function CreditActions() {
  const submit = useSubmitCreditOverride(), cancel = useCancelCreditOverride(), approve = useApproveCreditOverride(), reject = useRejectCreditOverride()
  return <><button onClick={() => submit.mutate(11)}>submit</button><button onClick={() => cancel.mutate(11)}>cancel</button><button onClick={() => approve.mutate(11)}>approve</button><button onClick={() => reject.mutate({ id: 11, reason: '测试原因' })}>reject</button></>
}
function button(label: string, area: ParentNode = host) {
  const found = [...area.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)
  expect(found, `按钮${label}`).toBeDefined(); return found!
}
async function click(label: string, area: ParentNode = host) { act(() => button(label, area).click()); await flush() }
async function expectSuccessOnly(trigger: () => Promise<void>, oldKey?: string) {
  for (const outcome of [true, 'unknown', false] as const) {
    resetQueues(); if (oldKey) qc.setQueryData([oldKey, 'unobserved'], {})
    fail = outcome; await trigger(); await flush(); invalidated(outcome === false)
    if (oldKey) expect(qc.getQueryState([oldKey, 'unobserved'])?.isInvalidated).toBe(outcome === false)
  }
}
test.each(['submit', 'cancel', 'approve', 'reject'])('授信真实%s成功刷新原key和两待办key，拒绝/未知不刷新', async action => {
  render(<CreditActions />)
  await expectSuccessOnly(() => click(action), 'credit-overrides')
})
test.each(['提交', '通过', '驳回', '取消'])('改价真实页面%s成功刷新待办，步骤未完成也刷新且保留原key', async action => {
  render(<PriceChangePage />); await flush(); await flush()
  await expectSuccessOnly(async () => {
    if (action === '驳回') { if (!document.querySelector('[role="dialog"]')) await click(action); await click('确认驳回', document) }
    else if (action === '取消') { if (!document.querySelector('[role="dialog"]')) await click(action); await click('取消申请', document) }
    else await click(action)
  }, 'price-change')
  expect(qc.getQueryState(['products'])?.isInvalidated).toBe(false)
})
test.each(['提交审批', '撤回', '批准', '驳回', '取消'])('请购真实页面%s成功刷新统一待办，拒绝/未知仍不刷新', async action => {
  requisitionStatus = action === '提交审批' ? 1 : 2
  render(<TabPathContext.Provider value="/purchase-requisitions/11"><RequisitionFormPage /></TabPathContext.Provider>); await flush(); await flush()
  await expectSuccessOnly(async () => {
    if (action === '驳回') {
      await click(action)
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="驳回原因"]')!
      act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '保留原原因'); input.dispatchEvent(new Event('input', { bubbles: true })) }); await flush()
      await click('确认驳回', document)
    } else if (action === '取消') { await click(action); await click('确认执行', document) }
    else await click(action)
  })
})
