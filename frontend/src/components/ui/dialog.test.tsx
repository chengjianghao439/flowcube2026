// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { Dialog, DialogContent } from './dialog'
import { Popover, PopoverAnchor, PopoverContent } from './popover'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mounted: { root: ReturnType<typeof createRoot>, host: HTMLElement }[] = []
// Dialog 内容经 Portal 挂到 document.body，必须 unmount 而不是只移除挂载点
afterEach(() => {
  mounted.splice(0).forEach(({ root, host }) => { act(() => root.unmount()); host.remove() })
})

function mount(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(node))
  mounted.push({ root, host })
  return root
}

/**
 * DialogContent 一旦用 translate 居中，Dialog 就成了 fixed 后代的包含块，
 * 弹窗内的 Popover/日期日历会改以弹窗为定位原点并被 overflow-y-auto 裁掉（月份表头消失）。
 * 这里锁住"居中不用 transform"这条约定。
 */
test('DialogContent 居中不使用 transform', () => {
  mount(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>查询条件</DialogContent>
    </Dialog>,
  )
  const content = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(content.className).not.toMatch(/translate-[xy]-/)
  expect(content.className).toContain('inset-0')
  expect(content.className).toContain('m-auto')
  expect(content.className).toContain('h-fit')
  expect(content.className).toContain('max-h-[calc(100dvh-2rem)]')
  expect(content.className).toContain('overflow-y-auto')
})

/**
 * 日期日历不能 Portal 到 document.body：那样外层 Dialog 的 FocusScope 会把焦点抢回弹窗，
 * 浮层立刻被判为焦点移出并关闭（日历一闪就没）。浮层必须仍是 Trigger 的真实子孙。
 */
test('弹窗内浮层留在弹窗 DOM 内，不 Portal 到 body', () => {
  mount(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <Popover open>
          <PopoverAnchor asChild><span>锚点</span></PopoverAnchor>
          <PopoverContent>浮层内容</PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>,
  )
  const popover = document.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]')
  expect(popover).not.toBeNull()
  const content = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(content.contains(popover!)).toBe(true)
  expect(popover!.parentElement).not.toBe(document.body)
})
