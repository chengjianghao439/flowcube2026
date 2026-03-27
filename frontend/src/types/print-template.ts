export type PaperSize = 'A4' | 'A5' | 'A6' | 'thermal80' | 'thermal58'
export type TemplateType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface TemplateElement {
  id: string
  type: 'text' | 'table' | 'divider' | 'title' | 'barcode'
  fieldKey: string
  label: string
  x: number        // mm from canvas left
  y: number        // mm from canvas top
  width: number    // mm
  height: number   // mm
  fontSize: number // pt
  fontWeight: 'normal' | 'bold'
  textAlign: 'left' | 'center' | 'right'
  border: boolean
  // table-specific
  tableColumns?: string[]
}

/** 单据画布模板 | ZPL 标签模板 */
export type TemplateLayout =
  | { elements: TemplateElement[] }
  | { format: 'zpl'; body: string }

export function isZplTemplateLayout(layout: TemplateLayout | unknown): layout is { format: 'zpl'; body: string } {
  return (
    typeof layout === 'object' &&
    layout !== null &&
    (layout as { format?: string }).format === 'zpl' &&
    typeof (layout as { body?: unknown }).body === 'string'
  )
}

export interface PrintTemplate {
  id: number
  name: string
  type: TemplateType
  typeName: string
  paperSize: PaperSize
  layout: TemplateLayout
  isDefault: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTemplateParams {
  name: string
  type: TemplateType
  paperSize: PaperSize
  layout: TemplateLayout
}

export interface UpdateTemplateParams extends CreateTemplateParams {
  id: number
}
