/**
 * 打印模板编辑器
 *
 * 布局：左侧字段面板 | 中间画布（拖拽定位）| 右侧属性面板
 * 存储单位：mm（毫米），显示时乘以 MM_PX 换算为像素
 * 拖拽方式：
 *   - 从字段面板拖到画布：HTML5 drag API
 *   - 画布内移动：mouse events
 */

import { useState, useRef, useEffect, useCallback, useContext, useId, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import {
  Save, Eye, EyeOff, Trash2, Loader2, X,
  AlignLeft, AlignCenter, AlignRight, Bold,
  Table2, Type, SeparatorHorizontal, Barcode, RotateCcw,
  ZoomIn, ZoomOut, Undo2, Redo2, Copy,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
} from 'lucide-react'

type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'
import { getPrintTemplateDetailApi, createPrintTemplateApi, updatePrintTemplateApi } from '@/api/print-templates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import PageHeader from '@/components/shared/PageHeader'
import type { PaperSize, PrintPageMargins, TemplateElement, TemplateLayout, TemplateType } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'
import {
  DOC_FIELD_DEFS,
  DOC_PREVIEW_ITEMS,
  DOC_PREVIEW_SAMPLE,
  LABEL_FIELD_DEFS_BY_TYPE,
  LABEL_PREVIEW_SAMPLE,
  TABLE_COLUMN_OPTIONS,
  type PrintFieldDef,
} from '@/constants/printFieldDefs'
import { DEFAULT_LABEL_ELEMENTS } from '@/constants/printFieldDefs'
import BarcodePreview from '@/components/print/BarcodePreview'
import { PT_TO_MM, resolveLayout } from '@/lib/labelGeometry'

/** 标签元素字高（mm）：优先 v2 fontHeightMm，旧模板回退 fontSize(pt)×PT_TO_MM —— 与后端 normalize 一致 */
function labelFontMm(el: TemplateElement): number {
  return typeof el.fontHeightMm === 'number' && el.fontHeightMm > 0
    ? el.fontHeightMm
    : Math.round(el.fontSize * PT_TO_MM * 100) / 100
}

/** 标签元素预览文本：title 取值兜底 label；text 按 showLabel 决定是否拼 "label：" —— 与后端 resolveLayout 一致 */
function labelText(el: TemplateElement, data: Record<string, string>): string {
  const value = data[el.fieldKey] ?? ''
  if (el.type === 'title') return value || el.label
  if (el.showLabel && el.label) return `${el.label}：${value}`
  return value
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MM_PX = 5.0 // 1mm → px，编辑器显示比例

const EDITOR_ZOOM_MIN = 0.35
const EDITOR_ZOOM_MAX = 3
const EDITOR_ZOOM_STEP = 0.1

function clampEditorZoom(z: number) {
  return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, Math.round(z * 100) / 100))
}

/** 数值钳制到 [min, max] */
function clampVal(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

const PAPER_SIZES: Record<PaperSize, { w: number; h: number; label: string }> = {
  A4:        { w: 210, h: 297, label: 'A4 (210×297mm)' },
  A5:        { w: 148, h: 210, label: 'A5 (148×210mm)' },
  A6:        { w: 105, h: 148, label: 'A6 (105×148mm)' },
  thermal80: { w: 80,  h: 200, label: '热敏纸 80mm' },
  thermal75: { w: 75,  h: 50,  label: '热敏纸 75×50mm (标签)' },
  thermal58: { w: 58,  h: 150, label: '热敏纸 58mm' },
}

const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: 1, label: '销售订单' },
  { value: 2, label: '采购订单' },
  { value: 3, label: '出库单' },
  { value: 4, label: '仓库任务单' },
  { value: 5, label: '货架条码标签 (画布)' },
  { value: 6, label: '库存条码标签 (画布)' },
  { value: 7, label: '物流条码标签 (画布)' },
  { value: 8, label: '产品条码标签 (画布)' },
  { value: 9, label: '塑料盒标签 (画布)' },
]

function isZplLabelType(t: number): t is 5 | 6 | 7 | 8 | 9 {
  return t >= 5 && t <= 9
}

/** 字段类型 → 面板图标映射（字段元数据不混入 JSX，见 printFieldDefs.ts） */
function fieldIcon(f: PrintFieldDef): React.ReactNode {
  switch (f.type) {
    case 'barcode': return <Barcode className="size-3.5" />
    case 'table':   return <Table2 className="size-3.5" />
    case 'divider': return <SeparatorHorizontal className="size-3.5" />
    default:        return <Type className="size-3.5" />
  }
}

