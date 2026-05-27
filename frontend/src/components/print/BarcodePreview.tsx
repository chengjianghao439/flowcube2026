import { useRef, useEffect } from 'react'
import JsBarcode from 'jsbarcode'

interface Props {
  value: string
  /** 容器已含 padding，这里减掉避免溢出 */
  pad?: number
}

export default function BarcodePreview({ value, pad = 4 }: Props) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        width: 2,
        height: ref.current.clientHeight - pad,
        margin: 0,
        displayValue: false,
        flat: true,
      })
    } catch {
      // 无效条码值则静默
    }
  }, [value, pad])

  const w = ref.current?.clientWidth ?? 0
  const h = ref.current?.clientHeight ?? 0

  return (
    <svg
      ref={ref}
      style={{ width: '100%', height: '100%', display: 'block' }}
      viewBox={w && h ? `0 0 ${w} ${h}` : undefined}
    />
  )
}
