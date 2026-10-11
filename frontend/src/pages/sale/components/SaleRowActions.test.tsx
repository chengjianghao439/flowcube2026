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