function cloneDefaultLabelElements(t: number): TemplateElement[] {
  const raw = DEFAULT_LABEL_ELEMENTS[t]
  if (!raw?.length) return []
  return JSON.parse(JSON.stringify(raw)) as TemplateElement[]
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeId() { return `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function mkElement(field: PrintFieldDef, xMm: number, yMm: number, isLabel = false): TemplateElement {
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
  // 标签（5-9）：字高用 mm、去加粗、默认不显前缀
  if (isLabel) {
    return { ...base, fontWeight: 'normal', showLabel: false, fontHeightMm: field.type === 'title' ? 5 : 3.5 }
  }
  return base
}

/** 吸附阈值（mm）：拖动元素的边/中心进入此距离即吸附到目标 */
const SNAP_TH = 1.2

/**
 * 单轴吸附：元素在该轴有 3 个锚点（起点/中心/终点），任一进入阈值即吸附。
 * @returns value=吸附后的起点坐标；guide=命中的参考线位置（无则 null）
 */
function snapAxis(pos: number, size: number, targets: number[]): { value: number; guide: number | null } {
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

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function PalettePanel({
  fields,
  hint,
  onDragStart,
}: {
  fields: PrintFieldDef[]
  hint?: string
  onDragStart: (field: PrintFieldDef) => void
}) {
  return (
    <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r bg-muted/20">
      <div className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">字段列表</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint ?? '拖拽字段到画布'}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {fields.map(f => (
          <div
            key={f.key}
            draggable
            onDragStart={() => onDragStart(f)}
            className="flex cursor-grab items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-sm hover:border-primary/50 hover:bg-primary/5 active:cursor-grabbing select-none"
          >
            <span className="text-muted-foreground">{fieldIcon(f)}</span>
            <span className="truncate">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** resize 手柄方向（含组合：角=两轴） */
type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const RESIZE_HANDLES: { dir: ResizeDir; css: React.CSSProperties }[] = [
  { dir: 'nw', css: { left: -4, top: -4, cursor: 'nwse-resize' } },
  { dir: 'n',  css: { left: '50%', top: -4, marginLeft: -4, cursor: 'ns-resize' } },
  { dir: 'ne', css: { right: -4, top: -4, cursor: 'nesw-resize' } },
  { dir: 'e',  css: { right: -4, top: '50%', marginTop: -4, cursor: 'ew-resize' } },
  { dir: 'se', css: { right: -4, bottom: -4, cursor: 'nwse-resize' } },
  { dir: 's',  css: { left: '50%', bottom: -4, marginLeft: -4, cursor: 'ns-resize' } },
  { dir: 'sw', css: { left: -4, bottom: -4, cursor: 'nesw-resize' } },
  { dir: 'w',  css: { left: -4, top: '50%', marginTop: -4, cursor: 'ew-resize' } },
]

function ResizeHandles({ onStart }: { onStart: (e: React.MouseEvent, dir: ResizeDir) => void }) {
  return (
    <>
      {RESIZE_HANDLES.map(h => (
        <div
          key={h.dir}
          onMouseDown={e => { e.stopPropagation(); onStart(e, h.dir) }}
          style={{
            position: 'absolute', width: 8, height: 8, zIndex: 20,
            background: 'hsl(var(--primary))', border: '1.5px solid white', borderRadius: 2,
            boxShadow: '0 0 0 0.5px hsl(var(--primary))', ...h.css,
          }}
        />
      ))}
    </>
  )
}

interface ElementNodeProps {
  el: TemplateElement
  selected: boolean
  preview: boolean
  previewData: Record<string, string>
  /** mm → 画布 px（已含 MM_PX × 缩放） */
  scale: number
  /** 标签类型（5-9）：字高用 mm 真实比例、去加粗、文本走 showLabel 规则，与真机 ZPL 一致 */
  isLabel: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onClick: (e: React.MouseEvent) => void
  onResizeStart: (e: React.MouseEvent, dir: ResizeDir) => void
}

function ElementNode({ el, selected, preview, previewData, scale, isLabel, onMouseDown, onClick, onResizeStart }: ElementNodeProps) {
  const px = (mm: number) => mm * scale
  const sampleVal = previewData[el.fieldKey] ?? el.label

  const style: React.CSSProperties = {
    position: 'absolute',
    left:     px(el.x),
    top:      px(el.y),
    width:    px(el.width),
    height:   px(el.height),
    // 标签：字高 mm × scale（真实比例，无 0.35 魔数）；单据：pt × scale × 0.35
    fontSize: isLabel ? `${labelFontMm(el) * scale}px` : `${el.fontSize * scale * 0.35}px`,
    fontWeight: isLabel ? 'normal' : el.fontWeight,
    textAlign: el.textAlign,
    border:   (el.border && el.type !== 'table') ? '1px solid #999' : undefined,
    outline:  (!preview && selected) ? '2px solid hsl(var(--primary))' : undefined,
    cursor:   preview ? 'default' : 'move',
    // 编辑+选中时露出 resize 手柄；其余裁剪以模拟真机边界
    overflow: (!preview && selected) ? 'visible' : 'hidden',
    boxSizing: 'border-box',
    padding:  el.type === 'divider' ? '0' : '1px 2px',
    userSelect: 'none',
    background: !preview && selected ? 'hsl(var(--primary)/0.05)' : undefined,
  }

  let content: React.ReactNode
  if (el.type === 'divider') {
    content = <div className="h-px w-full bg-current" style={{ marginTop: px(el.height) / 2 - 0.5 }} />
  } else if (el.type === 'barcode') {
    const v = (previewData[el.fieldKey] ?? '') || el.label
    content = preview
      ? <div style={{ width: '100%', height: '100%', padding: '1px 2px' }}>
          <BarcodePreview value={v} symbology={el.barcodeSymbology} hri={el.barcodeHRI} />
        </div>
      : <span className="text-muted-foreground/60">{el.label}（{el.barcodeSymbology === 'ean13' ? 'EAN13' : '条码'}）</span>
  } else if (el.type === 'table') {
    const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
    const allCols = ['#', ...cols]
    // 自定义列 key（不在 TABLE_COLUMN_OPTIONS 中）兜底显示 key 本身，保证画布预览不崩
    const colDefs = allCols.map(k => TABLE_COLUMN_OPTIONS.find(c => c.key === k) ?? { key: k, label: k, align: 'left' as const })
    // 列宽：显式（mm）优先，其余均分；与 TemplateRenderer.FlowTable 同一口径
    const colWm = el.tableColumnWidths ?? {}
    const totalMm = el.width
    const knownMm = allCols.filter(k => {
      const w = colWm[k]
      return w != null && Number.isFinite(w) && w > 0
    })
    const usedMm = knownMm.reduce((s, k) => s + (colWm[k] as number), 0)
    const unknownMm = allCols.length - knownMm.length
    const shareMm = unknownMm > 0 ? Math.max(0, totalMm - usedMm) / unknownMm : 0
    const widthMmOf = (k: string) => {
      const w = colWm[k]
      return w != null && Number.isFinite(w) && w > 0 ? w : shareMm
    }
    const wrap = el.tableRowWrap !== false
    const cellStyle: React.CSSProperties = {
      border: '1px solid #ddd', padding: '1px 3px',
      fontSize: `${el.fontSize * scale * 0.35}px`,
      whiteSpace: wrap ? 'normal' : 'nowrap',
      wordBreak: 'break-all',
    }
    content = (
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {colDefs.map(c => (
              <th key={c.key} style={{ ...cellStyle, width: `${widthMmOf(c.key) * scale}px`, background: '#f5f5f5', fontWeight: 'bold' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(preview ? DOC_PREVIEW_ITEMS : DOC_PREVIEW_ITEMS.slice(0, 2)).map((row, i) => (
            <tr key={i}>
              {allCols.map(k => <td key={k} style={{ ...cellStyle, width: `${widthMmOf(k) * scale}px` }}>{k === '#' ? i + 1 : (row as Record<string, string>)[k] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else {
    // text / title。标签预览用等宽字体，近似热敏打印机点阵字的字宽
    content = preview
      ? <span
          className={!isLabel && el.type === 'title' ? 'font-semibold' : undefined}
          style={isLabel ? { fontFamily: "'Courier New', monospace" } : undefined}
        >{isLabel ? labelText(el, previewData) : sampleVal}</span>
      : <span className="text-muted-foreground/60">{el.label}</span>
  }

  return (
    <div style={style} onMouseDown={onMouseDown} onClick={onClick}>
      {content}
      {!preview && selected && <ResizeHandles onStart={onResizeStart} />}
    </div>
  )
}

interface LabelPreviewOverlayProps {
  /** v2 标签布局（elements + 画布尺寸 mm），交由 resolveLayout 归一化 */
  layout: { elements: TemplateElement[]; canvasWidthMm: number; canvasHeightMm: number }
  data: Record<string, string>
  paperSize: PaperSize
  /** mm → px（已含 MM_PX × 缩放） */
  scale: number
}

/**
 * 标签预览走统一几何层：resolveLayout → DrawPrimitive[] → 按 mm 原样渲染。
 * 与后端 ZPL（×MM_TO_DOT）共用同一几何，字框 / 字高 / showLabel 前缀 /
 * 空值跳过规则与真机一致，不再用「等宽字体 + PT_TO_MM」近似。
 */
function LabelPreviewOverlay({ layout, data, paperSize, scale }: LabelPreviewOverlayProps) {
  const resolved = useMemo(() => resolveLayout(layout, data, paperSize), [layout, data, paperSize])
  const px = (mm: number) => mm * scale

  return (
    <>
      {resolved.primitives.map((p, i) => {
        if (p.kind === 'barcode') {
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: px(p.xMm),
                top: px(p.yMm),
                width: px(p.widthMm),
                height: px(p.heightMm),
                padding: '1px 2px',
                boxSizing: 'border-box',
                overflow: 'hidden',
                pointerEvents: 'none',
              }}
            >
              <BarcodePreview value={p.value} symbology={p.symbology} hri={p.hri} />
            </div>
          )
        }
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px(p.xMm),
              top: px(p.yMm),
              width: px(p.widthMm),
              height: px(p.heightMm),
              fontSize: `${p.fontHeightMm * scale}px`,
              lineHeight: `${p.fontHeightMm * scale}px`,
              textAlign: p.align,
              fontFamily: "'Courier New', monospace",
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              boxSizing: 'border-box',
              padding: '1px 2px',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {p.text}
          </div>
        )
      })}
    </>
  )
}

interface PropertiesPanelProps {
  el: TemplateElement | null
  /** 多选时显示的选中数量（>1 时进入群组对齐面板） */
  multiCount: number
  isLabel: boolean
  onChange: (id: string, patch: Partial<TemplateElement>) => void
  onDelete: (id: string) => void
  /** 多选删除整组 */
  onDeleteMulti: () => void
  onAlign: (dir: AlignDir) => void
  onDistribute: (dir: 'horizontal' | 'vertical') => void
}

function PropertiesPanel({ el, multiCount, isLabel, onChange, onDelete, onDeleteMulti, onAlign, onDistribute }: PropertiesPanelProps) {
  const [customColKey, setCustomColKey] = useState('')
  if (!el) {
    return (
      <div className="flex w-60 shrink-0 flex-col border-l bg-muted/20">
        <div className="border-b px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">属性面板</p>
        </div>
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          点击画布中的元素以编辑属性
        </div>
      </div>
    )
  }

  // 多选群组模式：只显示对齐 / 等距分布操作
  if (multiCount > 1) {
    return (
      <div className="flex w-60 shrink-0 flex-col overflow-hidden border-l bg-muted/20">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">属性面板</p>
          <span className="text-xs text-muted-foreground">已选 {multiCount} 项</span>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">对齐画布</label>
            <div className="grid grid-cols-3 gap-1">
              {([
                ['left', <AlignHorizontalJustifyStart className="size-3.5" />, '左对齐'],
                ['hcenter', <AlignHorizontalJustifyCenter className="size-3.5" />, '水平居中'],
                ['right', <AlignHorizontalJustifyEnd className="size-3.5" />, '右对齐'],
                ['top', <AlignVerticalJustifyStart className="size-3.5" />, '顶对齐'],
                ['vmiddle', <AlignVerticalJustifyCenter className="size-3.5" />, '垂直居中'],
                ['bottom', <AlignVerticalJustifyEnd className="size-3.5" />, '底对齐'],
              ] as [AlignDir, React.ReactNode, string][]).map(([dir, icon, title]) => (
                <Button key={dir} size="sm" variant="outline" className="p-0" title={title}
                  onClick={() => onAlign(dir)}>
                  {icon}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">等距分布（需 ≥3 项）</label>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="outline" className="p-0" title="垂直等距"
                disabled={multiCount < 3} onClick={() => onDistribute('vertical')}>
                <AlignVerticalSpaceAround className="size-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="p-0" title="水平等距"
                disabled={multiCount < 3} onClick={() => onDistribute('horizontal')}>
                <AlignHorizontalSpaceAround className="size-3.5" />
              </Button>
            </div>
          </div>
          <Button size="sm" variant="outline" className="w-full text-destructive hover:text-destructive"
            onClick={() => onDeleteMulti()}>
            删除选中项 (Delete)
          </Button>
        </div>
      </div>
    )
  }

  const num = (v: unknown) => typeof v === 'number' ? v : 0
  // 不在 TABLE_COLUMN_OPTIONS 里的列 key 视为自定义列
  const customCols = (el.tableColumns ?? []).filter(k => !TABLE_COLUMN_OPTIONS.some(c => c.key === k))

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-l bg-muted/20">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">属性面板</p>
        <Button size="sm" variant="ghost" className="size-7 p-0 text-destructive hover:text-destructive"
          onClick={() => onDelete(el.id)}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* 标签 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">显示标签</label>
          <Input
            value={el.label}
            onChange={e => onChange(el.id, { label: e.target.value })}
            className="h-7 text-xs"
          />
        </div>

        {/* 位置和尺寸 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">位置与尺寸 (mm)</label>
          <div className="grid grid-cols-2 gap-1.5">
            {([['x', 'X'], ['y', 'Y'], ['width', '宽'], ['height', '高']] as [keyof TemplateElement, string][]).map(([k, lbl]) => (
              <div key={k} className="flex items-center gap-1">
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{lbl}</span>
                <Input
                  type="number" min="0" step="1"
                  value={num(el[k])}
                  onChange={e => onChange(el.id, { [k]: +e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 对齐到画布 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">对齐到画布</label>
          <div className="flex gap-1">
            {([
              ['left', <AlignHorizontalJustifyStart className="size-3.5" />, '左对齐'],
              ['hcenter', <AlignHorizontalJustifyCenter className="size-3.5" />, '水平居中'],
              ['right', <AlignHorizontalJustifyEnd className="size-3.5" />, '右对齐'],
              ['top', <AlignVerticalJustifyStart className="size-3.5" />, '顶对齐'],
              ['vmiddle', <AlignVerticalJustifyCenter className="size-3.5" />, '垂直居中'],
              ['bottom', <AlignVerticalJustifyEnd className="size-3.5" />, '底对齐'],
            ] as [AlignDir, React.ReactNode, string][]).map(([dir, icon, title]) => (
              <Button key={dir} size="sm" variant="outline" className="flex-1 p-0" title={title}
                onClick={() => onAlign(dir)}>
                {icon}
              </Button>
            ))}
          </div>
        </div>

        {/* 条码参数 */}
        {el.type === 'barcode' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">码制</label>
              <Select
                value={el.barcodeSymbology ?? 'code128'}
                onValueChange={v => onChange(el.id, { barcodeSymbology: v as 'code128' | 'ean13' })}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="code128">Code 128（通用）</SelectItem>
                  <SelectItem value="ean13">EAN-13（13 位数字）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">显示可读数字</label>
              <button
                className={`relative h-5 w-9 rounded-full transition-colors ${el.barcodeHRI !== false ? 'bg-primary' : 'bg-input'}`}
                onClick={() => onChange(el.id, { barcodeHRI: el.barcodeHRI === false })}
              >
                <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.barcodeHRI !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}

        {/* 字体（条码区高度由「高」控制，影响打印条码条高） */}
        {el.type !== 'divider' && el.type !== 'barcode' && (
          isLabel ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">字高 (mm)</label>
              <Input
                type="number" min="1" max="30" step="0.5"
                value={labelFontMm(el)}
                onChange={e => onChange(el.id, { fontHeightMm: +e.target.value })}
                className="h-7 w-20 text-xs"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">字体</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">大小</span>
                  <Input
                    type="number" min="6" max="72" step="1"
                    value={el.fontSize}
                    onChange={e => onChange(el.id, { fontSize: +e.target.value })}
                    className="h-7 w-14 text-xs"
                  />
                </div>
                <Button
                  size="sm" variant={el.fontWeight === 'bold' ? 'default' : 'outline'}
                  className="size-7 p-0"
                  onClick={() => onChange(el.id, { fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold' })}
                >
                  <Bold className="size-3.5" />
                </Button>
              </div>
            </div>
          )
        )}

        {/* 标签 text：显示「标签：」前缀开关（默认关，与真机一致） */}
        {isLabel && el.type === 'text' && (
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">显示「标签：」前缀</label>
            <button
              className={`relative h-5 w-9 rounded-full transition-colors ${el.showLabel ? 'bg-primary' : 'bg-input'}`}
              onClick={() => onChange(el.id, { showLabel: !el.showLabel })}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.showLabel ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}

        {/* 对齐 */}
        {el.type !== 'divider' && el.type !== 'barcode' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">对齐方式</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <Button
                  key={a}
                  size="sm"
                  variant={el.textAlign === a ? 'default' : 'outline'}
                  className="flex-1 p-0"
                  onClick={() => onChange(el.id, { textAlign: a })}
                >
                  {a === 'left' && <AlignLeft className="size-3.5" />}
                  {a === 'center' && <AlignCenter className="size-3.5" />}
                  {a === 'right' && <AlignRight className="size-3.5" />}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* 边框（仅单据画布） */}
        {!isLabel && el.type === 'text' && (
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">显示边框</label>
            <button
              className={`relative h-5 w-9 rounded-full transition-colors ${el.border ? 'bg-primary' : 'bg-input'}`}
              onClick={() => onChange(el.id, { border: !el.border })}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.border ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}

        {/* 表格列 */}
        {el.type === 'table' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">表格列（勾选显示，可设列宽 mm）</label>
              {TABLE_COLUMN_OPTIONS.map(col => {
                const checked = (el.tableColumns ?? []).includes(col.key)
                const colW = (el.tableColumnWidths ?? {})[col.key]
                return (
                  <div key={col.key} className="flex items-center gap-2 text-xs">
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const cols = el.tableColumns ?? []
                          const next = checked ? cols.filter(c => c !== col.key) : [...cols, col.key]
                          onChange(el.id, { tableColumns: next })
                        }}
                        className="size-3"
                      />
                      <span className="flex-1 truncate">{col.label}</span>
                    </label>
                    <Input
                      type="number" min="0" step="1"
                      placeholder="均分"
                      disabled={!checked}
                      value={colW ?? ''}
                      onChange={e => {
                        const v = e.target.value === '' ? undefined : +e.target.value
                        const widths = { ...(el.tableColumnWidths ?? {}) }
                        if (v != null && Number.isFinite(v) && v > 0) widths[col.key] = v
                        else delete widths[col.key]
                        onChange(el.id, { tableColumnWidths: widths })
                      }}
                      className="h-6 w-14 text-xs"
                    />
                  </div>
                )
              })}
            </div>

            {/* 自定义列：输入 key 后回车添加；渲染端（TemplateRenderer）对未知 key 兜底显示 key 名 + 空值 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">自定义列（key）</label>
              {customCols.map(key => (
                <div key={key} className="flex items-center justify-between rounded-md border border-dashed px-2 py-1">
                  <span className="font-mono text-xs">{key}</span>
                  <Button size="sm" variant="ghost" className="size-5 p-0 text-muted-foreground hover:text-destructive"
                    title="移除自定义列"
                    onClick={() => {
                      const cols = el.tableColumns ?? []
                      const widths = { ...(el.tableColumnWidths ?? {}) }
                      delete widths[key]
                      onChange(el.id, { tableColumns: cols.filter(c => c !== key), tableColumnWidths: widths })
                    }}>
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <form
                className="flex gap-1"
                onSubmit={e => {
                  e.preventDefault()
                  const key = customColKey.trim()
                  if (!key) return
                  const cols = el.tableColumns ?? []
                  if (!cols.includes(key)) onChange(el.id, { tableColumns: [...cols, key] })
                  setCustomColKey('')
                }}
              >
                <Input
                  value={customColKey}
                  onChange={e => setCustomColKey(e.target.value)}
                  placeholder="如 batch_no"
                  className="h-7 flex-1 font-mono text-xs"
                />
                <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">添加</Button>
              </form>
            </div>

            {/* 行高与换行 */}
            <div className="space-y-1.5 border-t border-border/60 pt-3">
              <label className="text-xs font-medium text-muted-foreground">行高与换行</label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">最小行高</span>
                <Input
                  type="number" min="0" step="0.5"
                  placeholder="自适应"
                  value={el.tableMinRowHeightMm ?? ''}
                  onChange={e => {
                    const v = e.target.value === '' ? undefined : +e.target.value
                    onChange(el.id, {
                      tableMinRowHeightMm: v != null && Number.isFinite(v) && v > 0 ? v : undefined,
                    })
                  }}
                  className="h-7 flex-1 text-xs"
                />
                <span className="shrink-0 text-xs text-muted-foreground">mm</span>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">自动换行</label>
                <button
                  className={`relative h-5 w-9 rounded-full transition-colors ${el.tableRowWrap !== false ? 'bg-primary' : 'bg-input'}`}
                  onClick={() => onChange(el.id, { tableRowWrap: el.tableRowWrap === false })}
                >
                  <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.tableRowWrap !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Main editor component
// ──────────────────────────────────────────────────────────────────────────

export default function PrintTemplateEditor() {
  const gridPatternUid = useId().replace(/:/g, '')
  const tabPath = useContext(TabPathContext)
  const isNew   = tabPath.endsWith('/new') || tabPath === ''
  const id      = isNew ? undefined : tabPath.split('/').pop()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // ── Remote data ──────────────────────────────────────────────
  const { data: remote, isLoading } = useQuery({
    queryKey: ['print-template', id],
    queryFn: () => getPrintTemplateDetailApi(+id!),
    enabled: !isNew,
  })

  // ── Template state ───────────────────────────────────────────
  const [name,       setName]       = useState('未命名模板')
  const [type,       setType]       = useState<TemplateType>(1)
  const [paperSize,  setPaperSize]  = useState<PaperSize>('A4')
  const [elements,   setElements]   = useState<TemplateElement[]>([])
  /** 标签类型 5–9：画布纸张（mm），与 layout.canvasWidthMm/HeightMm 同步 */
  const [canvasWidthMm,  setCanvasWidthMm]  = useState(75)
  const [canvasHeightMm, setCanvasHeightMm] = useState(50)
  /** 单据类型页面边距（mm），写入 layout.margins；打印 @page 与安全区共用 */
  const [margins, setMargins] = useState<PrintPageMargins>({ top: 8, bottom: 8, left: 0, right: 0 })
  /** 多选：Shift+点击 toggle；空数组 = 未选中 */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preview,    setPreview]    = useState(false)
  /** 画布仅影响显示与拖拽换算，不改变存库的 mm 坐标 */
  const [editorZoom, setEditorZoom] = useState(1)
  /** 拖动时的对齐参考线（mm 坐标），松手清空 */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })

  // Load remote template once per template id（2026-08-21 审计 C.2 修复）：
  // 页面是 keepAlive（tabIdentity=pathname），切换 /5 → /7 组件不卸载——hydrated
  // 必须随 id 变化重置，否则模板 A 的未保存编辑会残留并可能保存到模板 B。
  const [hydrated, setHydrated] = useState<number | null>(null)
  useEffect(() => {
    setHydrated(null)
  }, [id])
  useEffect(() => {
    if (remote && hydrated === null) {
      setName(remote.name)
      setType(remote.type)
      setPaperSize(remote.paperSize)
      if (isZplTemplateLayout(remote.layout)) {
        setElements(cloneDefaultLabelElements(remote.type))
        toast.warning('原 ZPL 文本模板已切换为可视化布局，保存后即按新格式存储')
        if (isZplLabelType(remote.type)) {
          setCanvasWidthMm(75)
          setCanvasHeightMm(50)
        }
      } else {
        setElements(Array.isArray(remote.layout.elements) ? remote.layout.elements : [])
        const lo = remote.layout as { canvasWidthMm?: number; canvasHeightMm?: number; margins?: PrintPageMargins }
        if (lo.margins) {
          setMargins({
            top:    Number.isFinite(lo.margins.top) ? lo.margins.top : 8,
            bottom: Number.isFinite(lo.margins.bottom) ? lo.margins.bottom : 8,
            left:   Number.isFinite(lo.margins.left) ? lo.margins.left : 0,
            right:  Number.isFinite(lo.margins.right) ? lo.margins.right : 0,
          })
        }
        if (isZplLabelType(remote.type)) {
          const cw = typeof lo.canvasWidthMm === 'number' ? lo.canvasWidthMm : 75
          const ch = typeof lo.canvasHeightMm === 'number' ? lo.canvasHeightMm : 50
          setCanvasWidthMm(Math.min(120, Math.max(30, cw)))
          setCanvasHeightMm(Math.min(500, Math.max(40, ch)))
        }
      }
      setHydrated(Number(id) || 0)
    }
  }, [remote, hydrated, id])

  function handleTypeChange(v: string) {
    const next = +v as TemplateType
    const prev = type
    setType(next)
    if (isZplLabelType(next)) {
      setPaperSize('thermal75')
      setCanvasWidthMm(75)
      setCanvasHeightMm(50)
      setElements(cloneDefaultLabelElements(next))
      setSelectedIds([])
    } else {
      if (isZplLabelType(prev)) {
        setElements([])
        setSelectedIds([])
        setPaperSize('A4')
        setCanvasWidthMm(80)
        setCanvasHeightMm(200)
      }
    }
  }

  // ── Drag state refs ──────────────────────────────────────────
  const canvasRef      = useRef<HTMLDivElement>(null)
  const draggingField  = useRef<PrintFieldDef | null>(null)   // palette → canvas drag
  const draggingElId   = useRef<string | null>(null)      // element move drag
  const dragStartMouse = useRef({ x: 0, y: 0 })

  // ── Save mutations ───────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createPrintTemplateApi,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['print-templates'] })
      toast.success('模板已保存')
      const newPath = `/settings/print-templates/${res!.id}`
      navigate(newPath, { replace: true })
    },
  })

  const updateMut = useMutation({
    mutationFn: updatePrintTemplateApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['print-templates'] })
      qc.invalidateQueries({ queryKey: ['print-template', id] })
      toast.success('模板已保存')
    },
  })

  const isPending = createMut.isPending || updateMut.isPending

  // ── Helpers ──────────────────────────────────────────────────
  const safeCw = Number.isFinite(canvasWidthMm) ? canvasWidthMm : 75
  const safeCh = Number.isFinite(canvasHeightMm) ? canvasHeightMm : 50
  const labelPaperSize: PaperSize = isZplLabelType(type)
    ? (safeCw >= 75 ? 'thermal80' : safeCw >= 58 ? 'thermal75' : 'thermal58')
    : paperSize
  const paper = isZplLabelType(type)
    ? {
        w: Math.min(120, Math.max(30, safeCw)),
        h: Math.min(500, Math.max(40, safeCh)),
        label: `${Math.min(120, Math.max(30, safeCw))}×${Math.min(500, Math.max(40, safeCh))} mm`,
      }
    : PAPER_SIZES[paperSize]
  const canvasScale = MM_PX * editorZoom
  const canvasW = paper.w * canvasScale
  const canvasH = paper.h * canvasScale
  // 单据类型（1-4）只用 A 系纸；热敏纸归标签类型（用 mm 输入），不在此下拉出现
  const paperSelectEntries = Object.entries(PAPER_SIZES).filter(([k]) => !k.startsWith('thermal'))

  /** 单选（属性面板用）：多选时取第一个 */
  const selected = selectedIds.length === 0
    ? null
    : elements.find(e => e.id === selectedIds[0]) ?? null

  const paletteFields = isZplLabelType(type) ? (LABEL_FIELD_DEFS_BY_TYPE[type] ?? []) : DOC_FIELD_DEFS
  const previewData: Record<string, string> = isZplLabelType(type)
    ? { ...(LABEL_PREVIEW_SAMPLE[type] ?? {}) }
    : { ...DOC_PREVIEW_SAMPLE, printDate: formatDisplayDateTime(new Date()) }

  // ── Undo / redo history ──────────────────────────────────────
  const historyPast = useRef<TemplateElement[][]>([])
  const historyFuture = useRef<TemplateElement[][]>([])
  const [, bumpHist] = useState(0)
  // 最新 elements 引用，供键盘 effect 内的 snapshot/undo/redo 读取，规避 stale closure
  const elementsRef = useRef(elements)
  elementsRef.current = elements

  /** 在改动 elements「之前」调用：压入当前快照、清空 redo 栈 */
  // snapshot / clampEl / deleteElement / duplicateElement 都被下面的键盘快捷键 effect
  // 依赖。原先是普通函数声明，每次渲染新引用，effect 只能手写等价依赖
  // （selectedId / paper.w / paper.h）——当时是对的，但一旦这几个函数将来多捕获一个
  // 状态，手写依赖就会悄悄失同步。包成 useCallback 后由编译器保证。
  const snapshot = useCallback(() => {
    historyPast.current.push(elementsRef.current)
    if (historyPast.current.length > 100) historyPast.current.shift()
    historyFuture.current = []
    bumpHist(v => v + 1)
  }, [])
  const undo = useCallback(() => {
    if (!historyPast.current.length) return
    historyFuture.current.push(elementsRef.current)
    setElements(historyPast.current.pop()!)
    setSelectedIds([])
    bumpHist(v => v + 1)
  }, [])
  const redo = useCallback(() => {
    if (!historyFuture.current.length) return
    historyPast.current.push(elementsRef.current)
    setElements(historyFuture.current.pop()!)
    setSelectedIds([])
    bumpHist(v => v + 1)
  }, [])

  const clampEl = useCallback((el: TemplateElement): TemplateElement => {
    return {
      ...el,
      x: Math.max(0, Math.min(paper.w - el.width, el.x)),
      y: Math.max(0, Math.min(paper.h - el.height, el.y)),
    }
  }, [paper.w, paper.h])

  function patchElement(id: string, patch: Partial<TemplateElement>) {
    snapshot()
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  const deleteElement = useCallback((id: string) => {
    snapshot()
    setElements(prev => prev.filter(e => e.id !== id))
    setSelectedIds(prev => prev.filter(sid => sid !== id))
  }, [snapshot])

  /** 删除整组选中元素（属性面板「删除选中项」） */
  const deleteSelectedGroup = useCallback(() => {
    if (selectedIds.length === 0) return
    const ids = [...selectedIds]
    snapshot()
    setElements(prev => prev.filter(e => !ids.includes(e.id)))
    setSelectedIds([])
  }, [selectedIds, snapshot])

  /** 复制整组：多选时保持相对位置，整体偏移 +2mm（单选时即复制单个） */
  const duplicateGroup = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    snapshot()
    const copies = ids
      .map(id => elementsRef.current.find(e => e.id === id))
      .filter((e): e is TemplateElement => e != null)
      .map(src => clampEl({ ...src, id: makeId(), x: src.x + 2, y: src.y + 2 }))
    if (copies.length === 0) return
    setElements(prev => [...prev, ...copies])
    setSelectedIds(copies.map(c => c.id))
  }, [snapshot, clampEl])

  /** 拖动吸附：把元素边/中心吸到画布中线或其他元素边/中心，返回吸附坐标 + 参考线 */
  function computeSnap(x: number, y: number, w: number, h: number, selfId: string) {
    const xT = [0, paper.w / 2, paper.w]
    const yT = [0, paper.h / 2, paper.h]
    for (const o of elementsRef.current) {
      if (o.id === selfId) continue
      xT.push(o.x, o.x + o.width / 2, o.x + o.width)
      yT.push(o.y, o.y + o.height / 2, o.y + o.height)
    }
    const sx = snapAxis(x, w, xT)
    const sy = snapAxis(y, h, yT)
    return {
      x: Math.max(0, sx.value),
      y: Math.max(0, sy.value),
      guides: { x: sx.guide != null ? [sx.guide] : [], y: sy.guide != null ? [sy.guide] : [] },
    }
  }

  /** 对齐画布六向：多选时按「目标锚点 + 相对偏移」整体移动，保持相对位置 */
  function alignSelectedToCanvas(dir: AlignDir) {
    if (selectedIds.length === 0) return
    snapshot()
    const group = elementsRef.current.filter(e => selectedIds.includes(e.id))
    if (group.length === 0) return
    // 取整体包围盒
    const minX = Math.min(...group.map(e => e.x))
    const minY = Math.min(...group.map(e => e.y))
    const maxX = Math.max(...group.map(e => e.x + e.width))
    const maxY = Math.max(...group.map(e => e.y + e.height))
    let tx = 0, ty = 0
    if (dir === 'left') tx = 0 - minX
    else if (dir === 'hcenter') tx = Math.max(0, (paper.w - (maxX - minX)) / 2) - minX
    else if (dir === 'right') tx = Math.max(0, paper.w - (maxX - minX)) - minX
    else if (dir === 'top') ty = 0 - minY
    else if (dir === 'vmiddle') ty = Math.max(0, (paper.h - (maxY - minY)) / 2) - minY
    else if (dir === 'bottom') ty = Math.max(0, paper.h - (maxY - minY)) - minY
    setElements(prev => prev.map(el => selectedIds.includes(el.id)
      ? { ...el, x: Math.round(el.x + tx), y: Math.round(el.y + ty) }
      : el))
  }

  /** 等距分布：以包围盒两端元素为锚，中间元素按中心均匀分布（需 ≥3 个选中） */
  function distributeSelected(dir: 'horizontal' | 'vertical') {
    if (selectedIds.length < 3) return
    snapshot()
    const group = elementsRef.current.filter(e => selectedIds.includes(e.id))
    if (group.length < 3) return
    const isH = dir === 'horizontal'
    const sorted = [...group].sort((a, b) => (isH ? a.x + a.width / 2 - (b.x + b.width / 2) : a.y + a.height / 2 - (b.y + b.height / 2)))
    const first = sorted[0], last = sorted[sorted.length - 1]
    const span = isH
      ? (last.x + last.width / 2) - (first.x + first.width / 2)
      : (last.y + last.height / 2) - (first.y + first.height / 2)
    if (span <= 0) return
    const step = span / (sorted.length - 1)
    setElements(prev => prev.map(el => {
      if (!selectedIds.includes(el.id)) return el
      const idx = sorted.findIndex(s => s.id === el.id)
      if (idx === 0 || idx === sorted.length - 1) return el // 两端不动
      const targetCenter = isH
        ? first.x + first.width / 2 + step * idx
        : first.y + first.height / 2 + step * idx
      return {
        ...el,
        x: isH ? Math.round(clampVal(targetCenter - el.width / 2, 0, paper.w - el.width)) : el.x,
        y: isH ? el.y : Math.round(clampVal(targetCenter - el.height / 2, 0, paper.h - el.height)),
      }
    }))
  }

  function handleSave() {
    if (isZplLabelType(type) && elements.length === 0) {
      toast.error('标签模板至少需要一个画布元素')
      return
    }
    const cw = Math.min(120, Math.max(30, Math.round(canvasWidthMm)))
    const ch = Math.min(500, Math.max(40, Math.round(canvasHeightMm)))
    const derivedPaper: PaperSize = isZplLabelType(type)
      ? (cw >= 75 ? 'thermal80' : cw >= 58 ? 'thermal75' : 'thermal58')
      : paperSize
    const layout: TemplateLayout = isZplLabelType(type)
      ? { elements, canvasWidthMm: cw, canvasHeightMm: ch }
      : { elements, margins }
    if (isNew) {
      createMut.mutate({ name, type, paperSize: derivedPaper, layout })
    } else {
      updateMut.mutate({ id: +id!, name, type, paperSize: derivedPaper, layout })
    }
  }

  function restoreLabelLayout() {
    if (!isZplLabelType(type)) return
    snapshot()
    setElements(cloneDefaultLabelElements(type))
    setSelectedIds([])
    toast.success('已恢复默认布局')
  }

  // ── Palette → Canvas drag (HTML5 drag API) ───────────────────
  const handlePaletteDragStart = useCallback((field: PrintFieldDef) => {
    draggingField.current = field
  }, [])

  function handleCanvasDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleCanvasDrop(e: React.DragEvent) {
    e.preventDefault()
    const field = draggingField.current
    if (!field) return
    draggingField.current = null

    const rect = canvasRef.current!.getBoundingClientRect()
    const xPx  = e.clientX - rect.left
    const yPx  = e.clientY - rect.top
    const xMm  = Math.max(0, xPx / canvasScale - (field.defaultW ?? 80) / 2)
    const yMm  = Math.max(0, yPx / canvasScale - (field.defaultH ?? 7) / 2)

    snapshot()
    const newEl = mkElement(field, xMm, yMm, isZplLabelType(type))
    setElements(prev => [...prev, newEl])
    setSelectedIds([newEl.id])
  }

  // ── Element mouse-drag (move) ────────────────────────────────
  function handleElementMouseDown(e: React.MouseEvent, el: TemplateElement) {
    if (preview) return
    e.preventDefault()
    e.stopPropagation()

    // Shift+点击：切换多选（只加不进拖动）
    if (e.shiftKey) {
      setSelectedIds(prev => prev.includes(el.id)
        ? prev.filter(id => id !== el.id)
        : [...prev, el.id])
      return
    }
    // 点击未选中元素：改为单选；点击已选中元素：保持多选并整体拖动
    if (!selectedIds.includes(el.id)) setSelectedIds([el.id])

    // 拖动组：若当前元素已选中则拖动整组，否则只拖该元素
    const dragGroupIds = selectedIds.includes(el.id) && selectedIds.length > 1
      ? selectedIds
      : [el.id]
    draggingElId.current   = el.id
    dragStartMouse.current = { x: e.clientX, y: e.clientY }
    // 记录组内每个元素的起始坐标与尺寸（拖动不改变尺寸）
    const startPositions = new Map<string, { x: number; y: number; width: number; height: number }>()
    for (const id of dragGroupIds) {
      const src = elementsRef.current.find(ee => ee.id === id)
      if (src) startPositions.set(id, { x: src.x, y: src.y, width: src.width, height: src.height })
    }
    let moved = false

    function onMouseMove(me: MouseEvent) {
      if (!moved) { moved = true; snapshot() }
      const dxMm = (me.clientX - dragStartMouse.current.x) / canvasScale
      const dyMm = (me.clientY - dragStartMouse.current.y) / canvasScale
      const gx: number[] = [], gy: number[] = []
      const moves = new Map<string, { x: number; y: number }>()
      for (const [id, start] of startPositions) {
        const rawX = Math.max(0, start.x + dxMm)
        const rawY = Math.max(0, start.y + dyMm)
        const snap = computeSnap(rawX, rawY, start.width, start.height, id)
        gx.push(...snap.guides.x)
        gy.push(...snap.guides.y)
        moves.set(id, { x: snap.x, y: snap.y })
      }
      setGuides({ x: [...new Set(gx)], y: [...new Set(gy)] })
      setElements(prev => prev.map(e => {
        const m = moves.get(e.id)
        return m ? { ...e, x: m.x, y: m.y } : e
      }))
    }

    function onMouseUp() {
      setGuides({ x: [], y: [] })
      // clamp to canvas bounds 并归整到整数 mm（与 resize 一致）
      setElements(prev => prev.map(e => {
        if (!startPositions.has(e.id)) return e
        const c = clampEl(e)
        return { ...c, x: Math.round(c.x), y: Math.round(c.y) }
      }))
      draggingElId.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ── Element resize (drag handles) ────────────────────────────
  function handleResizeMouseDown(e: React.MouseEvent, el: TemplateElement, dir: ResizeDir) {
    if (preview) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedIds([el.id])
    const startMouse = { x: e.clientX, y: e.clientY }
    const s = { x: el.x, y: el.y, w: el.width, h: el.height }
    const MIN = 3 // mm 最小尺寸
    const id = el.id
    let moved = false

    function onMouseMove(me: MouseEvent) {
      if (!moved) { moved = true; snapshot() }
      const dxMm = (me.clientX - startMouse.x) / canvasScale
      const dyMm = (me.clientY - startMouse.y) / canvasScale
      let x = s.x, y = s.y, w = s.w, h = s.h
      if (dir.includes('e')) w = s.w + dxMm
      if (dir.includes('s')) h = s.h + dyMm
      if (dir.includes('w')) { w = s.w - dxMm; x = s.x + dxMm }
      if (dir.includes('n')) { h = s.h - dyMm; y = s.y + dyMm }
      // 最小尺寸（拖左/上边时锁定对边）
      if (w < MIN) { if (dir.includes('w')) x = s.x + s.w - MIN; w = MIN }
      if (h < MIN) { if (dir.includes('n')) y = s.y + s.h - MIN; h = MIN }
      // 不越出画布边界
      if (x < 0) { w += x; x = 0 }
      if (y < 0) { h += y; y = 0 }
      if (x + w > paper.w) w = paper.w - x
      if (y + h > paper.h) h = paper.h - y
      // 吸附到 1mm 整数
      const rx = Math.round(x), ry = Math.round(y), rw = Math.round(w), rh = Math.round(h)
      setElements(prev => prev.map(p => p.id === id ? { ...p, x: rx, y: ry, width: rw, height: rh } : p))
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // Keyboard: 删除 / 取消选中 / 方向键微调位置（Shift=5mm）
  useEffect(() => {
    const ARROWS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    function onKey(e: KeyboardEvent) {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      const mod = e.ctrlKey || e.metaKey
      if (mod && !inField && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if (mod && !inField && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return }
      if (mod && !inField && (e.key === 'd' || e.key === 'D') && selectedIds.length) {
        e.preventDefault(); duplicateGroup(selectedIds); return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length && !inField) {
        // 多选时整组删除（一次 snapshot）
        const ids = [...selectedIds]
        snapshot()
        setElements(prev => prev.filter(el => !ids.includes(el.id)))
        setSelectedIds([])
      }
      if (e.key === 'Escape') setSelectedIds([])
      if (selectedIds.length && !inField && ARROWS[e.key]) {
        e.preventDefault()
        snapshot()
        const step = e.shiftKey ? 5 : 1
        const [dx, dy] = ARROWS[e.key]
        setElements(prev => prev.map(el => selectedIds.includes(el.id)
          ? clampEl({ ...el, x: el.x + dx * step, y: el.y + dy * step }) : el))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, clampEl, duplicateGroup, redo, snapshot, undo])

  // ── Loading state ────────────────────────────────────────────
  // isNew 不需要 hydrated（新建页没有远程数据）；编辑页等 remote 加载完成
  if (!isNew && (isLoading || hydrated === null)) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-4 pb-4 pt-2">
        <PageHeader title="编辑打印模板" description="正在加载…" />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载模板…
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-4 pb-4 pt-2">
      <PageHeader
        title={isNew ? '新建打印模板' : `编辑打印模板 #${id}`}
        description="把字段拖到画布上编排版式；热敏标签和单据都用毫米坐标；标签打印统一走 ZPL 指令集。工具栏里的「画布」可以缩放，方便看清细节。"
        actions={undefined}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="模板名称"
            className="h-9 w-44 text-sm"
          />

          <Select value={String(type)} onValueChange={handleTypeChange}>
            <SelectTrigger className="h-9 w-[11rem] px-2 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_TYPES.map(t => (
                <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isZplLabelType(type) ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">纸张 (mm)</span>
              <Input
                type="number"
                min={30}
                max={120}
                step={1}
                value={canvasWidthMm}
                onChange={e => setCanvasWidthMm(Number(e.target.value))}
                onBlur={() => setCanvasWidthMm(w => Math.min(120, Math.max(30, Math.round(Number(w) || 80))))}
                className="h-9 w-[4.25rem] text-sm"
                title="宽度 mm"
              />
              <span className="text-muted-foreground">×</span>
              <Input
                type="number"
                min={40}
                max={500}
                step={1}
                value={canvasHeightMm}
                onChange={e => setCanvasHeightMm(Number(e.target.value))}
                onBlur={() => setCanvasHeightMm(h => Math.min(500, Math.max(40, Math.round(Number(h) || 200))))}
                className="h-9 w-[4.25rem] text-sm"
                title="高度 mm"
              />
              <span className="text-xs text-muted-foreground">宽×高</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setCanvasWidthMm(75); setCanvasHeightMm(50) }}
              >
                75×50
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setCanvasWidthMm(80); setCanvasHeightMm(200) }}
              >
                80×200
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setCanvasWidthMm(58); setCanvasHeightMm(150) }}
              >
                58×150
              </Button>
            </div>
          ) : (
            <Select value={paperSize} onValueChange={v => setPaperSize(v as PaperSize)}>
              <SelectTrigger className="h-9 min-w-[10rem] px-2 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paperSelectEntries.map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isZplLabelType(type) && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={restoreLabelLayout}>
              <RotateCcw className="size-3.5" />
              恢复默认布局
            </Button>
          )}

          {!isZplLabelType(type) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">页边距 (mm)</span>
              {([['上', 'top'], ['下', 'bottom'], ['左', 'left'], ['右', 'right']] as const).map(([zh, k]) => (
                <div key={k} className="flex items-center gap-0.5">
                  <span className="text-[10px] text-muted-foreground">{zh}</span>
                  <Input
                    type="number"
                    min={0}
                    max={40}
                    step={1}
                    value={margins[k]}
                    onChange={e => setMargins(m => ({ ...m, [k]: Math.max(0, Number(e.target.value) || 0) }))}
                    onBlur={() => setMargins(m => ({ ...m, [k]: Math.min(40, Math.max(0, Math.round(Number(m[k]) || 0))) }))}
                    className="h-9 w-[3rem] text-sm"
                    title={`页面${zh}边距 mm`}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{elements.length} 个元素</span>

            <div className="flex items-center gap-0.5 rounded-md border border-border bg-background px-0.5 py-0.5">
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={historyPast.current.length === 0} onClick={undo} title="撤销 (Ctrl+Z)">
                <Undo2 className="size-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={historyFuture.current.length === 0} onClick={redo} title="重做 (Ctrl+Shift+Z / Ctrl+Y)">
                <Redo2 className="size-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={selectedIds.length === 0} onClick={() => duplicateGroup(selectedIds)} title="复制选中元素 (Ctrl+D)">
                <Copy className="size-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5">
              <span className="text-[10px] text-muted-foreground px-0.5">画布</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={editorZoom <= EDITOR_ZOOM_MIN + 1e-6}
                onClick={() => setEditorZoom(z => clampEditorZoom(z - EDITOR_ZOOM_STEP))}
                title="缩小"
              >
                <ZoomOut className="size-3.5" />
              </Button>
              <span className="min-w-[2.75rem] text-center text-[11px] text-muted-foreground">
                {Math.round(editorZoom * 100)}%
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={editorZoom >= EDITOR_ZOOM_MAX - 1e-6}
                onClick={() => setEditorZoom(z => clampEditorZoom(z + EDITOR_ZOOM_STEP))}
                title="放大"
              >
                <ZoomIn className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-[10px]"
                onClick={() => setEditorZoom(1)}
                title="100%"
              >
                重置
              </Button>
            </div>

            <Button
              size="sm"
              variant={preview ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => { setPreview(p => !p); setSelectedIds([]) }}
            >
              {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {preview ? '退出预览' : '预览'}
            </Button>

            <Button size="sm" onClick={handleSave} disabled={isPending} className="gap-1.5">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!preview && (
            <PalettePanel
              fields={paletteFields}
              hint={isZplLabelType(type) ? '拖拽条码或文字到画布' : undefined}
              onDragStart={handlePaletteDragStart}
            />
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-muted/40 p-6 gap-4">
            {preview && (
              <div className="mx-auto flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
                <Eye className="size-3.5" />
                预览模式 — 示例数据
              </div>
            )}
            {!preview && (
              <p className="mx-auto text-xs text-muted-foreground text-center max-w-xl">
                {isZplLabelType(type)
                  ? '从左侧拖拽字段到画布 · 打印时按毫米坐标生成 ZPL · 工具栏可放大画布 · '
                  : '从左侧拖拽字段到画布 · 点击选中元素后可拖动位置或在右侧修改属性 · 工具栏可放大画布 · '}
                <kbd className="rounded border px-1">Delete</kbd> 删除
              </p>
            )}

            <div
              ref={canvasRef}
              style={{ width: canvasW, height: canvasH, position: 'relative' }}
              className={`mx-auto shrink-0 bg-white shadow-xl ring-1 ring-border/30 ${!preview ? 'cursor-crosshair' : ''}`}
              onDragOver={handleCanvasDragOver}
              onDrop={handleCanvasDrop}
              onClick={() => { if (!draggingElId.current) setSelectedIds([]) }}
            >
              {!preview && (
                <svg
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <pattern id={`grid-${gridPatternUid}`} width={5 * canvasScale} height={5 * canvasScale} patternUnits="userSpaceOnUse">
                      <path d={`M ${5 * canvasScale} 0 L 0 0 0 ${5 * canvasScale}`} fill="none" stroke="hsl(var(--muted-foreground)/0.12)" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill={`url(#grid-${gridPatternUid})`} />
                </svg>
              )}

              {/* 单据打印安全区：按页面边距（mm）提示避让打印机不可打印区，避免边缘裁切 */}
              {!preview && !isZplLabelType(type) && (
                <div style={{
                  position: 'absolute',
                  top: margins.top * canvasScale,
                  bottom: margins.bottom * canvasScale,
                  left: margins.left * canvasScale,
                  right: margins.right * canvasScale,
                  border: '1px dashed rgba(236,72,153,0.35)',
                  pointerEvents: 'none', zIndex: 1,
                }} />
              )}

              {isZplLabelType(type) && preview ? (
                <LabelPreviewOverlay
                  layout={{ elements, canvasWidthMm: safeCw, canvasHeightMm: safeCh }}
                  data={previewData}
                  paperSize={labelPaperSize}
                  scale={canvasScale}
                />
              ) : (
                elements.map(el => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    selected={selectedIds.includes(el.id)}
                    preview={preview}
                    previewData={previewData}
                    scale={canvasScale}
                    isLabel={isZplLabelType(type)}
                    onMouseDown={e => handleElementMouseDown(e, el)}
                    onClick={e => { e.stopPropagation() }}
                    onResizeStart={(e, dir) => handleResizeMouseDown(e, el, dir)}
                  />
                ))
              )}

              {!preview && guides.x.map((gx, i) => (
                <div key={`gx${i}`} style={{ position: 'absolute', left: gx * canvasScale, top: 0, width: 1, height: '100%', background: '#ec4899', zIndex: 30, pointerEvents: 'none' }} />
              ))}
              {!preview && guides.y.map((gy, i) => (
                <div key={`gy${i}`} style={{ position: 'absolute', top: gy * canvasScale, left: 0, height: 1, width: '100%', background: '#ec4899', zIndex: 30, pointerEvents: 'none' }} />
              ))}

              {elements.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 pointer-events-none">
                  <Table2 className="size-10" />
                  <p className="text-sm">从左侧拖拽字段到这里</p>
                </div>
              )}
            </div>

            <p className="mx-auto text-xs text-muted-foreground">
              {paper.label} · {paper.w} × {paper.h} mm
            </p>
          </div>

          {!preview && (
            <PropertiesPanel
              el={selected}
              multiCount={selectedIds.length}
              isLabel={isZplLabelType(type)}
              onChange={patchElement}
              onDelete={deleteElement}
              onDeleteMulti={deleteSelectedGroup}
              onAlign={alignSelectedToCanvas}
              onDistribute={distributeSelected}
            />
          )}
        </div>
      </div>

    </div>
  )
}
