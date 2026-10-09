import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

/** 只有实际被两行预览截断的辅助文字才提供展开操作。 */
export function TableTextPreview({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  const active = useSectionActive()

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!active || !wrapper) return
    let disposed = false, frame = 0, measuredWidth = 0
    const measure = () => {
      if (disposed || !textRef.current || wrapper.clientWidth === 0) return
      measuredWidth = wrapper.clientWidth
      // 独立测量完整列宽下的两行预览，避免箭头占宽或展开高度反过来改变判定。
      const probe = textRef.current.cloneNode(true) as HTMLSpanElement
      probe.setAttribute('data-table-text-measure', '')
      const preview = document.createElement('div')
      preview.className = 'table-text-preview'
      preview.setAttribute('aria-hidden', 'true')
      Object.assign(preview.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0', width: '100%' })
      preview.append(probe)
      wrapper.append(preview)
      try {
        const next = probe.scrollHeight > probe.clientHeight + 1
        setOverflow(previous => previous === next ? previous : next)
      } finally {
        preview.remove()
      }
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; measure() })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? wrapper.clientWidth
      if (width > 0 && Math.abs(width - measuredWidth) > 0.5) schedule()
    })
    observer?.observe(wrapper)
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(() => { if (!disposed) measure() })
    document.fonts?.addEventListener('loadingdone', schedule)
    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      document.fonts?.removeEventListener('loadingdone', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [active, children])

  return <div ref={wrapperRef} data-table-text className="relative min-w-0">
    {overflow ? <details className="table-text-preview group/text" onDoubleClick={event => event.stopPropagation()}>
      <summary className="flex cursor-pointer items-start gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={value}>
        <span ref={textRef} className="table-text-value min-w-0 flex-1">{children}</span>
        <ChevronDown aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/text:rotate-180" />
        <span className="sr-only">展开或收起{title}</span>
      </summary>
    </details> : <span ref={textRef} className="table-text-value block min-w-0">{children}</span>}
  </div>
}
