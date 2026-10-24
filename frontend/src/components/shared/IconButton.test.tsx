// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { findByRole, queryByRole } from '@testing-library/dom'
import { Plus } from 'lucide-react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { IconButton } from './IconButton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

test('图标按钮具有明确名称、默认不提交表单，保留ref和一次点击', async () => {
  const click = vi.fn(), submit = vi.fn(), ref = createRef<HTMLButtonElement>()
  act(() => root.render(<form onSubmit={event => { event.preventDefault(); submit() }}><IconButton ref={ref} icon={Plus} label="增大待办卡片宽度" onClick={click} /></form>))
  const button = queryByRole(host, 'button', { name: '增大待办卡片宽度' }) as HTMLButtonElement
  expect(button).toBe(ref.current)
  expect(button.type).toBe('button')
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  await act(async () => button.click())
  expect(click).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled()
})

test('键盘焦点显示说明，Escape关闭说明并保留按钮焦点', async () => {
  act(() => root.render(<IconButton icon={Plus} label="增大卡片宽度" />))
  const button = host.querySelector('button')!
  await act(async () => button.focus())
  expect(await findByRole(document.body, 'tooltip', { name: '增大卡片宽度' })).toBeTruthy()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(queryByRole(document.body, 'tooltip')).toBeNull()
  expect(document.activeElement).toBe(button)
})

test('页面隐藏关闭说明，恢复页面不重开；禁用按钮不触发动作', async () => {
  const click = vi.fn()
  const render = async (active: boolean, disabled = false) => {
    await act(async () => root.render(<SectionVisibilityContext.Provider value={active}><IconButton icon={Plus} label="增大卡片宽度" disabled={disabled} onClick={click} /></SectionVisibilityContext.Provider>))
  }
  await render(true)
  await act(async () => host.querySelector('button')!.focus())
  expect(await findByRole(document.body, 'tooltip')).toBeTruthy()
  await render(false)
  expect(queryByRole(document.body, 'tooltip')).toBeNull()
  await render(true)
  expect(queryByRole(document.body, 'tooltip')).toBeNull()
  await render(true, true)
  await act(async () => host.querySelector('button')!.click())
  expect(click).not.toHaveBeenCalled()
})

test('组合通知浮层时保留角标、触发器属性、一次打开及Escape回焦', async () => {
  act(() => root.render(<Popover><PopoverTrigger asChild><IconButton icon={Plus} label="通知中心，2条待处理" badge={<span>2</span>} /></PopoverTrigger><PopoverContent>通知正文</PopoverContent></Popover>))
  const button = queryByRole(host, 'button', { name: '通知中心，2条待处理' }) as HTMLButtonElement
  expect(button.textContent).toBe('2')
  expect(button.getAttribute('aria-haspopup')).toBe('dialog')
  await act(async () => button.click())
  expect((await findByRole(document.body, 'dialog')).textContent).toContain('通知正文')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(queryByRole(document.body, 'dialog')).toBeNull()
  await act(async () => { await vi.waitFor(() => expect(document.activeElement).toBe(button)) })
})
