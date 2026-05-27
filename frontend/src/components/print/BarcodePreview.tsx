import { useRef, useEffect } from 'react'
import JsBarcode from 'jsbarcode'

interface Props {
  value: string
}

export default function BarcodePreview({ value }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const svg = ref.current
    const container = containerRef.current
    if (!svg || !container || !value) return
    const h = container.clientHeight
    const w = container.clientWidth
    if (!h || !w) return
    try {
      // 文字区约占 25%，留给条码 75% 高度
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
    } catch {
      // 无效条码值则静默
    }
  }, [value])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
