import { useLayoutEffect, useRef } from 'react'
import type { TemplateElement } from '@/types/print-template'

import { MEASURE_EVENT, PARTY_PRINT_FIT_EVENT } from './partyPrintFit'
const labels: Record<string, string> = { customerName: '客户', supplierName: '供应商', receiverAddress: '收货地址' }

/** Local HTML document fitting; it never changes the source value or template. */
export function PartyPrintText({ el, value, scale, style }: {
  el: TemplateElement; value: string; scale: number; style: React.CSSProperties
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = boxRef.current; const text = textRef.current
    if (!box || !text) return
    const measure = () => {
      let font = el.fontSize
      const minimum = Math.min(8, font)
      text.style.fontSize = `${font * scale}pt`
      const overflows = () => box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1
      if (!value) box.dataset.printFit = 'empty'
      else if (box.clientWidth <= 0 || box.clientHeight <= 0) box.dataset.printFit = 'unavailable'
      else {
        while (font > minimum && overflows()) {
          font = Math.max(minimum, font - 0.5)
          text.style.fontSize = `${font * scale}pt`
        }
        box.dataset.printFit = overflows() ? 'overflow' : 'fit'
      }
      box.dispatchEvent(new Event(PARTY_PRINT_FIT_EVENT, { bubbles: true }))
    }
    measure()
    box.addEventListener(MEASURE_EVENT, measure)
    return () => box.removeEventListener(MEASURE_EVENT, measure)
  }, [el.fontSize, el.height, el.label, el.width, scale, value])

  return <div ref={boxRef} data-party-print-field={el.fieldKey} data-party-print-label={labels[el.fieldKey]} data-print-fit="pending"
    style={{ ...style, padding: '1px 3px', border: el.border ? '1px solid #ccc' : undefined }}>
    <span ref={textRef} data-party-print-content style={{ display: 'block', width: '100%', fontSize: `${el.fontSize * scale}pt`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
      {el.label && <span style={{ color: '#888', fontSize: '0.9em', whiteSpace: 'nowrap', marginRight: 2 }}>{el.label}：</span>}{value}
    </span>
  </div>
}
