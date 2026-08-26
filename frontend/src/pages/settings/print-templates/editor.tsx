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
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import {
  Save, Eye, EyeOff, Trash2, Loader2, X,
  AlignLeft, AlignCenter, AlignRight, Bold,
  Table2, Type, SeparatorHorizontal, Barcode, RotateCcw,
  ZoomIn, ZoomOut, Undo2, Redo2, Copy,
  Image as ImageIcon,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  ChevronUp, ChevronDown, ArrowLeft,
} from 'lucide-react'
import { getLogoApi } from '@/api/settings'

type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'
import { getPrintTemplateDetailApi, createPrintTemplateApi, updatePrintTemplateApi } from '@/api/print-templates'
import { confirmAction } from '@/lib/confirm'
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

/**
 * 属性数字输入的安全读取（评审 P1 修复）：
 * 空字符串/非法字符 → 返回 ''（不写 NaN 进 state，NaN 会让元素永久不可点选）；
 * 合法数值 → 钳制到 [min, max] 后写回。
 */
function numInputValue(raw: string, min: number, max: number): string {
  if (raw.trim() === '') return ''
  const n = Number(raw)
  if (!Number.isFinite(n)) return ''
  return String(clampVal(n, min, max))
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
  { value: 10, label: '库位条码标签 (画布)' },
]

function isZplLabelType(t: number): t is 5 | 6 | 7 | 8 | 9 | 10 {
  return t >= 5 && t <= 10
}

