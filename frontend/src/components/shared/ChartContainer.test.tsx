// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { ChartContainer } from './ChartContainer'

// 这里只验证隐藏/激活的挂载契约；实际图表尺寸和键盘操作由浏览器验收。
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-chart-mounted>{children}</div> }))

test('隐藏页不挂载图表，切回后重新挂载且保留调用方的数据', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = (active: boolean) => act(async () => root.render(
    <SectionVisibilityContext.Provider value={active}><ChartContainer height={260}><p>原始金额 ¥1,234.56</p></ChartContainer></SectionVisibilityContext.Provider>,
  ))
  try {
    await render(true)
    expect(host.querySelector('[data-chart-mounted]')).not.toBeNull()
    await render(false)
    expect(host.querySelector('[data-chart-mounted]')).toBeNull()
    await render(true)
    expect(host.textContent).toBe('原始金额 ¥1,234.56')
  } finally {
    await act(async () => root.unmount()); host.remove()
  }
})
