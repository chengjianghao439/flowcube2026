// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { SaleRowActions } from './SaleRowActions'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { SaleOrder } from '@/types/sale'
vi.mock('@/components/shared/TableActionsMenu', () => ({ default: (p: { primaryLabel: string; onPrimaryClick: () => void; items: { label: string; onClick: () => void }[] }) => <div><button onClick={p.onPrimaryClick}>{p.primaryLabel}</button>{p.items.map(i => <button key={i.label} onClick={i.onClick}>{i.label}</button>)}</div> }))
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
