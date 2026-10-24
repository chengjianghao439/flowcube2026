// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { installLandingMotion } from './motion'

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
function setup(reduced = false) {
  const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
  const media = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  let intersect: IntersectionObserverCallback = () => {}
  const observe = vi.fn(), disconnect = vi.fn(), unobserve = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { intersect = cb }
    observe = observe; disconnect = disconnect; unobserve = unobserve
  })
  document.body.innerHTML = '<main><div class="stat">可见内容</div><div class="stat">下一项</div></main>'
  const root = document.querySelector('main')!
  root.querySelectorAll<HTMLElement>('.stat').forEach(el => { el.animate = animate as unknown as typeof el.animate })
  return { root, animate, cancel, media, observe, disconnect, unobserve, enter: () => intersect([{ isIntersecting: true, target: root.firstElementChild! }] as IntersectionObserverEntry[], {} as IntersectionObserver) }
}
test('animates on viewport entry once, without hiding default content', () => {
  const v = setup(); const stop = installLandingMotion(v.root)
  expect(v.observe).toHaveBeenCalledTimes(2)
  expect(v.root.firstElementChild!.getAttribute('style')).toBeNull()
  v.enter(); v.enter()
  expect(v.animate).toHaveBeenCalledTimes(1)
  expect(v.animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 700, fill: 'backwards' }))
  stop(); expect(v.disconnect).toHaveBeenCalled(); expect(v.cancel).toHaveBeenCalled()
})
test('reduced motion keeps content visible and does not create animations', () => {
  const v = setup(true); const stop = installLandingMotion(v.root)
  v.enter(); expect(v.observe).not.toHaveBeenCalled(); expect(v.animate).not.toHaveBeenCalled(); stop()
})
test('changing the system preference cancels active motion', () => {
  const v = setup(); const stop = installLandingMotion(v.root); v.enter()
  const listener = v.media.addEventListener.mock.calls[0][1] as () => void
  v.media.matches = true; listener()
  expect(v.cancel).toHaveBeenCalled(); expect(v.disconnect).toHaveBeenCalled(); stop()
})
