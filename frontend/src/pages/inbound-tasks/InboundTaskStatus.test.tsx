// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { InboundTask } from '@/types/inbound-tasks'
import { InboundTaskStatus } from './InboundTaskStatus'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.() })
async function setup(key: string, flags: InboundTask['exceptionFlags']) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const view = vi.fn()
  await act(async () => root.render(<InboundTaskStatus task={{ status: 2, receiptStatus: { key, label: '当前主状态' }, exceptionFlags: flags } as InboundTask} onView={view} />))
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  return { host, view }
}
test.each(['receiving', 'putaway_in_progress'])('正常%s保持单行主状态，无异常图标/说明', async key => {
  const { host } = await setup(key, { failedPrintJobs: 0, timeoutPrintJobs: 0, overduePutawayContainers: 0, hasException: false })
  expect(host.textContent).toBe('当前主状态'); expect(host.querySelector('button')).toBeNull()
})
test.each([
  [1, 0, 0, '打印失败 1 项'], [0, 2, 0, '打印超时 2 项'], [0, 0, 3, '上架逾期 3 条库存条码'],
  [1, 2, 3, '打印失败 1 项；打印超时 2 项；上架逾期 3 条库存条码'],
])('异常计数%s/%s/%s区分原因，保留详情入口', async (failedPrintJobs, timeoutPrintJobs, overduePutawayContainers, label) => {
  const { host, view } = await setup('receiving', { failedPrintJobs: Number(failedPrintJobs), timeoutPrintJobs: Number(timeoutPrintJobs), overduePutawayContainers: Number(overduePutawayContainers), hasException: true })
  const button = host.querySelector('button')!
  expect(host.textContent).toBe('当前主状态'); expect(button.getAttribute('aria-label')).toBe(`${label}；查看详情`)
  expect(button.title).toBe(`${label}；查看详情`); expect(button.className).toContain('text-warning-ink')
  button.focus(); expect(document.activeElement).toBe(button)
  await act(async () => button.click()); expect(view).toHaveBeenCalledOnce()
})
