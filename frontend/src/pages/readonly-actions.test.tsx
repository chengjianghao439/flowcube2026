// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, getByRole, queryByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import apiClient from '@/api/client'
import * as apiConfig from '@/config/api'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { User } from '@/types'
import ReturnsPage from './returns'
import InventoryPage from './inventory'
import ProductsPage from './products'
import ProductFormPage from './products/form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import CategoriesPage from './categories'
import PriceChangePage from './price-change'
import ExpensesPage from './finance/expenses'
import PaymentsView from './payments/PaymentsView'
import PrintTemplatesPage from './settings/print-templates'
import PrintersPage from './settings/printers'
import CarriersPage from './carriers'
import { ReceiptPanel, type ReceiptPanelHandle } from '@/components/shared/ReceiptPanel'
import { StatementPanel, type StatementPanelHandle } from '@/components/shared/StatementPanel'

// Exercise real pages, menus, permissions, stores, hooks, and dialogs. Only the
// transport is synthetic, so no local database or external write is involved.
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

const product = { id: 3, code: 'SYN-P3', name: '合成商品', unit: '件', isActive: true, units: [], categoryId: 4, categoryName: '合成分类', supplierId: 5, supplierName: '合成供应商', spec: '合成型号', color: '黑', costPrice: 1, revision: 1 }
const category = { id: 4, name: '合成分类', level: 1, status: 1, sortOrder: 0, parentId: null, children: [] }
const payment = { id: 6, type: 2, orderNo: 'SYN-SO6', partyName: '合成客户', totalAmount: 10, paidAmount: 0, balance: 10, status: 1, statusName: '未收', confirmStatus: 1 }
const receipt = { id: 7, type: 2, receiptNo: 'SYN-R7', partyName: '合成客户', amount: 10, settledAmount: 0, balance: 10, status: 1, statusName: '待核销' }
const statement = { id: 8, type: 2, statementNo: 'SYN-ST8', partyName: '合成客户', totalAmount: 10, settledAmount: 0, balance: 10, status: 1, statusName: '草稿' }
const printer = { id: 9, code: 'SYN-PR9', name: '合成打印机', type: 1, status: 1, clientId: 'synthetic-client', clientAliasName: '合成设备' }
const carrier = { id: 10, code: 'SYN-CA10', name: '合成承运商', type: 'express', platformCode: 'sf', isActive: true }
const template = { id: 11, name: '合成打印模板', type: 1, isDefault: false }
const expense = { id: 12, claimNo: 'SYN-E12', title: '合成报销', totalAmount: 10, status: 1, statusName: '草稿', applicantName: '合成人员', items: [] }
const returnOrder = { id: 15, returnNo: 'SYN-RT15', status: 1, statusName: '草稿', totalAmount: 10, supplierName: '合成供应商', customerName: '合成客户', warehouseName: '合成仓库', createdAt: '2026-10-21 10:00:00' }
const list = (rows: unknown[] = []) => ({ list: rows, pagination: { page: 1, pageSize: 200, total: rows.length } })
let host: HTMLDivElement, root: Root, query: QueryClient
const originalAdapter = apiClient.defaults.adapter
const writes: string[] = []
const readPermissions = [P.RETURN_ORDER_VIEW, P.INVENTORY_VIEW, P.PRODUCT_VIEW, P.CATEGORY_VIEW, P.FINANCE_EXPENSE_VIEW, P.PAYMENT_VIEW, P.PRINT_TEMPLATE_VIEW, P.PRINT_PRINTER_VIEW, P.CARRIER_VIEW]

