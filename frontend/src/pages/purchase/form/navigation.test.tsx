// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import type { PurchaseOrder } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

const state = vi.hoisted(() => ({ order: undefined as PurchaseOrder | undefined, error: null as unknown, allowed: null as Set<string> | null, refetch: vi.fn(), write: vi.fn() }))
vi.mock('@/hooks/usePurchase', () => ({
  usePurchaseDetail: () => ({ data: state.order, isLoading: false, isError: !!state.error, error: state.error, refetch: state.refetch }),
  ...Object.fromEntries(['useCreatePurchase', 'useUpdatePurchase', 'useConfirmPurchase', 'useWithdrawConfirmPurchase', 'useApprovePurchase', 'useRejectPurchase', 'useCancelPurchase'].map(k => [k, () => ({ mutate: state.write, mutateAsync: state.write, isPending: false })])),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => state.allowed == null || state.allowed.has(code) }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/api/products', () => ({ getProductApi: async () => ({ units: [] }) }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <button>选择仓库</button> }))
vi.mock('@/components/finder', () => ({
  SupplierFinder: () => null,
  ProductFinder: ({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (p: ProductFinderResult) => void }) => open ? <div role="dialog"><button onClick={onClose}>取消选品</button><button onClick={() => { onConfirm({ id: 11, code: 'P11', name: '标准商品', unit: '个', costPrice: 2.55 } as ProductFinderResult); onClose() }}>选择标准商品</button></div> : null,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { useWorkspaceStore.setState({tabs:[HOME_TAB],activeKey:HOME_TAB.key});useDirtyGuardStore.setState({dirtyTabs:{},pendingConfirm:null}); state.order = undefined; state.error = null; state.allowed = null; vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null }); expect(state.write).not.toHaveBeenCalled(); vi.unstubAllGlobals() })
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!
const click = async (text: string) => act(async () => button(text).click())
const numbers = () => host.querySelectorAll<HTMLInputElement>('input[data-entry-input]')
const order = (): PurchaseOrder => ({ id: 12, orderNo: 'PO12', status: 1, statusName: '草稿', supplierId: 1, supplierName: '供应商', warehouseId: 1, warehouseName: '仓库', totalAmount: 2.55, operatorId: 1, operatorName: '经办人', createdAt: '2026-10-09', items: [{ id: 1, productId: 11, productCode: 'P11', productName: '标准商品', unit: '个', quantity: 1, unitPrice: 2.55, amount: 2.55 }] })


const saved='/purchase?endDate=2026-10-08&keyword=PO&startDate=2026-10-08&status=1&warehouseId=10'
function Location(){const location=useLocation();return <output data-location>{location.pathname+location.search}</output>}
const render = async(path:string)=>{useWorkspaceStore.getState().syncFromLocation(saved,'采购订单');useWorkspaceStore.getState().syncFromLocation(path,'详情');await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><Location/><TabPathContext.Provider value={path}><Page/></TabPathContext.Provider></MemoryRouter>))}
const current=()=>host.querySelector('[data-location]')!.textContent

test('实际采购详情返回列表保留日期和所有筛选',async()=>{state.order=order();await render('/purchase/12');await click('返回采购列表');expect(current()).toBe(saved)})
test('实际新建取消脏草稿：取消离开保留输入、确认离开恢复列表筛选',async()=>{
 await render('/purchase/new');await click('添加商品');await click('选择标准商品');await click('取消');expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
 await act(async()=>useDirtyGuardStore.getState().resolveConfirm(false));expect(numbers()[0].value).toBe('1');expect(current()).toBe('/purchase/new')
 await click('取消');await act(async()=>useDirtyGuardStore.getState().resolveConfirm(true));expect(current()).toBe(saved)
})
