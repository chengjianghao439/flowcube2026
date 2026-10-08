// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DatePicker } from './DatePicker'
import { AppDialog } from './AppDialog'
// Keep the real Popover/FocusScope; the calendar date rules are outside this
// keyboard-return test and a single focusable day avoids layout-only jsdom work.
vi.mock('@/components/ui/calendar', () => ({ Calendar: () => <button type="button">合成日历日</button> }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function until(predicate: () => boolean) {
  // FloatingUI has ongoing layout work in jsdom; wait for this concrete
  // dismissal/focus result, rather than draining every asynchronous task.
  for (let attempt = 0; attempt < 25 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 0))
  expect(predicate()).toBe(true)
}
test('两个日期字段在隐式和显式标签下保持各自可访问名称', () => {
  act(() => root.render(<><label>创建日期（起）<DatePicker value="2026-10-02" onChange={vi.fn()} /></label><label htmlFor="end-date">创建日期（止）</label><DatePicker id="end-date" value="2026-10-08" onChange={vi.fn()} /></>))
  const [start, end] = host.querySelectorAll('input')
  expect(start.labels?.item(0)?.textContent).toBe('创建日期（起）')
  expect(end.labels?.item(0)?.textContent).toBe('创建日期（止）')
  expect(start.value).toBe('2026-10-02'); expect(end.value).toBe('2026-10-08')
})
test('Escape关闭日历后返回该日期输入，不再次展开或提交日期', async () => {
  const change = vi.fn()
  act(() => root.render(<DatePicker id="return-date" value="2026-10-08" onChange={change} />))
  const input = host.querySelector('input')!
  act(() => input.focus())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  change.mockClear()
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await until(() => !document.querySelector('[role="dialog"]') && document.activeElement === input)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(input)
  expect(change).not.toHaveBeenCalled()
})
test('嵌套查询窗中 Escape 只退出日历，第二次才关闭查询窗', async () => {
  const change = vi.fn()
  function Fixture() {
    const [open, setOpen] = useState(true)
    return <AppDialog open={open} onOpenChange={setOpen} dialogId="date-nested-fixture" title="查询条件">
      <input aria-label="单号" />
      <label htmlFor="nested-date">创建日期</label>
      <DatePicker id="nested-date" value="2026-10-08" onChange={change} />
    </AppDialog>
  }
  act(() => root.render(<Fixture />))
  const input = document.getElementById('nested-date')!
  act(() => input.focus())
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
  change.mockClear()
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await until(() => document.querySelectorAll('[role="dialog"]').length === 1)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('查询条件')
  expect(document.activeElement).toBe(input)
  expect(change).not.toHaveBeenCalled()
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await until(() => !document.querySelector('[role="dialog"]'))
})
