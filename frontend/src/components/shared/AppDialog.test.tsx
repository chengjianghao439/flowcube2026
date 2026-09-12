// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { AppDialog } from './AppDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const originalViewport = { width: window.innerWidth, height: window.innerHeight }
function viewport(width: number, height: number) {
  Object.assign(window, { innerWidth: width, innerHeight: height })
  window.dispatchEvent(new Event('resize'))
}
afterEach(() => { localStorage.clear(); viewport(originalViewport.width, originalViewport.height) })

test.each([true, false])('大尺寸弹窗首次打开及缩小窗口后，关闭/确认区域保留在视口内（可调整=%s）', resizable => {
  viewport(1005, 734)
  localStorage.setItem('flowcube-dialog-size-viewport-test', JSON.stringify({ width: 1800, height: 1000 }))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const assertContained = () => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const { width, height, left, top } = dialog.style
    expect(parseFloat(width)).toBeLessThanOrEqual(window.innerWidth * .95)
    expect(parseFloat(height)).toBeLessThanOrEqual(window.innerHeight * .9)
    expect(parseFloat(left) + parseFloat(width)).toBeLessThanOrEqual(window.innerWidth)
    expect(parseFloat(top) + parseFloat(height)).toBeLessThanOrEqual(window.innerHeight)
    expect(dialog.textContent).toContain('确认选择')
  }
  try {
    act(() => root.render(<AppDialog open onOpenChange={() => {}} dialogId="viewport-test" title="选择商品" defaultWidth={1200} defaultHeight={730} minWidth={960} minHeight={560} resizable={resizable} footer={<button>确认选择</button>}>商品列表</AppDialog>))
    assertContained()
    act(() => viewport(800, 600))
    assertContained()
  } finally { act(() => root.unmount()); host.remove() }
})

test('恢复的大尺寸被视口限制后，拖动从实际宽高开始，并保持右下边界可达', () => {
  viewport(1005, 734)
  localStorage.setItem('flowcube-dialog-size-drag-test', JSON.stringify({ width: 1800, height: 1000 }))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<AppDialog open onOpenChange={() => {}} dialogId="drag-test" title="选择商品">商品列表</AppDialog>))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    dialog.getBoundingClientRect = () => ({ x: 25, y: 37, left: 25, top: 37, width: 954, height: 660, right: 979, bottom: 697, toJSON: () => ({}) })
    const handle = dialog.querySelector<HTMLElement>('.cursor-se-resize')!
    act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 975, clientY: 693 })))
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 875, clientY: 643 })))
    expect(dialog.style.width).toBe('854px')
    expect(dialog.style.height).toBe('610px')
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2000, clientY: 2000 })))
    expect(parseFloat(dialog.style.left) + parseFloat(dialog.style.width)).toBeLessThanOrEqual(1005)
    expect(parseFloat(dialog.style.top) + parseFloat(dialog.style.height)).toBeLessThanOrEqual(734)
    act(() => document.dispatchEvent(new MouseEvent('mouseup')))
    expect(JSON.parse(localStorage.getItem('flowcube-dialog-size-drag-test')!).width).toBe(954)
  } finally { act(() => root.unmount()); host.remove() }
})
