/** Progressive enhancement: default content stays visible if observation or animation is unavailable. */
export function installLandingMotion(root: HTMLElement): () => void {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const animations = new Set<Animation>()
  const revealed = new WeakSet<Element>()
  let observer: IntersectionObserver | undefined
  const cancel = () => { observer?.disconnect(); animations.forEach(animation => animation.cancel()); animations.clear() }
  const start = () => {
    cancel()
    if (preference.matches || typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || revealed.has(entry.target)) return
        revealed.add(entry.target); observer?.unobserve(entry.target)
        const target = entry.target as HTMLElement
        if (typeof target.animate !== 'function') return
        const siblings = Array.from(target.parentElement?.children ?? [])
        const animation = target.animate(
          [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
          { duration: 700, delay: Math.min(Math.max(0, siblings.indexOf(target)) * 60, 300), easing: 'cubic-bezier(.22,.61,.21,1)', fill: 'backwards' },
        )
        animations.add(animation)
        animation.onfinish = () => { animations.delete(animation) }
      })
    }, { threshold: .12 })
    root.querySelectorAll('.fusion-story>*,.stat,.split>*,.flow,.mods,.ends,.release-list,.fq,.fin>*,.cmp,.starts,.device-showcase').forEach(el => observer?.observe(el))
  }
  start(); preference.addEventListener('change', start)
  return () => { cancel(); preference.removeEventListener('change', start) }
}