function authorize(extra: string[] = []) {
  useAuthStore.getState().login('synthetic-only', null, { id: 999, roleId: 5, permissions: [...readPermissions, ...extra] } as User)
}
function dataFor(path: string) {
  if (path === '/categories/tree') return [category]
  if (path === '/products') return list([product])
  if (path === '/products/3') return product
  if (path === '/carriers') return list([carrier])
  if (path === '/print-templates') return [template]
  if (path === '/printers') return [printer]
  if (path === '/printers/registration-warehouses') return [{ id: 31, name: '合成仓库' }]
  if (path === '/printer-bindings') return {}
  if (path === '/payments') return list([payment])
  if (path === '/payments/receipts') return list([receipt])
  if (path === '/payments/statements') return list([statement])
  if (path === '/payments/statements/candidates') return [{ ...payment, id: 6 }]
  if (path === '/finance/expense-claims') return list([expense])
  if (path === '/finance/expense-claims/12') return expense
  if (path === '/finance/expense-categories') return [{ id: 20, name: '合成类别', isActive: true }]
  if (path === '/inventory/overview') return list()
  if (path === '/returns/purchase' || path === '/returns/sale') return list([returnOrder])
  if (path === '/inventory/logs' || path === '/price-change') return list()
  if (path === '/finance/accounts/active') return [{ id: 21, name: '合成账户', balance: 100 }]
  return []
}
async function draw(node: ReactNode, path = '/') {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
async function click(name: string, scope: HTMLElement = document.body) {
  await act(async () => { await userEvent.click(getByRole(scope, 'button', { name })) })
}
async function menu() {
  await act(async () => { await userEvent.click(getByRole(host, 'button', { name: '更多操作' })) })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); writes.length = 0; authorize()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  apiClient.defaults.adapter = async config => {
    const path = new URL(config.url!, 'http://synthetic.invalid').pathname.replace(/^\/api/, '')
    if (config.method !== 'get') writes.push(`${config.method} ${path}`)
    return { data: { success: true, data: dataFor(path) }, status: 200, statusText: 'OK', headers: {}, config }
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = originalAdapter; useAuthStore.getState().logout(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

test.each(['purchase', 'sale'])('只读 %s 退货保留查询并隐藏新建', async type => {
  await draw(<ReturnsPage />, `/returns/${type}`)
  expect(queryByRole(host, 'button', { name: /新建.*退货单/ })).toBeNull()
  expect(getByRole(host, 'button', { name: '查询' })).toBeTruthy()
  await act(async () => authorize([P.RETURN_ORDER_CREATE]))
  expect(getByRole(host, 'button', { name: /新建.*退货单/ })).toBeTruthy()
})

test.each(['purchase', 'sale'])('%s 退货行确认和取消分别授权', async type => {
  await draw(<ReturnsPage />, `/returns/${type}`)
  await menu()
  expect(queryByRole(document.body, 'menuitem', { name: '确认' })).toBeNull()
  expect(queryByRole(document.body, 'menuitem', { name: '取消' })).toBeNull()
  expect(getByRole(document.body, 'menuitem', { name: '打印' })).toBeTruthy()
  await act(async () => { await userEvent.keyboard('{Escape}'); authorize([P.RETURN_ORDER_CONFIRM]) })
  await menu()
  expect(getByRole(document.body, 'menuitem', { name: '确认' })).toBeTruthy()
  expect(queryByRole(document.body, 'menuitem', { name: '取消' })).toBeNull()
  await act(async () => { await userEvent.keyboard('{Escape}'); authorize([P.RETURN_ORDER_CANCEL]) })
  await menu()
  expect(queryByRole(document.body, 'menuitem', { name: '确认' })).toBeNull()
  expect(getByRole(document.body, 'menuitem', { name: '取消' })).toBeTruthy()
})

test.each(['purchase', 'sale'])('%s 退货取消弹窗打开后撤权不能写入', async type => {
  authorize([P.RETURN_ORDER_CANCEL])
  await draw(<ReturnsPage />, `/returns/${type}`)
  await menu()
  await act(async () => { await userEvent.click(getByRole(document.body, 'menuitem', { name: '取消' })) })
  await act(async () => authorize())
  await click('确认取消', getByRole(document.body, 'dialog', { name: '取消退货单' }))
  expect(writes).toEqual([])
})

test('只读库存隐藏导入和出库；盘点导航独立要求查看权限', async () => {
  await draw(<InventoryPage />, '/inventory')
  expect(queryByRole(host, 'button', { name: '导入库存' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '出库' })).toBeNull()
  expect(queryByRole(host, 'link', { name: /盘点/ })).toBeNull()
  await act(async () => authorize([P.INVENTORY_ADJUST, P.STOCKCHECK_VIEW]))
  expect(queryByRole(host, 'button', { name: '导入库存' })).toBeNull()
  expect(getByRole(host, 'button', { name: '出库' })).toBeTruthy()
  expect(getByRole(host, 'link', { name: '查看盘点' })).toBeTruthy()
  await act(async () => authorize([P.IMPORT_STOCK_EXECUTE]))
  expect(getByRole(host, 'button', { name: '导入库存' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '出库' })).toBeNull()
})

test('商品编辑与申请改价只由商品更新权限授予', async () => {
  await draw(<ProductsPage />, '/products')
  expect(queryByRole(host, 'button', { name: '编辑' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '更多操作' })).toBeNull()
  await act(async () => authorize([P.PRODUCT_UPDATE]))
  expect(getByRole(host, 'button', { name: '编辑' })).toBeTruthy()
  await menu()
  expect(getByRole(document.body, 'menuitem', { name: '申请改价' })).toBeTruthy()
  expect(queryByRole(document.body, 'menuitem', { name: '删除' })).toBeNull()
  expect(queryByRole(document.body, 'menuitem', { name: '打印标签' })).toBeNull()
})

test('商品详情只有查看权限时隐藏保存，撤权后保留资料查看', async () => {
  await draw(<TabPathContext.Provider value="/products/3"><ProductFormPage /></TabPathContext.Provider>, '/products/3')
  expect(host.querySelector<HTMLInputElement>('input[value="合成商品"]')).toBeTruthy()
  expect(queryByRole(host, 'button', { name: /保存/ })).toBeNull()
  await act(async () => authorize([P.PRODUCT_UPDATE]))
  expect(getByRole(host, 'button', { name: /保存/ })).toBeTruthy()
  await act(async () => authorize())
  expect(queryByRole(host, 'button', { name: /保存/ })).toBeNull()
  expect(writes).toEqual([])
})

test('分类创建、更新、删除分别授权，查看仍显示树', async () => {
  await draw(<CategoriesPage />, '/categories')
  expect(host.textContent).toContain(category.name)
  for (const name of ['新增一级分类', '新增子分类', '编辑', '停用', '删除']) expect(queryByRole(host, 'button', { name })).toBeNull()
  await act(async () => authorize([P.CATEGORY_CREATE]))
  expect(getByRole(host, 'button', { name: '新增一级分类' })).toBeTruthy()
  expect(getByRole(host, 'button', { name: '新增子分类' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '编辑' })).toBeNull()
  await act(async () => authorize([P.CATEGORY_UPDATE, P.CATEGORY_DELETE]))
  for (const name of ['编辑', '停用', '删除']) expect(getByRole(host, 'button', { name })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '新增一级分类' })).toBeNull()
})

test('分类表单已打开后撤权，原生提交不能发送写请求', async () => {
  authorize([P.CATEGORY_UPDATE]); await draw(<CategoriesPage />, '/categories'); await click('编辑')
  const form = document.querySelector('form')!
  await act(async () => authorize())
  await act(async () => fireEvent.submit(form))
  expect(writes).toEqual([])
})

test('只读改价页不能申请，商品更新权可申请', async () => {
  await draw(<PriceChangePage />, '/price-change?productId=3')
  expect(queryByRole(host, 'button', { name: /申请改价/ })).toBeNull()
  expect(queryByRole(document.body, 'dialog', { name: '申请改价' })).toBeNull()
  await act(async () => authorize([P.PRODUCT_UPDATE]))
  expect(getByRole(document.body, 'dialog', { name: '申请改价' })).toBeTruthy()
})

test('报销新建和草稿编辑分别要求创建与更新权限', async () => {
  await draw(<ExpensesPage />, '/finance/expenses')
  expect(queryByRole(host, 'button', { name: '新建报销单' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '更多操作' })).toBeNull()
  expect(getByRole(host, 'button', { name: '明细' })).toBeTruthy()
  await act(async () => authorize([P.FINANCE_EXPENSE_UPDATE]))
  await menu()
  expect(getByRole(document.body, 'menuitem', { name: '编辑' })).toBeTruthy()
  expect(queryByRole(document.body, 'menuitem', { name: '提交审批' })).toBeNull()
  await act(async () => { await userEvent.keyboard('{Escape}') })
  await act(async () => authorize([P.FINANCE_EXPENSE_CREATE]))
  expect(getByRole(host, 'button', { name: '新建报销单' })).toBeTruthy()
})

test.each([1, 2] as const)('只读往来 type=%s 保留流水和核销列表，隐藏登记', async type => {
  await draw(<PaymentsView type={type} />, '/payments')
  expect(queryByRole(host, 'button', { name: /^登记[收付]款$/ })).toBeNull()
  expect(getByRole(host, 'button', { name: '流水' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: type === 1 ? '付款核销' : '收款核销' })).toBeNull()
  expect(getByRole(host, 'button', { name: '账款明细' })).toBeTruthy()
  await click(type === 1 ? '付款流水' : '收款流水')
  expect(queryByRole(host, 'button', { name: /^登记[收付]款$/ })).toBeNull()
  expect(queryByRole(host, 'button', { name: '继续核销' })).toBeNull()
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(getByRole(host, 'button', { name: '明细' })).toBeTruthy()
  })
  await act(async () => authorize([P.PAYMENT_EXECUTE]))
  expect(getByRole(host, 'button', { name: type === 1 ? '付款核销' : '收款核销' })).toBeTruthy()
  expect(getByRole(host, 'button', { name: /^登记[收付]款$/ })).toBeTruthy()
})

