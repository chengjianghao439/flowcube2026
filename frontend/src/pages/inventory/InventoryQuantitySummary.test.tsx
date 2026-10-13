// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { InventoryQuantitySummary } from './InventoryQuantitySummary'

test('大量单位按需展开已有虚拟表格，挂载有界且最后单位可达，不产生可见分页', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(192)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(192)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]')
    const height = this.tagName === 'TR' ? 48 : this.hasAttribute('data-workspace-scroll') ? 192 : 0
    return { height, width: 500, top: this === scroll ? 0 : -(scroll?.scrollTop ?? 0), left: 0, bottom: height, right: 500, x: 0, y: 0, toJSON() {} }
  })
  const groups = Array.from({ length: 5000 }, (_, index) => ({ unit: `基本单位${String(index + 1).padStart(4, '0')}`, onHand: 1, reserved: 0, available: 1 }))
  try {
    await act(async () => root.render(<InventoryQuantitySummary summary={{ state: 'ready', groups }} field="onHand" label="在库数量" />))
    expect(host.querySelector('table')).toBeNull(); expect(host.textContent).toContain('查看 5000 种单位')
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
    expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(40)
    expect(host.textContent).toContain('基本单位0001')
    await act(async () => { scroll.scrollTop = 5000 * 48 - 192; scroll.dispatchEvent(new Event('scroll')) })
    expect(host.textContent).toContain('基本单位5000'); expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(40)
    expect(host.textContent).not.toMatch(/上一页|下一页|第.*页/)
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); expect(host.querySelector('table')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
