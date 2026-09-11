import { useEffect, useMemo, useState } from 'react'
import { renderLabelPreviewApi } from '@/api/print-templates'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import type { PaperSize, TemplateElement } from '@/types/print-template'

interface Props {
  elements: TemplateElement[]
  canvasWidthMm: number
  canvasHeightMm: number
  dpi: 203 | 300
  data: Record<string, string>
  paperSize: PaperSize
  scale: number
}

/** Both edit and preview modes display the exact 1-bit image sent to the label printer. */
export default function LabelRasterPreview({ elements, canvasWidthMm, canvasHeightMm, dpi, data, paperSize, scale }: Props) {
  const active = useSectionActive()
  const generation = useAuthStore(s => s.sessionGeneration)
  const authenticated = useAuthStore(s => s.isAuthenticated)
  const [retry, setRetry] = useState(0)
  // Parent may recreate data on selection/zoom. Equality is by printable content.
  const serialized = JSON.stringify({ layout: { elements, canvasWidthMm, canvasHeightMm, dpi }, data, paperSize })
  const request = useMemo(() => JSON.parse(serialized) as Parameters<typeof renderLabelPreviewApi>[0], [serialized])
  const key = useMemo(() => JSON.stringify([request, generation, retry]), [request, generation, retry])
  const [result, setResult] = useState<{ key: string; image?: string; error?: string } | null>(null)
  useEffect(() => {
    if (!active || !authenticated) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      renderLabelPreviewApi(request, abort.signal).then(r => {
        if (!abort.signal.aborted) setResult({ key, image: r.imageDataUrl })
      }).catch(error => {
        if (!abort.signal.aborted) setResult({ key, error: error?.message || '标签绘制失败，请重试' })
      })
    }, 200)
    return () => { clearTimeout(timer); abort.abort() }
  }, [request, key, active, authenticated])
  if (!active || !authenticated) return null
  const current = result?.key === key ? result : null
  return (
    <div className="pointer-events-none absolute inset-0" style={{ width: canvasWidthMm * scale, height: canvasHeightMm * scale }}>
      {current?.image ? (
        <img src={current.image} alt="标签打印效果" draggable={false} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
      ) : (
        <div role={current?.error ? 'alert' : 'status'} className="absolute inset-x-2 top-2 z-40 rounded border bg-white/95 p-2 text-xs text-slate-700">
          {current?.error || '正在生成标签预览…'}
          {current?.error && <button type="button" onClick={() => setRetry(n => n + 1)} className="pointer-events-auto ml-2 underline">重新绘制</button>}
        </div>
      )}
    </div>
  )
}
