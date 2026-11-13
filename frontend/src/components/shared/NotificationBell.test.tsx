// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { NotificationEntry } from '@/lib/notifications'
import NotificationBell from './NotificationBell'

const state = vi.hoisted(() => ({ items: [] as NotificationEntry[], permissions: null as Set<string> | null }))
vi.mock('@/api/notifications', () => ({ getNotificationsApi: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { items: state.items } }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (permission: string | readonly string[]) => state.permissions === null || (typeof permission === 'string' ? state.permissions.has(permission) : permission.some(code => state.permissions?.has(code))) }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
afterEach(() => { act(() => { root.render(null) }); state.items = []; state.permissions = null; vi.useRealTimers() })

describe('通知中心键盘退出', () => {
  it('Escape 关闭通知并将焦点还给入口', () => {
    // Radix 延迟恢复焦点；显式推进计时器，避免 jsdom 浮层布局的异步调度干扰。
    vi.useFakeTimers()
    act(() => { root.render(<MemoryRouter><NotificationBell /></MemoryRouter>) })
    const trigger = container.querySelector('button')!
    act(() => { trigger.click() })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('暂无待处理事项')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    act(() => { vi.runOnlyPendingTimers() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

it.each([false, true])('应收及应付通知随目标权限显示，计数只含可访问事项（%s）', allowPayment => {
  state.permissions = new Set([PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.INBOUND_ORDER_VIEW, ...(allowPayment ? [PERMISSIONS.PAYMENT_VIEW] : [])])
  state.items = [
    { path: '/payments/payable', category: 'finance', type: 'danger', icon: '', text: '2 笔应付账款已逾期' },
    { path: '/payments/receivable', category: 'finance', type: 'danger', icon: '', text: '3 笔应收账款未结清' },
    { path: '/settings/barcode-print-query?category=inbound', type: 'warning', icon: '', text: '打印失败' },
    { path: '/inbound-tasks/21?focus=waiting-putaway', type: 'warning', icon: '', text: '收货上架超时' },
  ]
  act(() => root.render(<MemoryRouter><NotificationBell /></MemoryRouter>))
  const trigger = container.querySelector('button')!
  expect(trigger.getAttribute('aria-label')).toBe(`通知中心，${allowPayment ? 3 : 1} 条待处理`)
  act(() => trigger.click())
  const content = document.querySelector('[role="dialog"]')!.textContent
  expect(content).toContain('收货上架超时')
  expect(content).not.toContain('打印失败')
  expect(content?.includes('应付账款已逾期')).toBe(allowPayment)
  expect(content?.includes('应收账款未结清')).toBe(allowPayment)
})
