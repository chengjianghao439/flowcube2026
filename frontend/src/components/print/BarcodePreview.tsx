import { useRef, useEffect, useState, useCallback } from 'react'
import JsBarcode from 'jsbarcode'

interface Props {
  value: string
  /** 码制，默认 code128 */
  symbology?: 'code128' | 'ean13'
  /** 是否显示可读数字(HRI)，默认 true */
  hri?: boolean
}

export default function BarcodePreview({ value, symbology = 'code128', hri = true }: Props) {
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
        format: symbology === 'ean13' ? 'EAN13' : 'CODE128',
        width: 2,
        height: barH,
        margin: 0,
        displayValue: hri,
        fontSize: Math.max(10, Math.round(h * 0.18)),
        textMargin: 2,
        flat: true,
      })
      setSize({ w, h })
    } catch {
      // 无效条码值（如 EAN13 位数不符）则静默
    }
  }, [value, symbology, hri])

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
