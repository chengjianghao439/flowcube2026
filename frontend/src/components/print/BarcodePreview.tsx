import { useRef, useEffect, useState, useCallback } from 'react'
import JsBarcode from 'jsbarcode'

interface Props {
  value: string
}

export default function BarcodePreview({ value }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const render = useCallback(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container || !value) return
    const h = container.clientHeight
    const w = container.clientWidth
    if (!h || !w) return
    try {
      const barH = Math.max(20, Math.round(h * 0.72))
      JsBarcode(svg, value, {
        format: 'CODE128',
        width: 2,
        height: barH,
        margin: 0,
        displayValue: true,
        fontSize: Math.max(10, Math.round(h * 0.18)),
        textMargin: 2,
        flat: true,
      })
      setSize({ w, h })
    } catch {
      // 无效条码值则静默
    }
  }, [value])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => render())
    ro.observe(el)
    render()
    return () => ro.disconnect()
  }, [render])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