test('核销共享面板的 imperative 登记遵守当前权限，撤权不能重开', async () => {
  const ref = createRef<ReceiptPanelHandle>()
  await draw(<ReceiptPanel ref={ref} type={2} settlementTypes="1" />)
  await act(async () => ref.current!.openRegister())
  expect(queryByRole(document.body, 'dialog')).toBeNull()
  await act(async () => authorize([P.PAYMENT_EXECUTE]))
  await act(async () => ref.current!.openRegister())
  expect(queryByRole(document.body, 'dialog')).toBeTruthy()
  const staleOpen = ref.current!.openRegister
  await act(async () => authorize())
  expect(queryByRole(document.body, 'button', { name: /确认登记/ })).toBeNull()
  await click('取消')
  await act(async () => staleOpen())
  expect(queryByRole(document.body, 'dialog')).toBeNull()
  expect(writes).toEqual([])
})

test('对账共享面板只读可查看，创建和确认使用独立权限且句柄不能绕过', async () => {
  const ref = createRef<StatementPanelHandle>()
  await draw(<StatementPanel ref={ref} type={2} />)
  expect(queryByRole(host, 'button', { name: '新建对账单' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '确认' })).toBeNull()
  await act(async () => ref.current!.openCreate())
  expect(queryByRole(document.body, 'dialog')).toBeNull()
  await act(async () => authorize([P.PAYMENT_CONFIRM]))
  expect(getByRole(host, 'button', { name: '确认' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '新建对账单' })).toBeNull()
  await act(async () => authorize([P.PAYMENT_EXECUTE]))
  const staleOpen = ref.current!.openCreate
  await act(async () => authorize())
  await act(async () => staleOpen())
  expect(queryByRole(document.body, 'dialog')).toBeNull()
})

