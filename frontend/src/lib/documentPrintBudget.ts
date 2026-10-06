import type { TemplateLayout } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'

/** Check legacy saved templates too, before React expands rows and elements. Never truncate a document. */
export function documentPrintBudgetError(layout: TemplateLayout, rows: number): string | null {
  const error = '单据打印内容超过安全限制，请精简模板或分拆单据后重试；本次未渲染任何明细。'
  if (isZplTemplateLayout(layout)) return null
  if (!layout || !Array.isArray(layout.elements) || layout.elements.length > 128 || !Number.isSafeInteger(rows) || rows > 2000 || rows < 0) return error
  let cells = 0
  let tableCount = 0
  for (const el of layout.elements) {
    if (!el || !['text', 'table', 'divider', 'title', 'barcode', 'image'].includes(el.type)) return error
    for (const n of [el.x, el.y, el.width, el.height, el.fontSize]) if (!Number.isFinite(n) || n < 0 || n > 2000) return error
    if ((el.label?.length ?? 0) > 1000 || (el.fieldKey?.length ?? 0) > 100 || (el.nameAttrs?.length ?? 0) > 10) return error
    if (el.type === 'table') {
      tableCount += 1
      const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
      if (!Array.isArray(cols) || cols.length > 10 || cols.some(c => typeof c !== 'string' || c.length > 100)) return error
      cells += rows * (cols.length + (el.showIndex === false ? 0 : 1))
    }
  }
  if (tableCount > 1 || cells > 20000) return error
  try { if (new TextEncoder().encode(JSON.stringify(layout)).byteLength > 64 * 1024) return error } catch { return error }
  return null
}
