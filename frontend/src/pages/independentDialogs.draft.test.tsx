// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import CustomerFormDialog from './customers/components/CustomerFormDialog'
import UserFormDialog from './users/components/UserFormDialog'
import InvoicesPage from './accounting/invoices'
import ApprovalFlowsPage from './approvals/flows'
import PdaDevicesPage from './settings/pda-devices'
import FinanceTransactionsPage from './finance/transactions'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
const f = vi.hoisted(() => ({ customer: vi.fn(), user: vi.fn(), invoice: vi.fn(), flow: vi.fn(), selector: null as null | ((next: { settlementType: 1 | 2; paymentTermsDays: number }) => void) }))
vi.mock('@/components/shared/SettlementTypeField', () => ({ SettlementTypeField: ({ onChange, paymentTermsDays }: { onChange: typeof f.selector; paymentTermsDays: number }) => { f.selector = onChange; return <output data-testid="terms">{paymentTermsDays}</output> } }))
vi.mock('@/hooks/useCustomers', () => ({ useCreateCustomer: () => ({ mutateAsync: f.customer, isPending: false }), useUpdateCustomer: () => ({ mutateAsync: f.customer, isPending: false }) }))
vi.mock('@/hooks/useUsers', () => ({ useCreateUser: () => ({ mutate: f.user, isPending: false }), useUpdateUser: () => ({ mutate: f.user, isPending: false }), useAssignableRoles: () => ({ data: [{ id: 2, code: 'staff', name: '员工' }], isLoading: false, isError: false }), useUsers: () => ({ data: { list: [{ id: 1, realName: '验收用户' }] } }) }))
vi.mock('@/hooks/useDepartments', () => ({ useDepartmentOptions: () => ({ data: [], isError: false }), useDepartments: () => ({ data: [] }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ roleId: 1, can: () => true }) }))
vi.mock('@/hooks/useInvoices', () => ({ useInvoices: () => ({ data: { list: [], pagination: { total: 0 } } }), useCreateInvoice: () => ({ mutate: f.invoice, isPending: false }), useUpdateInvoice: () => ({ mutate: f.invoice, isPending: false }), useChangeInvoiceStatus: () => ({ mutate: vi.fn() }), useDeleteInvoice: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useApprovals', () => ({ useApprovalFlows: () => ({ data: [] }), useCreateApprovalFlow: () => ({ mutate: f.flow, isPending: false }), useUpdateApprovalFlow: () => ({ mutate: f.flow, isPending: false }), useDeleteApprovalFlow: () => ({ mutate: vi.fn() }) }))
vi.mock('@/api/settings', () => ({ getRolesApi: async () => [{ id: 2, code: 'staff', name: '员工' }] }))
vi.mock('@/api/pda-devices', async original => ({ ...await original<typeof import('@/api/pda-devices')>(), listPdaDevicesApi: async () => ({ list: [{ id: 1, deviceName: '验收设备', deviceCode: 'TEST', warehouseId: 1, status: 'active' }], pagination: { total: 1 } }) }))
vi.mock('@/api/warehouses', async original => ({ ...await original<typeof import('@/api/warehouses')>(), getWarehousesActiveApi: async () => [{ id: 1, name: '验收仓' }] }))
vi.mock('@/api/finance', async original => ({ ...await original<typeof import('@/api/finance')>(), getAccountTransactionsApi: async () => ({ list: [], pagination: { total: 0 }, summary: {} }), getActiveAccountsApi: async () => [] }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const customer = { id: 7, code: 'TEST7', name: '验收客户', isActive: true, createdAt: '', settlementType: 2 as const, settlementTypeName: '月结', paymentTermsDays: 30, creditLimit: null }
const user = { id: 7, username: 'test7', realName: '验收用户', roleId: 2, roleName: '员工', isActive: true, createdAt: '', departmentId: null, departmentName: null, allowSelfApprove: false }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, cache: QueryClient
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); f.customer.mockReset().mockResolvedValue({}); f.user.mockReset(); f.invoice.mockReset(); f.flow.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) })
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove() })
async function mount(node: React.ReactNode, active = true) { await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><SectionVisibilityContext.Provider value={active}>{node}</SectionVisibilityContext.Provider></MemoryRouter></QueryClientProvider>)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const input = (id: string) => document.getElementById(id) as HTMLInputElement
async function type(el: HTMLInputElement, value: string) { await act(async () => { el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function click(text: string) { await act(async () => button(text).click()) }
async function escape() { await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))) }
const forms = [{ name: '客户', field: 'customer-remark', render: (open: boolean, close: () => void) => <CustomerFormDialog open={open} onClose={close} customer={customer} /> }, { name: '用户', field: 'form-realName', render: (open: boolean, close: () => void) => <UserFormDialog open={open} onClose={close} editUser={user} /> }]
test.each(forms.flatMap(form => ['取消', 'Escape', '关闭'].map(action => ({ ...form, action }))))('$name 草稿 $action 关闭须确认；继续编辑保留输入并回焦', async form => {
 const close = vi.fn(); await mount(form.render(true, close)); const field = input(form.field); await type(field, '未保存输入')
 if (form.action === 'Escape') await escape(); else if (form.action === '取消') await click('取消'); else await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.getAttribute('aria-label') === '关闭' || b.textContent === '关闭')!.click())
 expect(close).not.toHaveBeenCalled(); expect(button('继续编辑')).toBeTruthy(); await click('继续编辑'); expect(field.value).toBe('未保存输入'); await vi.waitFor(() => expect(document.activeElement).toBe(field)); await click('取消'); await click('放弃修改'); expect(close).toHaveBeenCalledOnce()
})
test('客户同 id 服务端对象刷新不能抹掉当前草稿', async () => { const close = vi.fn(); await mount(<CustomerFormDialog open onClose={close} customer={customer} />); await type(input('customer-remark'), '草稿'); await mount(<CustomerFormDialog open onClose={close} customer={{ ...customer, name: '刷新名称' }} />); expect(input('customer-remark').value).toBe('草稿') })
test('客户提交中禁止关闭/重复提交；关闭重开后迟到成功不能关闭新草稿', async () => {
 let done!: (v: object) => void; f.customer.mockImplementation(() => new Promise(resolve => { done = resolve })); const close = vi.fn(); await mount(<CustomerFormDialog open onClose={close} customer={customer} />); await type(input('customer-remark'), '旧草稿'); await click('保存修改'); await escape(); expect(close).not.toHaveBeenCalled(); expect(input('customer-remark').matches(':disabled')).toBe(true)
 await mount(<CustomerFormDialog open={false} onClose={close} customer={customer} />); await mount(<CustomerFormDialog open onClose={close} customer={customer} />); await type(input('customer-remark'), '新草稿'); await act(async () => done({})); expect(close).not.toHaveBeenCalled(); expect(input('customer-remark').value).toBe('新草稿')
})
test('用户提交中锁住 selector；隐藏后迟到成功/失败不能关闭或污染草稿', async () => {
 const close = vi.fn(); await mount(<UserFormDialog open onClose={close} editUser={user} />); await type(input('form-realName'), '提交草稿'); await click('保存修改'); expect(input('form-realName').disabled).toBe(true); expect(document.getElementById('form-department')?.getAttribute('disabled')).not.toBeNull(); await escape(); expect(close).not.toHaveBeenCalled(); const callbacks = f.user.mock.calls[0][1]; await mount(<UserFormDialog open onClose={close} editUser={user} />, false); await mount(<UserFormDialog open onClose={close} editUser={user} />, true); await act(async () => { callbacks.onError(new Error('旧错误')); callbacks.onSuccess() }); expect(close).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('旧错误'); expect(input('form-realName').value).toBe('提交草稿')
})
const labelCases = [
 { name: '资金流水查询', Component: FinanceTransactionsPage, action: '查询', labels: ['资金账户', '关键字', '业务类型', '收支方向', '发生日期（起）', '发生日期（止）'] },
 { name: '录入发票', Component: InvoicesPage, action: '录入进项发票', labels: ['发票代码', '发票号码 *', '供应商 *', '对方纳税人识别号', '价税合计 *', '税率', '开票日期 *', '关联单号（选填）', '备注'] },
 { name: '审批流新增', Component: ApprovalFlowsPage, action: '新增审批流', labels: ['业务类型', '流程名称', '适用金额下限（含）', '适用金额上限（含，留空=不限）', '第 1 级审批人类型', '第 1 级角色'] },
 { name: '设备登记', Component: PdaDevicesPage, action: '登记新设备', labels: ['设备名称', '所属仓库'] },
 { name: '设备编辑', Component: PdaDevicesPage, action: '编辑', labels: ['设备名称', '所属仓库'] },
]
test.each(labelCases)('$name 字段标签关联实际控件', async sample => { await mount(<sample.Component />); await click(sample.action); for (const text of sample.labels) { const label = [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === text); expect(label, text).toBeTruthy(); expect(label!.htmlFor, text).not.toBe(''); expect(document.getElementById(label!.htmlFor)?.matches('input,select,button,textarea'), text).toBe(true) } })
test.each([{ name: '发票', Component: InvoicesPage, action: '录入进项发票' }, { name: '审批流', Component: ApprovalFlowsPage, action: '新增审批流' }])('$name 输入后 Escape 保留草稿，放弃才关闭', async sample => { await mount(<sample.Component />); await click(sample.action); const field = document.querySelector('[role="dialog"] input') as HTMLInputElement; await type(field, '未保存草稿'); await escape(); expect(button('继续编辑')).toBeTruthy(); await click('继续编辑'); expect(field.value).toBe('未保存草稿'); await click('取消'); await click('放弃修改'); expect(document.querySelector('[role="dialog"]')).toBeNull() })