/** 字段类型 → 面板图标映射（字段元数据不混入 JSX，见 printFieldDefs.ts） */
function fieldIcon(f: PrintFieldDef): React.ReactNode {
  switch (f.type) {
    case 'barcode': return <Barcode className="size-3.5" />
    case 'table':   return <Table2 className="size-3.5" />
    case 'divider': return <SeparatorHorizontal className="size-3.5" />
    case 'image':   return <ImageIcon className="size-3.5" />
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
  // image（公司 Logo）：不参与字体渲染（fontSize/对齐/边框走中性默认），src 固定取自系统 Logo
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
  // 标签（5-9）：字高用 mm、去加粗、默认不显前缀
  if (isLabel) {
    return { ...base, fontWeight: 'normal', showLabel: false, fontHeightMm: field.type === 'title' ? 5 : 3.5 }
  }
  // 单据 image：中性默认，避免属性面板/预览出现字体语义
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
  layers,
  selectedIds,
  onSelectLayer,
  onMoveLayer,
  onDeleteLayer,
  showLayers,
}: {
  fields: PrintFieldDef[]
  hint?: string
  onDragStart: (field: PrintFieldDef) => void
  /** 图层列表（= elements 数组，渲染顺序即 z 序；评审 P2） */
  layers: TemplateElement[]
  selectedIds: string[]
  onSelectLayer: (id: string, additive: boolean) => void
  onMoveLayer: (id: string, dir: -1 | 1) => void
  onDeleteLayer: (id: string) => void
  showLayers: boolean
}) {
  return (
    <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r bg-muted/20">
      <div className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">字段列表</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint ?? '拖拽字段到画布'}</p>
      </div>
      {showLayers ? (
        <>
          <div className="max-h-[42%] overflow-y-auto p-3 space-y-1">
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
          {/* 元素图层（评审 P2）：列表点击选中、上下移动调 z 序、× 删除——重叠元素不再只能「删了重加」 */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/60">
            <div className="px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">元素图层</p>
              <p className="mt-0.5 text-xs text-muted-foreground">越靠上越先绘制（可重叠置顶置底）</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 space-y-1">
              {layers.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  画布上暂无元素
                </div>
              )}
              {layers.map((el, idx) => (
                <div
                  key={el.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                    selectedIds.includes(el.id)
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-primary/40'
                  }`}
                  onClick={(e) => onSelectLayer(el.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                >
                  <span className="w-5 shrink-0 text-center text-[10px] text-muted-foreground/70">{idx + 1}</span>
                  <span className="shrink-0">{fieldIcon({ key: el.fieldKey, label: el.label, type: el.type === 'image' ? 'image' : el.type === 'barcode' ? 'barcode' : el.type === 'table' ? 'table' : el.type === 'divider' ? 'divider' : 'text' })}</span>
                  <span className="min-w-0 flex-1 truncate">{el.label || el.fieldKey}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                    title="上移（更早绘制，垫底）"
                    aria-label={`上移元素 ${el.label || el.fieldKey}`}
                    disabled={idx === 0}
                    onClick={(e) => { e.stopPropagation(); onMoveLayer(el.id, -1) }}
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                    title="下移（更晚绘制，置顶）"
                    aria-label={`下移元素 ${el.label || el.fieldKey}`}
                    disabled={idx === layers.length - 1}
                    onClick={(e) => { e.stopPropagation(); onMoveLayer(el.id, 1) }}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive"
                    title="删除元素"
                    aria-label={`删除元素 ${el.label || el.fieldKey}`}
                    onClick={(e) => { e.stopPropagation(); onDeleteLayer(el.id) }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
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
      )}
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
  /** 评审 P1（可达性）：Tab 聚焦元素时通知父组件选中它（键盘用户可 Tabbing 选择元素） */
  onFocusSelect: (id: string) => void
  /** 表格列宽拖拽开始（选中表格元素时，列分隔线可拖；cell 需 position:relative 挂手柄） */
  onColumnResizeStart: (e: React.MouseEvent, colKey: string) => void
}

function ElementNode({ el, selected, preview, previewData, scale, isLabel, onMouseDown, onClick, onResizeStart, onFocusSelect, onColumnResizeStart }: ElementNodeProps) {
  const px = (mm: number) => mm * scale
  // 评审修复（P1 ①）：编辑预览的文本显示与打印端（TemplateRenderer）保持一致——
  // 打印端单据模板无条件拼「label：value」前缀；预览若不显示，用户会以为没有前缀。
  // 旧实现 sampleVal = previewData[fieldKey] ?? label 不显示前缀，是「预览≠打印」的第一处。

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
  if (el.type === 'image') {
    // 公司 Logo：预览态取系统 Logo URL 渲染图片；编辑态（或未上传）显示占位提示
    const src = previewData[el.fieldKey] ?? ''
    content = preview && src ? (
      <img
        src={src}
        alt={el.label}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        draggable={false}
      />
    ) : (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <ImageIcon className="size-3" />
        {el.label}{src ? '' : '（未上传）'}
      </span>
    )
  } else if (el.type === 'divider') {
    content = <div className="h-px w-full bg-current" style={{ marginTop: px(el.height) / 2 - 0.5 }} />
  } else if (el.type === 'barcode') {
    const v = (previewData[el.fieldKey] ?? '') || el.label
    content = preview
      ? <div style={{ width: '100%', height: '100%', padding: '1px 2px' }}>
          <BarcodePreview value={v} symbology={el.barcodeSymbology} hri={el.barcodeHRI} />
        </div>
      : <span className="text-muted-foreground">{el.label}（{el.barcodeSymbology === 'ean13' ? 'EAN13' : '条码'}）</span>
  } else if (el.type === 'table') {
    const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
    // 序号列可显隐（showIndex 缺省 true 兼容旧模板）；与 TemplateRenderer.FlowTable 同口径
    const showIndex = el.showIndex !== false
    const allCols = showIndex ? ['#', ...cols] : cols
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
            {colDefs.map((c, ci) => (
              <th key={c.key} style={{ ...cellStyle, position: 'relative', width: `${widthMmOf(c.key) * scale}px`, background: '#f5f5f5', fontWeight: 'bold' }}>
                {c.label}
                {/* 列宽拖动手柄（评审增强）：选中表格元素时，列分隔线可拖动调宽（写入 tableColumnWidths，与属性面板双向同步） */}
                {!preview && selected && ci < colDefs.length - 1 && (
                  <span
                    className="absolute top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30"
                    style={{ right: -3, zIndex: 5 }}
                    title="拖动调整列宽"
                    aria-label={`调整列宽：${c.label}`}
                    onMouseDown={e => { e.stopPropagation(); onColumnResizeStart(e, c.key) }}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(preview ? DOC_PREVIEW_ITEMS : DOC_PREVIEW_ITEMS.slice(0, 2)).map((row, i) => (
            <tr key={i}>
              {allCols.map(k => {
                const raw = k === '#' ? String(i + 1) : (row as Record<string, string>)[k] ?? ''
                // 名称列 + nameAttrs：与 TemplateRenderer.nameValue 同口径（拼接附加信息，不再独立成列）
                const cell = k === 'name' && el.nameAttrs?.length
                  ? (() => {
                      const parts = el.nameAttrs.map(a => (row as Record<string, string>)[a] ?? '').filter(v => String(v).trim() !== '')
                      return parts.length ? `${raw} [${parts.join('] [')}]` : raw
                    })()
                  : raw
                return <td key={k} style={{ ...cellStyle, width: `${widthMmOf(k) * scale}px` }}>{cell}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else {
    // text / title。标签预览用等宽字体，近似热敏打印机点阵字的字宽
    // 单据 text：预览与打印端一致——灰色 label 前缀 + 正常字色 value（打印端 renderer 的
    // label 前缀恒显示；title 无前缀、取值失败回退 label，与打印端 title 分支一致）
    const docText = previewData[el.fieldKey] ?? ''
    const isDocTitle = !isLabel && el.type === 'title'
    content = preview
      ? <span
          className={!isLabel && el.type === 'title' ? 'font-semibold' : undefined}
          style={isLabel ? { fontFamily: "'Courier New', monospace" } : undefined}
        >
          {isLabel ? labelText(el, previewData) : isDocTitle ? (docText || el.label) : (
            <>
              {el.label && <span style={{ color: '#888', fontSize: '0.9em' }}>{el.label}：</span>}
              <span>{docText}</span>
            </>
          )}
        </span>
      : <span className="text-muted-foreground">{el.label}</span>
  }

  return (
    <div
      style={style}
      tabIndex={preview ? -1 : 0}
      role={preview ? undefined : 'button'}
      aria-label={preview ? undefined : `元素：${el.label || el.fieldKey}（Enter/空格选中，方向键微调，Delete 删除）`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      // 评审 P1（可达性）：Tab 到元素时自动选中，Enter/Space 亦选中——键盘用户不再被锁在画布外
      onFocus={(e) => {
        if (preview || e.target !== e.currentTarget) return
        onFocusSelect(el.id)
      }}
      onKeyDown={(e) => {
        if (preview) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onFocusSelect(el.id)
        }
      }}
    >
      {content}
      {!preview && selected && <ResizeHandles onStart={onResizeStart} />}
    </div>
  )
}

interface LabelPreviewOverlayProps {
  /** 标签元素（评审次要项：由父组件拆分传入，layout 对象不再每次新建，useMemo 依赖可稳定比较） */
  elements: TemplateElement[]
  canvasWidthMm: number
  canvasHeightMm: number
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
function LabelPreviewOverlay({ elements, canvasWidthMm, canvasHeightMm, data, paperSize, scale }: LabelPreviewOverlayProps) {
  const resolved = useMemo(
    () => resolveLayout({ elements, canvasWidthMm, canvasHeightMm }, data, paperSize),
    [elements, canvasWidthMm, canvasHeightMm, data, paperSize]
  )
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
  /** 画布尺寸（mm）：单据=纸张宽高；标签=画布宽高。位置/尺寸输入的上界据此钳制 */
  canvasW: number
  canvasH: number
  onChange: (id: string, patch: Partial<TemplateElement>) => void
  /** 切换类字段（showIndex/tableRowWrap）函数式更新：连点不卡死（Bug 修复） */
  onToggle: (id: string, key: 'showIndex' | 'tableRowWrap') => void
  /** 文本输入结束回调（onBlur）：一次文本编辑合并为一个 undo 条目（评审次要项） */
  onEndTextEdit: (id: string) => void
  onDelete: (id: string) => void
  /** 多选删除整组 */
  onDeleteMulti: () => void
  onAlign: (dir: AlignDir) => void
  onDistribute: (dir: 'horizontal' | 'vertical') => void
}

function PropertiesPanel({ el, multiCount, isLabel, canvasW, canvasH, onChange, onToggle, onEndTextEdit, onDelete, onDeleteMulti, onAlign, onDistribute }: PropertiesPanelProps) {
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
                <Button key={dir} size="sm" variant="outline" className="p-0" title={title} aria-label={`对齐：${title}`}
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
                disabled={multiCount < 3} onClick={() => onDistribute('vertical')} aria-label="垂直等距分布">
                <AlignVerticalSpaceAround className="size-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="p-0" title="水平等距"
                disabled={multiCount < 3} onClick={() => onDistribute('horizontal')} aria-label="水平等距分布">
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

  // 属性面板数字输入的钳制范围（评审 P1 修复）——位置/尺寸必须落在画布内
  const num = (v: unknown) => typeof v === 'number' ? v : 0
  // 位置/尺寸输入的钳制范围见 numInputValue 调用处（A 系纸 210×297；标签长纸另有画布尺寸输入）
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
            onBlur={() => onEndTextEdit(el.id)}
            className="h-7 text-xs"
          />
          {el.type === 'image' && (
            <p className="text-xs leading-snug text-muted-foreground">
              图片来源：系统设置 → 品牌标识（公司 Logo，未上传时不显示）
            </p>
          )}
        </div>

        {/* 位置和尺寸 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">位置与尺寸 (mm)</label>
          <div className="grid grid-cols-2 gap-1.5">
            {([['x', 'X', 0, canvasW], ['y', 'Y', 0, canvasH], ['width', '宽', 3, canvasW], ['height', '高', 3, canvasH]] as [keyof TemplateElement, string, number, number][]).map(([k, lbl, min, max]) => (
              <div key={k} className="flex items-center gap-1">
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{lbl}</span>
                <Input
                  type="number" min={min} max={max} step="1"
                  value={num(el[k])}
                  onChange={e => {
                    // 评审 P1 修复：空/非法输入不写 NaN；越界钳制到画布范围。
                    // 此前无任何防护，输 -20 → 元素飞出画布、9999 → 原样保存、NaN → 永久不可点选。
                    const v = numInputValue(e.target.value, min, max)
                    if (v === '') return // 留空不写（用户正在输入）
                    onChange(el.id, { [k]: +v })
                  }}
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
                role="switch" aria-checked={el.barcodeHRI !== false} aria-label="显示可读数字"
                onClick={() => onChange(el.id, { barcodeHRI: el.barcodeHRI === false })}
              >
                <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.barcodeHRI !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}

        {/* 字体（条码区高度由「高」控制，影响打印条码条高；image 不参与字体） */}
        {el.type !== 'divider' && el.type !== 'barcode' && el.type !== 'image' && (
          isLabel ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">字高 (mm)</label>
              <Input
                type="number" min="1" max="30" step="0.5"
                value={labelFontMm(el)}
                onChange={e => {
                  const v = numInputValue(e.target.value, 1, 30)
                  if (v === '') return
                  onChange(el.id, { fontHeightMm: +v })
                }}
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
                    onChange={e => {
                      const v = numInputValue(e.target.value, 6, 72)
                      if (v === '') return
                      onChange(el.id, { fontSize: +v })
                    }}
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
              role="switch" aria-checked={el.showLabel} aria-label="显示标签：前缀"
              onClick={() => onChange(el.id, { showLabel: !el.showLabel })}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.showLabel ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}

        {/* 对齐（image 为图片，不做文本对齐） */}
        {el.type !== 'divider' && el.type !== 'barcode' && el.type !== 'image' && (
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
              role="switch" aria-checked={el.border} aria-label="显示边框"
              onClick={() => onChange(el.id, { border: !el.border })}
            >
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.border ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}

        {/* 表格列 */}
        {el.type === 'table' && (
          <div className="space-y-3">
            {/* 序号列显隐（评审增强：可显示/隐藏） */}
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">显示序号列</label>
              <button
                className={`relative h-5 w-9 rounded-full transition-colors ${el.showIndex !== false ? 'bg-primary' : 'bg-input'}`}
                role="switch" aria-checked={el.showIndex !== false} aria-label="显示序号列"
                onClick={() => onToggle(el.id, 'showIndex')}
              >
                <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${el.showIndex !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {/* 名称列后拼接（颜色/型号/单位/货号）：勾选的字段不再独立成列，自动排在名称后面 */}
            {(el.tableColumns ?? ['name', 'qty', 'price', 'amount']).includes('name') && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">名称后附加信息</label>
                <div className="flex flex-wrap gap-1.5">
                  {(['color', 'spec', 'unit', 'articleNo'] as const).map(key => {
                    const def = TABLE_COLUMN_OPTIONS.find(c => c.key === key) ?? { key, label: key }
                    const checked = (el.nameAttrs ?? []).includes(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => {
                          const next = checked
                            ? (el.nameAttrs ?? []).filter(k => k !== key)
                            : [...(el.nameAttrs ?? []), key]
                          onChange(el.id, { nameAttrs: next })
                        }}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          checked
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        {def.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground">勾选后拼接在商品名称后（如「商品A [黑色] [500g] [件]」），不再作为独立列。</p>
              </div>
            )}

            {/* 已选列：按打印顺序显示（可上下移调序、取消勾选移除、设列宽 mm） */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">表格列（打印顺序）</label>
              {(el.tableColumns ?? []).map((key, idx) => {
                const def = TABLE_COLUMN_OPTIONS.find(c => c.key === key) ?? { key, label: key, align: 'left' as const }
                const colW = (el.tableColumnWidths ?? {})[key]
                return (
                  <div key={key} className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                      title="向左调整顺序"
                      aria-label={`上移列 ${def.label}`}
                      disabled={idx === 0}
                      onClick={() => {
                        const cols = el.tableColumns ?? []
                        const next = [...cols]
                        ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                        onChange(el.id, { tableColumns: next })
                      }}
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                      title="向右调整顺序"
                      aria-label={`下移列 ${def.label}`}
                      disabled={idx === (el.tableColumns ?? []).length - 1}
                      onClick={() => {
                        const cols = el.tableColumns ?? []
                        const next = [...cols]
                        ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                        onChange(el.id, { tableColumns: next })
                      }}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => {
                          const cols = el.tableColumns ?? []
                          const widths = { ...(el.tableColumnWidths ?? {}) }
                          delete widths[key]
                          onChange(el.id, { tableColumns: cols.filter(c => c !== key), tableColumnWidths: widths })
                        }}
                        className="size-3"
                      />
                      <span className="min-w-0 flex-1 truncate">{def.label}</span>
                    </label>
                    <Input
                      type="number" min="0" step="1"
                      placeholder="均分"
                      value={colW ?? ''}
                      onChange={e => {
                        const v = e.target.value === '' ? undefined : +e.target.value
                        const widths = { ...(el.tableColumnWidths ?? {}) }
                        if (v != null && Number.isFinite(v) && v > 0) widths[key] = v
                        else delete widths[key]
                        onChange(el.id, { tableColumnWidths: widths })
                      }}
                      className="h-6 w-14 text-xs"
                    />
                  </div>
                )
              })}
              {(el.tableColumns ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">尚未选择任何列，请在下方添加</p>
              )}
            </div>

            {/* 未选列：可勾选追加到末尾 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">添加列</label>
              <div className="flex flex-wrap gap-1.5">
                {TABLE_COLUMN_OPTIONS.filter(col => !(el.tableColumns ?? []).includes(col.key)).map(col => (
                  <button
                    key={col.key}
                    type="button"
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    onClick={() => onChange(el.id, { tableColumns: [...(el.tableColumns ?? []), col.key] })}
                  >
                    + {col.label}
                  </button>
                ))}
              </div>
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
              <p className="text-xs leading-snug text-muted-foreground">
                注：打印时表格高度随明细行数自动撑开（画布上的「高」仅用于预览排布示意）。
              </p>
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
                  role="switch" aria-checked={el.tableRowWrap !== false} aria-label="表格自动换行"
                  onClick={() => onToggle(el.id, 'tableRowWrap')}
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

  // 公司 Logo（image 元素预览用）：与 BrandLogo/设置页共享查询键，上传后 invalidate 即刷新
  const { data: brandLogo } = useQuery({
    queryKey: ['brand-logo'],
    queryFn: () => getLogoApi({ skipGlobalError: true }),
    staleTime: 5 * 60_000,
    retry: 1,
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
  /** 用户手动缩放后暂停自适应（fit 由「适应画布」按钮/初始化触发；手动调回可再触发） */
  const manualZoomRef = useRef(false)
  /** 拖动时的对齐参考线（mm 坐标），松手清空 */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  /** 框选（marquee，评审 P2）：空白处拖动选择多个元素 */
  const [marqueeActive, setMarqueeActive] = useState(false)
  const [marqueeRect, setMarqueeRect] = useState({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  /** 框选刚完成（onMouseUp 已处理选中），抑制随后的 onClick 清空（评审 P2：框选与点击不互斥） */
  const marqueeJustSelectingRef = useRef(false)

  // 最新状态引用（ref 读取不参与 hooks 依赖），供 snapshot/undo/redo/拖动回调/脏检测读取，规避 stale closure
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const nameRef = useRef(name)
  nameRef.current = name
  const typeRef = useRef(type)
  typeRef.current = type
  const paperSizeRef = useRef(paperSize)
  paperSizeRef.current = paperSize
  const canvasWidthMmRef = useRef(canvasWidthMm)
  canvasWidthMmRef.current = canvasWidthMm
  const canvasHeightMmRef = useRef(canvasHeightMm)
  canvasHeightMmRef.current = canvasHeightMm
  const marginsRef = useRef(margins)
  marginsRef.current = margins
  const snapshotRefs = useRef({ type, paperSize, canvasWidthMm, canvasHeightMm, margins })
  snapshotRefs.current = { type, paperSize, canvasWidthMm, canvasHeightMm, margins }

  /** 未保存检测基准：水合完成时快照（评审 P1 修复） */
  const cleanSnapshotRef = useRef<CleanSnapshot | null>(null)

  // 保存成功后基准前移（视作已保存）：水合时也调用重置基准
  const markClean = useCallback(() => {
    cleanSnapshotRef.current = {
      name: nameRef.current,
      type: typeRef.current,
      paperSize: paperSizeRef.current,
      canvasWidthMm: canvasWidthMmRef.current,
      canvasHeightMm: canvasHeightMmRef.current,
      margins: { ...marginsRef.current },
      elements: elementsRef.current,
    }
  }, [])

  // ── 未保存检测（评审 P1 修复）──────────────────────────────
  // 与干净基准逐字段比对（元素量小，JSON 序列化比较可靠；渲染期直接算，不 useMemo——
  // 基准存在 ref 里，依赖数组无法表达，包 useMemo 反而因依赖恒新恒重算，失去意义）
  let isDirty = false
  {
    const clean = cleanSnapshotRef.current
    if (clean) {
      const s = snapshotRefs.current
      isDirty = (
        nameRef.current !== clean.name ||
        typeRef.current !== clean.type ||
        paperSizeRef.current !== clean.paperSize ||
        canvasWidthMmRef.current !== clean.canvasWidthMm ||
        canvasHeightMmRef.current !== clean.canvasHeightMm ||
        JSON.stringify(s.margins) !== JSON.stringify(clean.margins) ||
        JSON.stringify(elementsRef.current) !== JSON.stringify(clean.elements)
      )
    }
  }
  useDirtyGuard(tabPath, isDirty)

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
      // 评审 P1 修复：水合完成即记录「干净基准」——任何偏离都算未保存（表单离开保护）。
      // 基准直接从 remote 构造（不依赖状态 ref 的时序）：这里的 setState 是同一批次的，
      // 后续渲染里 refs 才同步；直接读 remote 才是最可靠的「保存态」事实。
      cleanSnapshotRef.current = {
        name: remote.name,
        type: remote.type,
        paperSize: remote.paperSize,
        canvasWidthMm: isZplTemplateLayout(remote.layout)
          ? (isZplLabelType(remote.type) ? 75 : 80)
          : typeof (remote.layout as { canvasWidthMm?: number }).canvasWidthMm === 'number'
            ? Number((remote.layout as { canvasWidthMm?: number }).canvasWidthMm)
            : 75,
        canvasHeightMm: isZplTemplateLayout(remote.layout)
          ? (isZplLabelType(remote.type) ? 50 : 200)
          : typeof (remote.layout as { canvasHeightMm?: number }).canvasHeightMm === 'number'
            ? Number((remote.layout as { canvasHeightMm?: number }).canvasHeightMm)
            : 50,
        margins: (() => {
          if (isZplTemplateLayout(remote.layout)) return { top: 8, bottom: 8, left: 0, right: 0 }
          const m = (remote.layout as { margins?: PrintPageMargins }).margins
          return {
            top: Number.isFinite(m?.top) ? (m?.top as number) : 8,
            bottom: Number.isFinite(m?.bottom) ? (m?.bottom as number) : 8,
            left: Number.isFinite(m?.left) ? (m?.left as number) : 0,
            right: Number.isFinite(m?.right) ? (m?.right as number) : 0,
          }
        })(),
        elements: isZplTemplateLayout(remote.layout) ? cloneDefaultLabelElements(remote.type) : (remote.layout.elements ?? []),
      }
      bumpHist(v => v + 1) // 触发重渲染刷新 isDirty
    }
  }, [remote, hydrated, id, markClean])

  function handleTypeChange(v: string) {
    const next = +v as TemplateType
    const prev = type
    if (next === prev) return
    // P0（评审）修复：类型切换会整体重建画布元素——若已有元素（含默认布局残留），
    // 先确认再重建，且切换本身入 undo 栈（此前是"唯一丢全部工作且不可逆"的操作）
    const doSwitch = () => {
      snapshot()
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
    // 有内容且类型在「单据↔标签」之间切换（重建语义）时确认；纯表单内部无元素不打扰
    const rebuilding = isZplLabelType(prev) !== isZplLabelType(next) || elements.length > 0
    if (rebuilding && !isNew) {
      confirmAction({
        title: `切换到「${TEMPLATE_TYPES.find(t => t.value === next)?.label ?? next}」`,
        description: isZplLabelType(next) !== isZplLabelType(prev)
          ? '单据模板与标签模板的画布结构不同，切换将重建画布（当前元素会被清空）。此操作可撤销（Ctrl+Z）。'
          : '切换模板类型将重建该类型的默认画布布局（当前元素会被清空）。此操作可撤销（Ctrl+Z）。',
        confirmText: '切换并重建',
        variant: 'default',
        onConfirm: doSwitch,
      })
    } else {
      doSwitch()
    }
  }

  // ── Drag state refs ──────────────────────────────────────────
  const canvasRef      = useRef<HTMLDivElement>(null)
  /** 画布滚动列（ResizeObserver 自动 fit 用；修复「属性面板挡住画布」——窄视口下自动缩小整图可见） */
  const canvasColRef   = useRef<HTMLDivElement>(null)
  const draggingField  = useRef<PrintFieldDef | null>(null)   // palette → canvas drag
  const draggingElId   = useRef<string | null>(null)      // element move drag
  const dragStartMouse = useRef({ x: 0, y: 0 })
  /** 文本输入合并 undo（评审次要项）：label 输入首次击键 snapshot 一次，结束（onBlur）即标记完成——
   * 一次文本编辑 = 一个 undo 条目，而非每字符一条 */
  const textEditingRef = useRef<{ id: string; active: boolean }>({ id: '', active: false })

  // ── Save mutations ───────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createPrintTemplateApi,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['print-templates'] })
      toast.success('模板已保存')
      markClean() // 评审 P1：保存后基准前移（取消未保存状态）
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
      markClean() // 评审 P1：保存后基准前移（取消未保存状态）
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

  /** 自动适应（修复「属性面板挡住画布」）：画布列变窄（窗口/面板变化）时，未手动缩放则把图纸缩到整图可见 */
  useEffect(() => {
    const col = canvasColRef.current
    if (!col) return
    const fit = () => {
      if (manualZoomRef.current) return
      const availW = col.clientWidth - 48 // 两侧 p-6 各 24px
      if (availW <= 0) return
      const fullW = paper.w * MM_PX
      if (fullW <= availW) {
        // 装得下：若当前小于 100%（之前被压小过），恢复 100% 避免长期模糊
        setEditorZoom(z => (z < 1 ? 1 : z))
        return
      }
      const fitZoom = Math.max(EDITOR_ZOOM_MIN, Math.min(1, availW / fullW))
      // 双向 fit：超出 → 缩到 fitZoom；小于（窗口变大）→ 升到 fitZoom，跟随列宽
      setEditorZoom(z => {
        const r = Math.round(fitZoom * 100) / 100
        if (z > r || z < r - 0.02) return r
        return z
      })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(col)
    // 窗口 resize 兜底（ResizeObserver 对 flex 布局列宽变化可能滞后/不触发）
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [paper.w])
  // 单据类型（1-4）只用 A 系纸；热敏纸归标签类型（用 mm 输入），不在此下拉出现
  const paperSelectEntries = Object.entries(PAPER_SIZES).filter(([k]) => !k.startsWith('thermal'))

  /** 单选（属性面板用）：多选时取第一个 */
  const selected = selectedIds.length === 0
    ? null
    : elements.find(e => e.id === selectedIds[0]) ?? null

  const paletteFields = isZplLabelType(type) ? (LABEL_FIELD_DEFS_BY_TYPE[type] ?? []) : DOC_FIELD_DEFS
  const previewData: Record<string, string> = isZplLabelType(type)
    ? { ...(LABEL_PREVIEW_SAMPLE[type] ?? {}) }
    : { ...DOC_PREVIEW_SAMPLE, companyLogo: brandLogo?.url ?? '', printDate: formatDisplayDateTime(new Date()) }

  // ── Undo / redo history ──────────────────────────────────────
  // 快照为全量 EditorSnapshot（elements + type + 纸张 + 画布 + 边距）：
  // P0 修复后类型切换也入 undo 栈，若只存 elements，undo 回来时 type/纸张还停在切换后，
  // 元素与类型会错乱。全量快照让任何操作都可一致回退。
  interface EditorSnapshot {
    elements: TemplateElement[]
    type: TemplateType
    paperSize: PaperSize
    canvasWidthMm: number
    canvasHeightMm: number
    margins: PrintPageMargins
    /** 撤销保持选中（评审次要项）：记录选中 id，恢复时沿用仍存在的元素 */
    selectedIds: string[]
  }
  /** 未保存检测基准（不含 selectedIds——单纯选中不算脏） */
  interface CleanSnapshot {
    name: string
    type: TemplateType
    paperSize: PaperSize
    canvasWidthMm: number
    canvasHeightMm: number
    margins: PrintPageMargins
    elements: TemplateElement[]
  }
  // 最新状态引用已在顶部声明（ref 读取不参与 hooks 依赖）
  const historyPast = useRef<EditorSnapshot[]>([])
  const historyFuture = useRef<EditorSnapshot[]>([])
  const [, bumpHist] = useState(0)

  const currentSnapshot = useCallback((): EditorSnapshot => {
    const s = snapshotRefs.current
    return {
      elements: elementsRef.current,
      type: s.type,
      paperSize: s.paperSize,
      canvasWidthMm: s.canvasWidthMm,
      canvasHeightMm: s.canvasHeightMm,
      margins: { ...s.margins },
      selectedIds: selectedIdsRef.current,
    }
  }, [])

  const restoreSnapshot = useCallback((snap: EditorSnapshot) => {
    setElements(snap.elements)
    setType(snap.type)
    setPaperSize(snap.paperSize)
    setCanvasWidthMm(snap.canvasWidthMm)
    setCanvasHeightMm(snap.canvasHeightMm)
    setMargins({ ...snap.margins })
    // 撤销保持选中（仅保留仍存在的元素 id，防选中已删元素）
    setSelectedIds(snap.selectedIds.filter(id => snap.elements.some(e => e.id === id)))
  }, [])

  /** 在改动「之前」调用：压入当前快照、清空 redo 栈 */
  const snapshot = useCallback(() => {
    historyPast.current.push(currentSnapshot())
    if (historyPast.current.length > 100) historyPast.current.shift()
    historyFuture.current = []
    bumpHist(v => v + 1)
  }, [currentSnapshot])
  const undo = useCallback(() => {
    if (!historyPast.current.length) return
    historyFuture.current.push(currentSnapshot())
    restoreSnapshot(historyPast.current.pop()!)
    bumpHist(v => v + 1)
  }, [currentSnapshot, restoreSnapshot])
  const redo = useCallback(() => {
    if (!historyFuture.current.length) return
    historyPast.current.push(currentSnapshot())
    restoreSnapshot(historyFuture.current.pop()!)
    bumpHist(v => v + 1)
  }, [currentSnapshot, restoreSnapshot])

  const clampEl = useCallback((el: TemplateElement): TemplateElement => {
    return {
      ...el,
      x: Math.max(0, Math.min(paper.w - el.width, el.x)),
      y: Math.max(0, Math.min(paper.h - el.height, el.y)),
    }
  }, [paper.w, paper.h])

  function patchElement(id: string, patch: Partial<TemplateElement>) {
    // 评审次要项：文本类（label）输入合并 undo——首次击键快照一次，同一元素连续输入不再快照，
    // onBlur（endTextEdit）重置标记。其余属性照旧每次快照。
    const isTextOnly = Object.keys(patch).length === 1 && 'label' in patch
    if (!isTextOnly || textEditingRef.current.id !== id || !textEditingRef.current.active) {
      if (isTextOnly) {
        textEditingRef.current = { id, active: true }
        snapshot()
      } else {
        snapshot()
      }
    }
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  /**
   * 切换类字段（开关按钮）的函数式更新（Bug 修复）：
   * 快速连点时 onClick 里的 `el` 是渲染时闭包（stale），两次点击从同一旧值计算 → 开关"点不动"。
   * 本函数在 setElements 的 prev 回调内判定当前值，批处理内每次点击都能翻转，最终态始终正确。
   * 语义：showIndex / tableRowWrap 为「缺省显示、false 显式关闭」（判定 !== false）。
   */
  function toggleElementField(id: string, key: 'showIndex' | 'tableRowWrap') {
    snapshot() // 一次点击 = 一个 undo 条目
    setElements(prev => prev.map(e => {
      if (e.id !== id) return e
      const next = e[key] === false ? true : false
      return { ...e, [key]: next } as TemplateElement
    }))
  }

  /** 文本输入结束（Input onBlur）：标记完成，下一次输入再次快照 */
  const endTextEdit = useCallback((id: string) => {
    if (textEditingRef.current.id === id) textEditingRef.current.active = false
  }, [])

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
      window.removeEventListener('blur', onWindowBlur)
    }

    // 评审次要项：Alt-Tab / 窗口失焦时结束拖动，避免监听器残留
    const onWindowBlur = () => onMouseUp()

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onWindowBlur)
  }

  // ── Element resize (drag handles) ────────────────────────────
  /**
   * 表格列宽拖拽（评审增强）：拖动列分隔线调整该列宽（mm）。
   * 其余显式列宽保持不变；未显式指定的列均分剩余宽度（与属性面板/打印端同一口径）。
   */
  function handleColumnResizeStart(e: React.MouseEvent, tableId: string, colKey: string) {
    if (preview) return
    e.preventDefault()
    e.stopPropagation()
    const tableEl = elementsRef.current.find(el => el.id === tableId)
    if (!tableEl) return
    setSelectedIds([tableId])
    const startX = e.clientX
    const startColW = (tableEl.tableColumnWidths ?? {})[colKey]
    // 初始宽度：显式优先；未显式则当前均分值（从 tableEl 计算）
    const cols = tableEl.tableColumns ?? ['name', 'qty', 'price', 'amount']
    const showIndex = tableEl.showIndex !== false
    const allCols = showIndex ? ['#', ...cols] : cols
    const colWm = tableEl.tableColumnWidths ?? {}
    const known = allCols.filter(k => { const w = colWm[k]; return w != null && Number.isFinite(w) && w > 0 })
    const used = known.reduce((s, k) => s + (colWm[k] as number), 0)
    const unknown = allCols.length - known.length
    const share = unknown > 0 ? Math.max(0, tableEl.width - used) / unknown : 0
    const initW = startColW ?? share ?? 10
    let moved = false

    function onMouseMove(me: MouseEvent) {
      if (!moved) { moved = true; snapshot() }
      const dxMm = (me.clientX - startX) / canvasScale
      const newW = Math.max(3, Math.min(tableEl!.width, initW + dxMm)) // 3mm 下限，不超表总宽
      setElements(prev => prev.map(p => p.id === tableId ? {
        ...p,
        tableColumnWidths: { ...(p.tableColumnWidths ?? {}), [colKey]: Math.round(newW) },
      } : p))
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onWindowBlur)
    }
    // 评审次要项：窗口失焦（Alt-Tab）结束拖拽，防监听器残留
    const onWindowBlur = () => onMouseUp()
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onWindowBlur)
  }

  function handleResizeMouseDown(e: React.MouseEvent, el: TemplateElement, dir: ResizeDir) {
    if (preview) return    e.preventDefault()
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
      window.removeEventListener('blur', onWindowBlur)
    }
    // 评审次要项：窗口失焦（Alt-Tab）结束缩放到松手态，防监听器残留
    const onWindowBlur = () => onMouseUp()
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onWindowBlur)
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
        description="从左侧拖入字段，在画布上点选/拖动/缩放调整版式（毫米坐标）；画布下方显示真实纸张尺寸，保存后打印以预览为准。"
        actions={
          // 评审次要项：保存后（尤其新建跳转）给返回列表出口
          <Button type="button" size="sm" variant="outline" onClick={() => navigate('/settings/print-templates')}>
            <ArrowLeft className="mr-1 size-4" />
            返回列表
          </Button>
        }
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
                onChange={e => {
                  const v = numInputValue(e.target.value, 30, 120)
                  if (v !== '') setCanvasWidthMm(+v)
                }}
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
                onChange={e => {
                  const v = numInputValue(e.target.value, 40, 500)
                  if (v !== '') setCanvasHeightMm(+v)
                }}
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
                  <span className="text-xs text-muted-foreground">{zh}</span>
                  <Input
                    type="number"
                    min={0}
                    max={40}
                    step={1}
                    value={margins[k]}
                    onChange={e => {
                      const v = numInputValue(e.target.value, 0, 40)
                      if (v !== '') setMargins(m => ({ ...m, [k]: +v }))
                    }}
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
                disabled={historyPast.current.length === 0} onClick={undo} title="撤销 (Ctrl+Z)" aria-label="撤销">
                <Undo2 className="size-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={historyFuture.current.length === 0} onClick={redo} title="重做 (Ctrl+Shift+Z / Ctrl+Y)" aria-label="重做">
                <Redo2 className="size-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={selectedIds.length === 0} onClick={() => duplicateGroup(selectedIds)} title="复制选中元素 (Ctrl+D)" aria-label="复制选中元素">
                <Copy className="size-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5">
              <span className="text-xs text-muted-foreground px-0.5">画布</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={editorZoom <= EDITOR_ZOOM_MIN + 1e-6}
                onClick={() => { manualZoomRef.current = true; setEditorZoom(z => clampEditorZoom(z - EDITOR_ZOOM_STEP)) }}
                title="缩小" aria-label="缩小画布"
              >
                <ZoomOut className="size-3.5" />
              </Button>
              <span className="min-w-[2.75rem] text-center text-xs text-muted-foreground">
                {Math.round(editorZoom * 100)}%
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={editorZoom >= EDITOR_ZOOM_MAX - 1e-6}
                onClick={() => { manualZoomRef.current = true; setEditorZoom(z => clampEditorZoom(z + EDITOR_ZOOM_STEP)) }}
                title="放大" aria-label="放大画布"
              >
                <ZoomIn className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-xs"
                onClick={() => { manualZoomRef.current = true; setEditorZoom(1) }}
                title="100%" aria-label="重置缩放"
              >
                重置
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-xs"
                onClick={() => {
                  // 「适应画布」：重新触发自动 fit（面板变窄后可一键恢复整图可见）
                  manualZoomRef.current = false
                  const col = canvasColRef.current
                  if (col) {
                    const availW = col.clientWidth - 48
                    const fullW = paper.w * MM_PX
                    if (fullW > availW && availW > 0) {
                      setEditorZoom(Math.max(EDITOR_ZOOM_MIN, Math.min(1, Math.round((availW / fullW) * 100) / 100)))
                    } else {
                      setEditorZoom(1)
                    }
                  }
                }}
                title="适应画布" aria-label="适应画布"
              >
                适应
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
              layers={elements}
              selectedIds={selectedIds}
              onSelectLayer={(id, additive) =>
                setSelectedIds(prev => additive
                  ? (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
                  : [id])
              }
              onMoveLayer={(id, dir) => {
                // 渲染顺序 = 数组顺序（后者覆盖前者）：-1 = 更早绘制（垫底），+1 = 更晚绘制（置顶）
                const idx = elements.findIndex(e => e.id === id)
                if (idx < 0) return
                const to = idx + dir
                if (to < 0 || to >= elements.length) return
                snapshot()
                setElements(prev => {
                  const next = [...prev]
                  const [moved] = next.splice(idx, 1)
                  next.splice(to, 0, moved)
                  return next
                })
              }}
              onDeleteLayer={id => deleteElement(id)}
              showLayers={!isZplLabelType(type)}
            />
          )}

          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-muted/40 p-6 gap-4"
            ref={canvasColRef}
          >
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
              // 框选（评审 P2）：空白处拖选多个元素。元素自身的 mousedown 已 stopPropagation，不会误触发
              onMouseDown={e => {
                if (preview || e.target !== e.currentTarget) return
                const rect = canvasRef.current!.getBoundingClientRect()
                marqueeStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
                setMarqueeActive(true)
                setSelectedIds([])
              }}
              onMouseMove={e => {
                if (!marqueeActive || !marqueeStartRef.current) return
                const rect = canvasRef.current!.getBoundingClientRect()
                const x = e.clientX - rect.left
                const y = e.clientY - rect.top
                const s = marqueeStartRef.current
                setMarqueeRect({
                  minX: Math.min(s.x, x), minY: Math.min(s.y, y),
                  maxX: Math.max(s.x, x), maxY: Math.max(s.y, y),
                })
              }}
              onMouseUp={e => {
                if (!marqueeActive || !marqueeStartRef.current) return
                setMarqueeActive(false)
                marqueeStartRef.current = null
                // 标记本次点击是“框选”而处理的，onClick 不再清空选中
                marqueeJustSelectingRef.current = true
                const rect = canvasRef.current!.getBoundingClientRect()
                const x = (e.clientX - rect.left) / canvasScale
                const y = (e.clientY - rect.top) / canvasScale
                const r = marqueeRect
                const minX = Math.min(r.minX / canvasScale, x)
                const maxX = Math.max(r.maxX / canvasScale, x)
                const minY = Math.min(r.minY / canvasScale, y)
                const maxY = Math.max(r.maxY / canvasScale, y)
                const hit = elementsRef.current
                  .filter(el => el.x + el.width >= minX && el.x <= maxX && el.y + el.height >= minY && el.y <= maxY)
                  .map(el => el.id)
                if (hit.length) setSelectedIds(hit)
              }}
              onClick={() => {
                if (marqueeJustSelectingRef.current) {
                  marqueeJustSelectingRef.current = false
                  return
                }
                if (!draggingElId.current) setSelectedIds([])
              }}
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
                  border: '1px dashed rgba(245,158,11,0.45)',
                  pointerEvents: 'none', zIndex: 1,
                }} />
              )}

              {isZplLabelType(type) && preview ? (
                <LabelPreviewOverlay
                  // 评审次要项：layout 对象字面量每渲染新建导致子组件 useMemo 恒失效，改为传原始 state 由子组件稳定化
                  elements={elements}
                  canvasWidthMm={safeCw}
                  canvasHeightMm={safeCh}
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
                    onFocusSelect={id => setSelectedIds(prev => prev.includes(id) ? prev : [...prev, id])}
                    onColumnResizeStart={(ev, colKey) => handleColumnResizeStart(ev, el.id, colKey)}
                  />
                ))
              )}

              {!preview && guides.x.map((gx, i) => (
                <div key={`gx${i}`} style={{ position: 'absolute', left: gx * canvasScale, top: 0, width: 1, height: '100%', background: 'hsl(var(--primary))', zIndex: 30, pointerEvents: 'none' }} />
              ))}
              {!preview && guides.y.map((gy, i) => (
                <div key={`gy${i}`} style={{ position: 'absolute', top: gy * canvasScale, left: 0, height: 1, width: '100%', background: 'hsl(var(--primary))', zIndex: 30, pointerEvents: 'none' }} />
              ))}

              {/* 坐标 HUD（评审 P2）：选中元素的位置/尺寸读数，拖动实时更新——不用移开视线看属性面板 */}
              {!preview && selected && (
                <div
                  className="pointer-events-none absolute right-1 top-1 z-40 rounded bg-white/90 px-1.5 py-0.5 font-mono text-xs text-foreground/70"
                  style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
                >
                  X {selected.x} · Y {selected.y} · {selected.width}×{selected.height} mm
                </div>
              )}

              {!preview && marqueeActive && (
                <div
                  className="pointer-events-none absolute z-40 border border-dashed bg-blue-500/5"
                  style={{
                    left: marqueeRect.minX,
                    top: marqueeRect.minY,
                    width: marqueeRect.maxX - marqueeRect.minX,
                    height: marqueeRect.maxY - marqueeRect.minY,
                  }}
                />
              )}

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
              canvasW={paper.w}
              canvasH={paper.h}
              onChange={patchElement}
              onToggle={toggleElementField}
              onEndTextEdit={endTextEdit}
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
