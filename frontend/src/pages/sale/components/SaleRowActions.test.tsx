// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { SaleRowActions } from './SaleRowActions'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { SaleOrder } from '@/types/sale'
import SaleCancelDialog from './SaleCancelDialog'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
test.each([
  { hasUndispatchedItems: false, hasUnreservedItems: true, label: '补占' },
  { hasUndispatchedItems: true, hasUnreservedItems: true, label: '继续发货' },
  { hasUndispatchedItems: false, hasUnreservedItems: false, label: '查看' },
])('执行中列表按原未占/未派差额显示$label并进入原详情', input => {
  useAuthStore.setState({ user: { roleId: 5, permissions: [PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_RESERVE, PERMISSIONS.SALE_ORDER_SHIP] } as never })
  const host = document.createElement('div'), root = createRoot(host), detail = vi.fn(), view = vi.fn(), reserve = vi.fn()
  document.body.append(host)
  try {
    const row: SaleOrder = { id: 5, orderNo: '合成原单', status: 3, statusName: '拣货中', customerId: 1, customerName: '合成客户', warehouseId: 1, warehouseName: '合成仓', totalAmount: 200, operatorId: 1, operatorName: '合成职员', createdAt: '2026-10-13', hasUndispatchedItems: input.hasUndispatchedItems, hasUnreservedItems: input.hasUnreservedItems }
    act(() => root.render(<SaleRowActions row={row} anyPending={false} onAsk={vi.fn()} onReserveSale={reserve} onCancelSale={vi.fn()} onDeleteSale={vi.fn()} onViewTask={view} onDetail={detail} onEdit={vi.fn()} onPrint={vi.fn()} />))
    const button = host.querySelector('button')!
    expect(button.textContent).toBe(input.label)
    act(() => button.click())
    expect(input.label === '查看' ? view : detail).toHaveBeenCalledOnce()
    expect(reserve).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()); host.remove(); useAuthStore.setState({ user: null }) }
})
test.each([1, 2, 3, 6, 5])('view-only actor has no write action for sale status %s', status => {
  useAuthStore.setState({ user: { roleId: 2, permissions: [PERMISSIONS.SALE_ORDER_VIEW] } as never })
  const host = document.createElement('div'), root = createRoot(host), view = vi.fn(), reserve = vi.fn()
  document.body.append(host)
  try {
    act(() => root.render(<SaleRowActions row={{ id: 5, status, hasUndispatchedItems: true } as SaleOrder} anyPending={false} onAsk={vi.fn()} onReserveSale={reserve} onCancelSale={vi.fn()} onDeleteSale={vi.fn()} onViewTask={view} onDetail={view} onEdit={vi.fn()} onPrint={vi.fn()} />))
    expect(host.textContent).not.toMatch(/占库|补占|编辑订单|修改订单|取消订单|删除订单|继续发货/)
    act(() => host.querySelector('button')!.click())
    expect(view).toHaveBeenCalledTimes(1)
    expect(reserve).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()); host.remove(); useAuthStore.setState({ user: null }) }
})

test.each([1, 2, 3, 6])('销售状态%s的真实菜单清理后才打开取消原因，返回原按钮可继续点击', async status => {
  useAuthStore.setState({ user: { roleId: 2, permissions: [PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_CANCEL] } as never })
  const host = document.createElement('div'), root = createRoot(host), opened = vi.fn(), detail = vi.fn(), confirmed = vi.fn()
  document.body.append(host)
  function Harness() {
    const [open, setOpen] = useState(false)
    return <>
      <SaleRowActions row={{ id: 5, status } as SaleOrder} anyPending={false} onAsk={vi.fn()} onReserveSale={vi.fn()}
        onCancelSale={() => {
          opened(document.querySelector('[role="menu"]'), document.activeElement)
          setOpen(true)
        }} onDeleteSale={vi.fn()} onViewTask={detail} onDetail={detail} onEdit={vi.fn()} onPrint={vi.fn()} />
      <SaleCancelDialog open={open} description="沿原订单处理取消" reason="" onReasonChange={vi.fn()}
        onCancel={() => setOpen(false)} onConfirm={confirmed} />
    </>
  }
  async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')
  try {
    await act(async () => root.render(<Harness />))
    const original = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
    await act(async () => { original.focus(); original.click() }); await settle()
    const cancel = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '取消订单')!
    expect(cancel).toBeTruthy()
    await act(async () => cancel.click()); await settle()
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
    expect(opened).toHaveBeenCalledWith(null, trigger)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(dialog()).not.toBeNull()
    expect(dialog()!.getAttribute('aria-hidden')).not.toBe('true')
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    await act(async () => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '返回订单')!.click()); await settle()
    expect(dialog()).toBeNull()
    expect(document.body.style.pointerEvents).not.toBe('none')
    expect(document.activeElement).toBe(trigger)
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(detail).toHaveBeenCalledOnce()
    expect(confirmed).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove(); useAuthStore.setState({ user: null }) }
})

test.each([1,6])('普通列表状态%s的原未决请求转入详情核对，禁新占库和写菜单', async status => {
  const previous=useAuthStore.getState()
  useAuthStore.getState().login('synthetic',null,{id:9,username:'synthetic',realName:'合成人员',roleId:1,roleName:'合成'})
  const {captureInboundEditOwner}=await import('@/hooks/useInboundTaskEditRecovery')
  const owner=captureInboundEditOwner(), query={version:1,userId:9,baseURL:owner.baseURL,saleId:5,kind:'reserve',action:'sale.reserve:5',path:'/sale/5/reserve',method:'post',requestKey:'synthetic-row-pending',createdAt:Date.now(),bodyHash:'a'.repeat(64)}
  const key='flowcube-ordinary-sale-v1:request:'+encodeURIComponent(JSON.stringify([9,owner.baseURL,5,query.requestKey]))
  localStorage.setItem(key,JSON.stringify(query))
  const host=document.createElement('div'),root=createRoot(host),detail=vi.fn(),reserve=vi.fn()
  document.body.append(host)
  try {
    await act(async()=>root.render(<SaleRowActions row={{id:5,status} as SaleOrder} anyPending={false} onAsk={vi.fn()} onReserveSale={reserve} onCancelSale={vi.fn()} onDeleteSale={vi.fn()} onViewTask={vi.fn()} onDetail={detail} onEdit={vi.fn()} onPrint={vi.fn()}/>))
    const primary=host.querySelector<HTMLButtonElement>('button')!
    expect(primary.textContent).toBe('核对原操作');expect(primary.disabled).toBe(false)
    await act(async()=>primary.click());expect(detail).toHaveBeenCalledOnce();expect(reserve).not.toHaveBeenCalled()
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!.click())
    await act(async()=>new Promise(resolve=>setTimeout(resolve,10)))
    const writes=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(item=>['取消订单','编辑订单','修改订单','核对占库','核对发货'].includes(item.textContent||''))
    expect(writes.length).toBeGreaterThan(0);expect(writes.every(item=>item.getAttribute('aria-disabled')==='true')).toBe(true)
  } finally { await act(async()=>root.unmount());host.remove();localStorage.removeItem(key);useAuthStore.setState(previous) }
})
