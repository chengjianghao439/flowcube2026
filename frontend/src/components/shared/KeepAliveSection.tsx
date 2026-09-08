import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { SectionVisibilityContext, useSectionActive } from '../layout/SectionVisibilityContext'

/** 首次显示才挂载，切走保留内存与 DOM；关闭所属大页面时正常卸载。 */
export default function KeepAliveSection({ active, children, style, ...props }: HTMLAttributes<HTMLDivElement> & { active: boolean }) {
  const parentActive = useSectionActive()
  const visible = parentActive && active
  const [visited, setVisited] = useState(visible)
  const element = useRef<HTMLDivElement>(null)
  const scroll = useRef({ top: 0, left: 0 })
  useLayoutEffect(() => {
    if (!visible) return
    const container = element.current?.closest<HTMLElement>('[data-workspace-scroll]')
    if (!container) return
    container.scrollTop = scroll.current.top
    container.scrollLeft = scroll.current.left
    const remember = () => { scroll.current = { top: container.scrollTop, left: container.scrollLeft } }
    container.addEventListener('scroll', remember, { passive: true })
    return () => container.removeEventListener('scroll', remember)
  }, [visible])
  if (visible && !visited) setVisited(true)
  if (!visible && !visited) return null
  return <SectionVisibilityContext.Provider value={visible}>
    <div {...props} ref={element} hidden={!visible} style={{ ...style, ...(!visible ? { display: 'none' } : {}) }}>{children}</div>
  </SectionVisibilityContext.Provider>
}
