// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NotificationBell from './NotificationBell'

vi.mock('@/api/notifications', () => ({ getNotificationsApi: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { items: [] } }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)
afterEach(() => { act(() => { root.render(null) }); vi.useRealTimers() })

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
