import { useLayoutEffect, useRef } from 'react'
import type { TemplateElement } from '@/types/print-template'

const MEASURE_EVENT = 'flowcube-party-print-measure'
export const PARTY_PRINT_FIT_EVENT = 'flowcube-party-print-fit'
const labels: Record<string, string> = { customerName: '客户', supplierName: '供应商', receiverAddress: '收货地址' }

/** Refresh only mounted party fields. Hidden/unmeasurable boxes remain unknown. */
export function refreshPartyPrintFields(root: HTMLElement) {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('[data-party-print-field]'))
  for (const box of boxes) box.dispatchEvent(new Event(MEASURE_EVENT))
  return {
    overflow: [...new Set(boxes.filter(box => box.dataset.printFit === 'overflow').map(box => box.dataset.partyPrintLabel || '资料'))],
    unavailable: boxes.some(box => box.dataset.printFit === 'unavailable' || box.dataset.printFit === 'pending'),
  }
}

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
