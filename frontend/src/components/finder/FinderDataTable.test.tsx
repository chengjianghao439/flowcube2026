// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { FinderDataTable } from './FinderDataTable'
const data = Array.from({ length: 600 }, (_, index) => ({ id: index + 1, name: `合成客户 ${index + 1}` }))
let host: HTMLDivElement, root: Root
const selected = vi.fn(), confirmed = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); host.dataset.tableScroll = ''; document.body.append(host)
  Object.defineProperties(host, { clientHeight: { value: 480 }, offsetHeight: { value: 480 }, offsetWidth: { value: 800 }, scrollHeight: { value: 28800 } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this === host ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 800, top: this === host ? 0 : -host.scrollTop, left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  root = createRoot(host); selected.mockReset(); confirmed.mockReset()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function draw(row: typeof data[number] | null = null, pending = false) {
  act(() => root.render(<FinderDataTable columns={[{key: 'name', title: '客户名称'}]} data={data} selected={row} isLoading={pending} getRowKey={row => row.id} onSelect={selected} onConfirm={confirmed} />))
}
test('600 customer results mount bounded rows and can select the final record after scrolling', () => {
  draw()
  expect(host.querySelectorAll('[data-finder-key]').length).toBeLessThan(40)
  expect(host.textContent).not.toContain('合成客户 600')
  act(() => { host.scrollTop = 28320; host.dispatchEvent(new Event('scroll')) })
  const last = host.querySelector<HTMLElement>('[data-finder-key="600"]')!
  expect(last).not.toBeNull()
  act(() => last.click()); expect(selected).toHaveBeenCalledWith(data[599])
  draw(data[599])
  act(() => { host.scrollTop = 0; host.dispatchEvent(new Event('scroll')) })
  expect(host.querySelector('[aria-selected=true]')).toBeNull()
  act(() => { host.scrollTop = 28320; host.dispatchEvent(new Event('scroll')) })
  expect(host.querySelector('[aria-selected=true]')?.textContent).toBe('合成客户 600')
  expect(host.querySelector('table')?.getAttribute('aria-rowcount')).toBe('601')
})
test('Space selects and Enter confirms the current row', () => {
  draw()
  const first = host.querySelector<HTMLElement>('[data-finder-key="1"]')!
  act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
  expect(selected).toHaveBeenCalledWith(data[0]); expect(confirmed).not.toHaveBeenCalled()
  act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(confirmed).toHaveBeenCalledWith(data[0])
})