test('客户程序 selector 回填也触发未保存保护', async () => {
  const close = vi.fn(); await mount(<CustomerFormDialog open onClose={close} customer={customer} />)
  await act(async () => f.selector!({ settlementType: 2, paymentTermsDays: 60 })); await escape()
  expect(close).not.toHaveBeenCalled(); expect(button('继续编辑')).toBeTruthy(); await click('继续编辑')
  expect(document.querySelector('[data-testid="terms"]')?.textContent).toBe('60')
})
test('提交之前捕获的 selector 回填不能修改提交中的客户草稿', async () => {
  f.customer.mockImplementation(() => new Promise(() => {})); await mount(<CustomerFormDialog open onClose={() => {}} customer={customer} />)
  const fill = f.selector!; await click('保存修改'); await act(async () => fill({ settlementType: 2, paymentTermsDays: 90 }))
  expect(document.querySelector('[data-testid="terms"]')?.textContent).toBe('30')
  expect(f.customer).toHaveBeenCalledOnce()
})

test('发票日期手输尚未 blur 的文本也不能被 Escape 静默丢弃', async () => {
  await mount(<InvoicesPage />); await click('录入进项发票')
  const date = document.querySelector<HTMLInputElement>('input[id$="-invoiceDate"]')!
  // 不打开日历：只断言输入事件尚未 blur 时外层关闭保护，日历焦点/Escape 由共享专项覆盖。
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, '2031-01-02'); date.dispatchEvent(new Event('input', { bubbles: true })) }); await escape()
  expect(button('继续编辑')).toBeTruthy()
  expect(date.value).toBe('2031-01-02')
})
