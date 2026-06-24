/**
 * 标签统一几何层（前端镜像，零运行时依赖）。
 *
 * 必须与后端 backend/src/modules/print-jobs/labelGeometry.js 行为完全一致 ——
 * 由 tests/fixtures/label-geometry-cases.json 快照锁定（tests/label-geometry-frontend.test.js
 * 用 Node 类型剥离直接加载本文件，跑同一组 input 断言 expected 相等）。
 *
 * 前端预览：resolveLayout 出 DrawPrimitive(mm) → ×MM_PX 渲染为 CSS。
 * 后端 ZPL：同一 resolveLayout → ×MM_TO_DOT 渲染为 ZPL。几何只算一次，两端一致。
 */

export type LabelElementType = 'text' | 'title' | 'barcode'
export type TextAlign = 'left' | 'center' | 'right'
export type BarcodeSymbology = 'code128' | 'ean13'

/** v2 标签元素 */
export interface LabelElement {
  id: string
  type: LabelElementType
  fieldKey: string
  label: string
  showLabel: boolean
  x: number
  y: number
  width: number
  height: number
  fontHeightMm: number
  textAlign: TextAlign
  // barcode-only
  symbology?: BarcodeSymbology
  hri?: boolean
}

export interface LabelLayoutV2 {
  version: 2
  canvasWidthMm: number
  canvasHeightMm: number
  elements: LabelElement[]
}

/** 中性绘制图元（mm 单位） */
export type DrawPrimitive =
  | { kind: 'barcode'; xMm: number; yMm: number; widthMm: number; heightMm: number; value: string; symbology: BarcodeSymbology; hri: boolean }
  | { kind: 'text'; xMm: number; yMm: number; widthMm: number; heightMm: number; text: string; fontHeightMm: number; align: TextAlign }

export interface ResolvedLayout {
  widthMm: number
  heightMm: number
  primitives: DrawPrimitive[]
}

/** pt → mm（1pt = 1/72 inch）。旧模板 fontSize(pt) 迁移用 */
export const PT_TO_MM = 25.4 / 72

/** v2 仅支持这三种元素；divider/table 属单据画布模板，标签真机不画，normalize 阶段剔除 */
export const LABEL_ELEMENT_TYPES: LabelElementType[] = ['text', 'title', 'barcode']

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 标签纸宽（mm）：canvasWidthMm 优先（30–120 合法），否则按纸张推断 */
export function resolveLabelWidthMm(layout: any, paperSize: string): number {
  const n = Number(layout?.canvasWidthMm)
  if (Number.isFinite(n) && n >= 30 && n <= 120) return Math.round(n)
  if (paperSize === 'thermal58') return 58
  if (paperSize === 'thermal75') return 75
  return 80
}

/** 标签纸高（mm）：canvasHeightMm 优先，否则默认 50 */
export function resolveLabelHeightMm(layout: any): number {
  const n = Number(layout?.canvasHeightMm)
  if (Number.isFinite(n) && n > 0 && n <= 300) return Math.round(n)
  return 50
}

/**
 * 归一化任意历史/新结构的画布元素为 v2 元素。
 * - 剔除 divider / table（标签不支持）
 * - fontSize(pt) → fontHeightMm（已是 fontHeightMm 则保留）
 * - 丢弃 fontWeight（去加粗）/ border / tableColumns
 * - showLabel 缺省 false（与真机一致：默认不显前缀）
 */
export function normalizeElement(raw: any): LabelElement | null {
  if (!raw || typeof raw !== 'object') return null
  const type: LabelElementType | null =
    raw.type === 'title' ? 'title' : raw.type === 'barcode' ? 'barcode' : raw.type === 'text' ? 'text' : null
  if (!type) return null

  let fontHeightMm = Number(raw.fontHeightMm)
  if (!Number.isFinite(fontHeightMm) || fontHeightMm <= 0) {
    fontHeightMm = Math.round(num(raw.fontSize, 10) * PT_TO_MM * 100) / 100
  }

  const el: LabelElement = {
    id: String(raw.id ?? ''),
    type,
    fieldKey: String(raw.fieldKey ?? ''),
    label: String(raw.label ?? ''),
    showLabel: raw.showLabel === true,
    x: num(raw.x),
    y: num(raw.y),
    width: num(raw.width),
    height: num(raw.height),
    fontHeightMm,
    textAlign: raw.textAlign === 'center' ? 'center' : raw.textAlign === 'right' ? 'right' : 'left',
  }
  if (type === 'barcode') {
    el.symbology = raw.barcodeSymbology === 'ean13' ? 'ean13' : 'code128'
    el.hri = raw.barcodeHRI !== false
  }
  return el
}

/**
 * 归一化整个 layout 为 v2。
 * format=zpl 的裸 body 模板不归此处管（返回 null）。
 */
export function normalizeLabelLayout(layout: any, paperSize: string): LabelLayoutV2 | null {
  if (!layout || typeof layout !== 'object') return null
  if (layout.format === 'zpl') return null
  if (!Array.isArray(layout.elements)) return null

  const elements = layout.elements.map(normalizeElement).filter((e: LabelElement | null): e is LabelElement => e != null)
  return {
    version: 2,
    canvasWidthMm: resolveLabelWidthMm(layout, paperSize),
    canvasHeightMm: resolveLabelHeightMm(layout),
    elements,
  }
}

/** 解析单个元素的最终文本（含 showLabel 前缀规则） */
function resolveText(el: LabelElement, data: Record<string, unknown> | undefined): string {
  const raw = data?.[el.fieldKey]
  const value = raw == null ? '' : String(raw)
  if (el.type === 'title') return value || el.label
  if (el.showLabel && el.label) return `${el.label}：${value}`
  return value
}

/**
 * 核心：layout_json + 数据 → 中性绘制图元。排序按 y 再 x。空文本/空条码跳过。
 */
export function resolveLayout(rawLayout: any, data: Record<string, unknown> | undefined, paperSize: string): ResolvedLayout {
  const layout = normalizeLabelLayout(rawLayout, paperSize)
  if (!layout) {
    return { widthMm: resolveLabelWidthMm(rawLayout, paperSize), heightMm: resolveLabelHeightMm(rawLayout), primitives: [] }
  }

  const sorted = [...layout.elements].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const primitives: DrawPrimitive[] = []
  for (const el of sorted) {
    if (el.type === 'barcode') {
      const value = String(data?.[el.fieldKey] ?? '').replace(/[\r\n^~]/g, '')
      if (!value) continue
      primitives.push({ kind: 'barcode', xMm: el.x, yMm: el.y, widthMm: el.width, heightMm: el.height, value, symbology: el.symbology === 'ean13' ? 'ean13' : 'code128', hri: el.hri !== false })
    } else {
      const text = resolveText(el, data)
      if (!text) continue
      primitives.push({ kind: 'text', xMm: el.x, yMm: el.y, widthMm: el.width, heightMm: el.height, text, fontHeightMm: el.fontHeightMm, align: el.textAlign })
    }
  }
  return { widthMm: layout.canvasWidthMm, heightMm: layout.canvasHeightMm, primitives }
}
