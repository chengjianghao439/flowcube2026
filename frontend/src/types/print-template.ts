export type PaperSize = 'A4' | 'A5' | 'A6' | 'thermal80' | 'thermal75' | 'thermal58'
export type TemplateType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface TemplateElement {
  id: string
  type: 'text' | 'table' | 'divider' | 'title' | 'barcode' | 'image'
  fieldKey: string
  label: string
  x: number        // mm from canvas left
  y: number        // mm from canvas top
  width: number    // mm
  height: number   // mm
  fontSize: number // pt（单据画布 type 1-4）
  fontWeight: 'normal' | 'bold'
  textAlign: 'left' | 'center' | 'right'
  border: boolean
  // table-specific
  tableColumns?: string[]
  /** 是否显示序号列（第 1 列，打印表格序号；默认 true 不写即显示，兼容旧模板） */
  showIndex?: boolean
  /**
   * 名称列后拼接的附加信息（颜色/型号/单位/货号等）：
   * 勾选后这些字段不再作为独立列，自动排在名称后面（如「商品A [黑色] [500g] [件]」）。
   * 只在 tableColumns 包含 'name' 时生效；旧模板缺省 = 不拼接（行为不变）。
   */
  nameAttrs?: string[]
  /** 表格列宽（mm）：列 key → 宽度；缺省的列均分剩余宽度 */
  tableColumnWidths?: Record<string, number>
  /** 表格单元格自动换行（默认 true；false = 单行截断） */
  tableRowWrap?: boolean
  /** 表格最小行高（mm）；缺省按字号自适应 */
  tableMinRowHeightMm?: number
  // 标签 v2（type 5-9）：字高用 mm（替代 fontSize），showLabel 控制 "label：" 前缀
  fontHeightMm?: number
  showLabel?: boolean
  // barcode 专属：码制 + 是否显示可读数字(HRI)
  barcodeSymbology?: 'code128' | 'ean13'
  barcodeHRI?: boolean
}

/** 页面边距（mm），打印 @page margin 与编辑器安全区共用 */
export interface PrintPageMargins {
  top: number
  bottom: number
  left: number
  right: number
}

/** 单据画布模板 | ZPL 标签模板（标签可选手动纸张宽高 mm，供画布与打印 ^PW） */
export type TemplateLayout =
  | {
      elements: TemplateElement[]
      canvasWidthMm?: number
      canvasHeightMm?: number
      margins?: PrintPageMargins
    }
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
