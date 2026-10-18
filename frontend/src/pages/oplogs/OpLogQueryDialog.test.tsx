// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import OpLogQueryDialog, { type OpLogQueryValues } from './OpLogQueryDialog'

const applied: OpLogQueryValues = {
  keyword: '已应用关键字', module: '', startDate: '2026-10-08', endDate: '2026-10-15',
}
const defaults = { startDate: '2026-10-09', endDate: '2026-10-15' }
let host: HTMLDivElement, root: Root
const close = vi.fn(), apply = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  localStorage.clear()
  close.mockReset(); apply.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals()
})
async function draw(open = true, initial = { ...applied }) {
  await act(async () => root.render(<OpLogQueryDialog open={open} initial={initial} resetValues={defaults} onClose={close} onApply={apply} />))
}
const keyword = () => document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="请输入关键字…"]')!
const dates = () => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[placeholder="yyyy-mm-dd"]')]
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(el => el.textContent?.trim() === label)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}

test('查询打开期间父页用相同已应用条件重渲染，保留未应用关键字', async () => {
  await draw(); await type(keyword(), '未应用草稿')
  expect(keyword().value).toBe('未应用草稿')
  await draw(true, { ...applied })
  expect(keyword().value).toBe('未应用草稿')
  expect(apply).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})
test('打开期间保留输入，关闭后重开加载最新已应用条件', async () => {
  await draw(); await type(keyword(), '当前草稿')
  const latest = { ...applied, keyword: '新已应用值', startDate: '2026-10-10' }
  await draw(true, latest)
  expect(keyword().value).toBe('当前草稿')
  await draw(false, latest); await draw(true, { ...latest })
  expect(keyword().value).toBe('新已应用值')
  expect(dates().map(input => input.value)).toEqual(['2026-10-10', applied.endDate])
})
test('重置只改变弹窗草稿，点击查询才提交页面默认窗口', async () => {
  await draw(); await type(keyword(), '待重置草稿'); await click('重置')
  expect(keyword().value).toBe('')
  expect(dates().map(input => input.value)).toEqual([defaults.startDate, defaults.endDate])
  expect(apply).not.toHaveBeenCalled()
  await click('查询')
  expect(apply).toHaveBeenCalledExactlyOnceWith({ keyword: '', module: '', ...defaults })
})
test('取消不应用未提交条件，关闭重开恢复原已应用值', async () => {
  await draw(); await type(keyword(), '取消的草稿'); await click('取消')
  expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled()
  await draw(false); await draw(true)
  expect(keyword().value).toBe(applied.keyword)
})
test('关键字回车应用当前草稿，不自行关闭弹窗', async () => {
  await draw(); await type(keyword(), '回车草稿')
  await act(async () => keyword().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(apply).toHaveBeenCalledExactlyOnceWith({ ...applied, keyword: '回车草稿' })
  expect(close).not.toHaveBeenCalled()
})
