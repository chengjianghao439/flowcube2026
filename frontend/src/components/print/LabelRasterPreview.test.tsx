// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import LabelRasterPreview from './LabelRasterPreview'
const mocks = vi.hoisted(() => ({ render: vi.fn(), active: true, generation: 1 }))
vi.mock('@/api/print-templates', () => ({ renderLabelPreviewApi: mocks.render }))
vi.mock('@/components/layout/SectionVisibilityContext', () => ({ useSectionActive: () => mocks.active }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (f: (s: unknown) => unknown) => f({ sessionGeneration: mocks.generation, isAuthenticated: true }) }))
let root: Root, host: HTMLDivElement
const props = { elements: [], canvasWidthMm: 75, canvasHeightMm: 50, dpi: 203 as const, data: { name: '中文' }, paperSize: 'thermal75' as const, scale: 5 }
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.active = true; mocks.generation = 1; mocks.render.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
async function draw(p = {}) { await act(async () => { root.render(<LabelRasterPreview {...props} {...p} />) }) }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(250) }) }
test('uses server pixels and zoom does not request another render', async () => {
  mocks.render.mockResolvedValue({ imageDataUrl: 'data:image/png;base64,AAA' })
  await draw(); await tick(); expect(host.querySelector('img')?.src).toContain('AAA')
  await draw({ scale: 3, data: { ...props.data } }); await tick(); expect(mocks.render).toHaveBeenCalledTimes(1)
})
test('discard stale response and stale image immediately after layout changes', async () => {
  let done!: (r: unknown) => void
  mocks.render.mockReturnValueOnce(new Promise(r => { done = r })).mockResolvedValue({ imageDataUrl: 'data:image/png;base64,NEW' })
  await draw(); await tick(); await draw({ dpi: 300 })
  expect(host.querySelector('img')).toBeNull()
  await act(async () => { done({ imageDataUrl: 'data:image/png;base64,OLD' }) }); expect(host.querySelector('img')).toBeNull()
  await tick(); expect(host.querySelector('img')?.src).toContain('NEW')
  expect(mocks.render.mock.calls[0][1].aborted).toBe(true)
})
test('errors are visible and hidden pages cancel pending rendering', async () => {
  mocks.render.mockRejectedValue(new Error('条码宽度不足'))
  await draw(); await tick(); expect(host.textContent).toContain('条码宽度不足')
  mocks.active = false; await draw({ dpi: 300 }); await tick()
  expect(mocks.render).toHaveBeenCalledTimes(1); expect(host.querySelector('img')).toBeNull()
})
test('account change cannot keep the previous account image', async () => {
  mocks.render.mockResolvedValue({ imageDataUrl: 'data:image/png;base64,AAA' }); await draw(); await tick()
  mocks.generation = 2; mocks.render.mockReturnValue(new Promise(() => {})); await draw()
  expect(host.querySelector('img')).toBeNull()
})