test('打印模板只读隐藏新建编辑删除，管理权限可编辑', async () => {
  await draw(<PrintTemplatesPage />, '/settings/print-templates')
  expect(host.textContent).toContain(template.name)
  expect(queryByRole(host, 'button', { name: /新建模板/ })).toBeNull()
  expect(queryByRole(host, 'button', { name: '编辑' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '更多操作' })).toBeNull()
  expect(getByRole(host, 'button', { name: '查看' })).toBeTruthy()
  await act(async () => authorize([P.PRINT_TEMPLATE_MANAGE]))
  expect(getByRole(host, 'button', { name: /新建模板/ })).toBeTruthy()
  expect(getByRole(host, 'button', { name: '编辑' })).toBeTruthy()
})

test('承运商只读查看账号链接明确标成查看', async () => {
  await draw(<CarriersPage />, '/carriers')
  expect(queryByRole(host, 'button', { name: /绑定快递账号|管理月结账号/ })).toBeNull()
  expect(getByRole(host, 'button', { name: '查看月结账号' })).toBeTruthy()
  await act(async () => authorize([P.CARRIER_UPDATE]))
  expect(getByRole(host, 'button', { name: '管理月结账号' })).toBeTruthy()
})

test('打印机查看不授予别名保存、状态切换或用途绑定', async () => {
  await draw(<PrintersPage />, '/settings/printers')
  expect(host.textContent).toContain(printer.name)
  expect(queryByRole(host, 'button', { name: '保存' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '在线' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '绑定用途' })).toBeNull()
  await act(async () => authorize([P.PRINT_PRINTER_MANAGE]))
  expect(getByRole(host, 'button', { name: '保存' })).toBeTruthy()
  expect(getByRole(host, 'button', { name: '绑定用途' })).toBeTruthy()
  await act(async () => authorize())
  expect(queryByRole(host, 'button', { name: '保存' })).toBeNull()
  expect(writes).toEqual([])
})

test('打印机关联本机等待设备读取期间撤权，不发送更新请求', async () => {
  let release!: (value: string) => void
  vi.spyOn(apiConfig, 'getEffectiveApiOrigin').mockReturnValue('https://synthetic.invalid')
  vi.stubGlobal('flowcubeDesktop', {
    getPrintClientCredential: () => new Promise<string>(resolve => { release = resolve }),
    getClientInfo: async () => ({ clientId: 'synthetic-client', hostname: '合成设备' }),
    getSystemPrinters: async () => [{ name: printer.name }],
  })
  authorize([P.PRINT_PRINTER_MANAGE]); await draw(<PrintersPage />, '/settings/printers')
  await click('关联本机'); expect(release).toBeTypeOf('function')
  await act(async () => authorize())
  await act(async () => { release('synthetic-only'); await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(writes).toEqual([])
})
