import { DEFAULT_LABEL_ELEMENTS, type PrintFieldDef } from '@/constants/printFieldDefs'
import { PT_TO_MM } from '@/lib/labelGeometry'
import type { PaperSize, TemplateElement, TemplateType } from '@/types/print-template'

export type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'
export type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 标签元素字高（mm）：优先 v2 fontHeightMm，旧模板回退 fontSize(pt)×PT_TO_MM —— 与后端 normalize 一致 */
export function labelFontMm(el: TemplateElement): number {
  return typeof el.fontHeightMm === 'number' && el.fontHeightMm > 0
    ? el.fontHeightMm
    : Math.round(el.fontSize * PT_TO_MM * 100) / 100
}

/** 标签元素预览文本：title 取值兜底 label；text 按 showLabel 决定是否拼 "label：" —— 与后端 resolveLayout 一致 */
export function labelText(el: TemplateElement, data: Record<string, string>): string {
  const value = data[el.fieldKey] ?? ''
  if (el.type === 'title') return value || el.label
  if (el.showLabel && el.label) return `${el.label}：${value}`
  return value
}

export const MM_PX = 5.0 // 1mm → px，编辑器显示比例
export const EDITOR_ZOOM_MIN = 0.35
export const EDITOR_ZOOM_MAX = 3
export const EDITOR_ZOOM_STEP = 0.1

export function clampEditorZoom(z: number) {
  return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, Math.round(z * 100) / 100))
}

/** 数值钳制到 [min, max] */
export function clampVal(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export const PAPER_SIZES: Record<PaperSize, { w: number; h: number; label: string }> = {
  A4:        { w: 210, h: 297, label: 'A4 (210×297mm)' },
  A5:        { w: 148, h: 210, label: 'A5 (148×210mm)' },
  A6:        { w: 105, h: 148, label: 'A6 (105×148mm)' },
  thermal80: { w: 80,  h: 200, label: '热敏纸 80mm' },
  thermal75: { w: 75,  h: 50,  label: '热敏纸 75×50mm (标签)' },
  thermal58: { w: 58,  h: 150, label: '热敏纸 58mm' },
}

export const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: 1, label: '销售订单' },
  { value: 2, label: '采购订单' },
  { value: 3, label: '出库单' },
  { value: 4, label: '仓库任务单' },
  { value: 5, label: '货架条码标签 (画布)' },
  { value: 6, label: '库存条码标签 (画布)' },
  { value: 7, label: '物流条码标签 (画布)' },
  { value: 8, label: '产品条码标签 (画布)' },
  { value: 9, label: '塑料盒标签 (画布)' },
  { value: 10, label: '库位条码标签 (画布)' },
  { value: 11, label: '取货标签 (画布)' },
]

export function isZplLabelType(t: number): t is 5 | 6 | 7 | 8 | 9 | 10 | 11 {
  return t >= 5 && t <= 11
}

export function cloneDefaultLabelElements(t: number): TemplateElement[] {
  const raw = DEFAULT_LABEL_ELEMENTS[t]
  if (!raw?.length) return []
  return JSON.parse(JSON.stringify(raw)) as TemplateElement[]
}

export function makeId() {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function mkElement(field: PrintFieldDef, xMm: number, yMm: number, isLabel = false): TemplateElement {
  const isImage = field.type === 'image'
  const base: TemplateElement = {
    id:           makeId(),
    type:         field.type,
    fieldKey:     field.key,
    label:        field.label,
    x:            xMm,
    y:            yMm,
    width:        field.defaultW ?? 80,
    height:       field.defaultH ?? 7,
    fontSize:     field.type === 'title' ? 16 : 10,
    fontWeight:   field.type === 'title' ? 'bold' : 'normal',
    textAlign:    'left',
    border:       field.type === 'table',
    tableColumns: field.type === 'table' ? ['name', 'qty', 'price', 'amount'] : undefined,
  }
  if (isLabel) {
    return { ...base, fontWeight: 'normal', showLabel: false, fontHeightMm: field.type === 'title' ? 5 : 3.5 }
  }
  if (isImage) {
    return { ...base, fontWeight: 'normal', border: false }
  }
  return base
}

/** 吸附阈值（mm）：拖动元素的边/中心进入此距离即吸附到目标 */
const SNAP_TH = 1.2

/**
 * 单轴吸附：元素在该轴有 3 个锚点（起点/中心/终点），任一进入阈值即吸附。
 * @returns value=吸附后的起点坐标；guide=命中的参考线位置（无则 null）
 */
export function snapAxis(pos: number, size: number, targets: number[]): { value: number; guide: number | null } {
  const anchors = [pos, pos + size / 2, pos + size]
  const offsets = [0, size / 2, size]
  let best = { dist: Infinity, value: pos, guide: null as number | null }
  anchors.forEach((a, i) => {
    for (const t of targets) {
      const d = Math.abs(a - t)
      if (d < best.dist && d <= SNAP_TH) best = { dist: d, value: t - offsets[i], guide: t }
    }
  })
  return { value: best.value, guide: best.guide }
}
