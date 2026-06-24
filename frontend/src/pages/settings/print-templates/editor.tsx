/**
 * 打印模板编辑器
 *
 * 布局：左侧字段面板 | 中间画布（拖拽定位）| 右侧属性面板
 * 存储单位：mm（毫米），显示时乘以 MM_PX 换算为像素
 * 拖拽方式：
 *   - 从字段面板拖到画布：HTML5 drag API
 *   - 画布内移动：mouse events
 */

import { useState, useRef, useEffect, useCallback, useContext, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import {
  Save, Eye, EyeOff, Trash2, Loader2,
  AlignLeft, AlignCenter, AlignRight, Bold,
  Table2, Type, SeparatorHorizontal, Barcode, RotateCcw,
  ZoomIn, ZoomOut, Undo2, Redo2, Copy,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
} from 'lucide-react'

type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'
import { getPrintTemplateDetailApi, createPrintTemplateApi, updatePrintTemplateApi } from '@/api/print-templates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import PageHeader from '@/components/shared/PageHeader'
import type { PaperSize, TemplateElement, TemplateLayout, TemplateType } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'
import { DEFAULT_LABEL_ELEMENTS, LABEL_PREVIEW_SAMPLE } from '@/constants/labelZplDefaults'
import BarcodePreview from '@/components/print/BarcodePreview'
import { PT_TO_MM } from '@/lib/labelGeometry'

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

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'table' | 'divider' | 'title' | 'barcode'
  icon: React.ReactNode
  defaultW: number  // mm
  defaultH: number  // mm
}

/** 各标签类型可拖拽字段（与销售单画布相同交互） */
const LABEL_FIELD_DEFS_BY_TYPE: Record<number, FieldDef[]> = {
  5: [
    { key: 'rack_barcode', label: '货架条码', type: 'barcode', icon: <Barcode className="size-3.5" />, defaultW: 72, defaultH: 14 },
    { key: 'rack_code', label: '货架编码', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 7 },
    { key: 'zone', label: '库区', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 7 },
    { key: 'name', label: '名称', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 8 },
  ],
  6: [
    { key: 'container_code', label: '库存条码', type: 'barcode', icon: <Barcode className="size-3.5" />, defaultW: 72, defaultH: 14 },
    { key: 'product_name', label: '品名', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 10 },
    { key: 'qty', label: '数量', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 7 },
  ],
  7: [
    { key: 'box_code', label: '物流条码', type: 'barcode', icon: <Barcode className="size-3.5" />, defaultW: 72, defaultH: 12 },
    { key: 'task_no', label: '任务号', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 6 },
    { key: 'customer_name', label: '客户', type: 'text', icon: <Type className="size-3.5" />, defaultW: 40, defaultH: 6 },
    { key: 'carrier_name', label: '快递', type: 'text', icon: <Type className="size-3.5" />, defaultW: 32, defaultH: 6 },
    { key: 'freight_type_name', label: '运费方式', type: 'text', icon: <Type className="size-3.5" />, defaultW: 32, defaultH: 6 },
    { key: 'piece_count', label: '件数', type: 'text', icon: <Type className="size-3.5" />, defaultW: 32, defaultH: 6 },
    { key: 'item_list', label: '装箱内容', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 12 },
  ],
  8: [
    { key: 'product_code', label: '产品条码', type: 'barcode', icon: <Barcode className="size-3.5" />, defaultW: 72, defaultH: 14 },
    { key: 'product_name', label: '产品名称', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 10 },
    { key: 'spec', label: '规格', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 7 },
  ],
  9: [
    { key: 'container_code', label: '塑料盒条码', type: 'barcode', icon: <Barcode className="size-3.5" />, defaultW: 72, defaultH: 16 },
    { key: 'product_name', label: '品名', type: 'text', icon: <Type className="size-3.5" />, defaultW: 72, defaultH: 12 },
  ],
}

function cloneDefaultLabelElements(t: number): TemplateElement[] {
  const raw = DEFAULT_LABEL_ELEMENTS[t]
  if (!raw?.length) return []
  return JSON.parse(JSON.stringify(raw)) as TemplateElement[]
}

const FIELD_DEFS: FieldDef[] = [
  // 标题 / 分隔
  { key: 'title',          label: '大标题',   type: 'title',   icon: <Type className="size-3.5" />,              defaultW: 160, defaultH: 10 },
  { key: 'divider',        label: '分隔线',   type: 'divider', icon: <SeparatorHorizontal className="size-3.5"/>, defaultW: 160, defaultH: 4  },
  // 文本字段
  { key: 'orderNo',        label: '单据编号', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 80,  defaultH: 7  },
  { key: 'customerName',   label: '客户名称', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 80,  defaultH: 7  },
  { key: 'supplierName',   label: '供应商',   type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 80,  defaultH: 7  },
  { key: 'orderDate',      label: '单据日期', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 60,  defaultH: 7  },
  { key: 'warehouseName',  label: '仓库',     type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 60,  defaultH: 7  },
  { key: 'salesperson',    label: '业务员',   type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 50,  defaultH: 7  },
  { key: 'receiverName',   label: '收货人',   type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 60,  defaultH: 7  },
  { key: 'receiverPhone',  label: '联系电话', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 70,  defaultH: 7  },
  { key: 'receiverAddress',label: '收货地址', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 130, defaultH: 7  },
  { key: 'totalAmount',    label: '金额合计', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 70,  defaultH: 7  },
  { key: 'remark',         label: '备注',     type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 130, defaultH: 12 },
  { key: 'operator',       label: '经办人',   type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 50,  defaultH: 7  },
  { key: 'printDate',      label: '打印日期', type: 'text',    icon: <Type className="size-3.5" />,              defaultW: 60,  defaultH: 7  },
  // 表格
  { key: 'itemsTable',     label: '商品明细', type: 'table',   icon: <Table2 className="size-3.5" />,            defaultW: 170, defaultH: 50 },
]

const TABLE_COLUMN_OPTIONS = [
  { key: 'code',   label: '商品编码' },
  { key: 'name',   label: '商品名称' },
  { key: 'spec',   label: '规格' },
  { key: 'unit',   label: '单位' },
  { key: 'qty',    label: '数量' },
  { key: 'price',  label: '单价' },
  { key: 'amount', label: '金额' },
]

// ──────────────────────────────────────────────────────────────────────────
// Sample data for preview
// ──────────────────────────────────────────────────────────────────────────

const SAMPLE: Record<string, string> = {
  title:           '销售订单',
  orderNo:         'SO2024031500001',
  customerName:    '北京科技有限公司',
  supplierName:    '上海供应链有限公司',
  orderDate:       '2024-03-15',
  warehouseName:   '主仓库',
  salesperson:     '张三',
  receiverName:    '李四',
  receiverPhone:   '13812345678',
  receiverAddress: '北京市朝阳区 XX 街道 XX 号',
  totalAmount:     '¥ 3,200.00',
  remark:          '请注意包装，易碎品。',
  operator:        '王五',
  printDate:       formatDisplayDateTime(new Date()),
}

const SAMPLE_ITEMS = [
  { code: 'P001', name: '商品A', spec: '500g/件', unit: '件', qty: '10', price: '100.00', amount: '1,000.00' },
  { code: 'P002', name: '商品B', spec: '1kg/箱',  unit: '箱', qty: '5',  price: '200.00', amount: '1,000.00' },
  { code: 'P003', name: '商品C', spec: '250ml/瓶',unit: '瓶', qty: '20', price: '60.00',  amount: '1,200.00' },
]

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeId() { return `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function mkElement(field: FieldDef, xMm: number, yMm: number, isLabel = false): TemplateElement {
  const base: TemplateElement = {
    id:           makeId(),
    type:         field.type,
    fieldKey:     field.key,
    label:        field.label,
    x:            xMm,
    y:            yMm,
    width:        field.defaultW,
    height:       field.defaultH,
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
  fields: FieldDef[]
  hint?: string
  onDragStart: (field: FieldDef) => void
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
            <span className="text-muted-foreground">{f.icon}</span>
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
    const colDefs = cols.map(k => TABLE_COLUMN_OPTIONS.find(c => c.key === k)!).filter(Boolean)
    const cellStyle: React.CSSProperties = { border: '1px solid #ddd', padding: '1px 3px', fontSize: `${el.fontSize * scale * 0.35}px` }
    content = (
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {colDefs.map(c => (
              <th key={c.key} style={{ ...cellStyle, background: '#f5f5f5', fontWeight: 'bold' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(preview ? SAMPLE_ITEMS : SAMPLE_ITEMS.slice(0, 2)).map((row, i) => (
            <tr key={i}>
              {cols.map(k => <td key={k} style={cellStyle}>{(row as Record<string,string>)[k] ?? ''}</td>)}
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

interface PropertiesPanelProps {
  el: TemplateElement | null
  isLabel: boolean
  onChange: (id: string, patch: Partial<TemplateElement>) => void
  onDelete: (id: string) => void
  onAlign: (dir: AlignDir) => void
}

function PropertiesPanel({ el, isLabel, onChange, onDelete, onAlign }: PropertiesPanelProps) {
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

  const num = (v: unknown) => typeof v === 'number' ? v : 0

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
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">表格列（勾选显示）</label>
            {TABLE_COLUMN_OPTIONS.map(col => {
              const checked = (el.tableColumns ?? []).includes(col.key)
              return (
                <label key={col.key} className="flex cursor-pointer items-center gap-2 text-xs">
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
                  {col.label}
                </label>
              )
            })}
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview,    setPreview]    = useState(false)
  const [hydrated,   setHydrated]   = useState(isNew)
  /** 画布仅影响显示与拖拽换算，不改变存库的 mm 坐标 */
  const [editorZoom, setEditorZoom] = useState(1)
  /** 拖动时的对齐参考线（mm 坐标），松手清空 */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })

  // Load remote template once
  useEffect(() => {
    if (remote && !hydrated) {
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
        if (isZplLabelType(remote.type)) {
          const lo = remote.layout as { canvasWidthMm?: number; canvasHeightMm?: number }
          const p = PAPER_SIZES[remote.paperSize] ?? PAPER_SIZES.thermal75
          const cw = typeof lo.canvasWidthMm === 'number' ? lo.canvasWidthMm : p.w
          const ch = typeof lo.canvasHeightMm === 'number' ? lo.canvasHeightMm : p.h
          setCanvasWidthMm(Math.min(120, Math.max(30, cw)))
          setCanvasHeightMm(Math.min(500, Math.max(40, ch)))
        }
      }
      setHydrated(true)
    }
  }, [remote, hydrated])

  function handleTypeChange(v: string) {
    const next = +v as TemplateType
    const prev = type
    setType(next)
    if (isZplLabelType(next)) {
      setPaperSize('thermal75')
      setCanvasWidthMm(75)
      setCanvasHeightMm(50)
      setElements(cloneDefaultLabelElements(next))
      setSelectedId(null)
    } else {
      if (isZplLabelType(prev)) {
        setElements([])
        setSelectedId(null)
        setPaperSize('A4')
        setCanvasWidthMm(80)
        setCanvasHeightMm(200)
      }
    }
  }

  // ── Drag state refs ──────────────────────────────────────────
  const canvasRef      = useRef<HTMLDivElement>(null)
  const draggingField  = useRef<FieldDef | null>(null)   // palette → canvas drag
  const draggingElId   = useRef<string | null>(null)      // element move drag
  const dragStartMouse = useRef({ x: 0, y: 0 })
  const dragStartEl    = useRef({ x: 0, y: 0 })

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

  const selected = elements.find(e => e.id === selectedId) ?? null

  const paletteFields = isZplLabelType(type) ? (LABEL_FIELD_DEFS_BY_TYPE[type] ?? []) : FIELD_DEFS
  const previewData: Record<string, string> = isZplLabelType(type)
    ? { ...(LABEL_PREVIEW_SAMPLE[type] ?? {}) }
    : { ...SAMPLE }

  // ── Undo / redo history ──────────────────────────────────────
  const historyPast = useRef<TemplateElement[][]>([])
  const historyFuture = useRef<TemplateElement[][]>([])
  const [, bumpHist] = useState(0)
  // 最新 elements 引用，供键盘 effect 内的 snapshot/undo/redo 读取，规避 stale closure
  const elementsRef = useRef(elements)
  elementsRef.current = elements

  /** 在改动 elements「之前」调用：压入当前快照、清空 redo 栈 */
  function snapshot() {
    historyPast.current.push(elementsRef.current)
    if (historyPast.current.length > 100) historyPast.current.shift()
    historyFuture.current = []
    bumpHist(v => v + 1)
  }
  function undo() {
    if (!historyPast.current.length) return
    historyFuture.current.push(elementsRef.current)
    setElements(historyPast.current.pop()!)
    setSelectedId(null)
    bumpHist(v => v + 1)
  }
  function redo() {
    if (!historyFuture.current.length) return
    historyPast.current.push(elementsRef.current)
    setElements(historyFuture.current.pop()!)
    setSelectedId(null)
    bumpHist(v => v + 1)
  }

  function clampEl(el: TemplateElement): TemplateElement {
    return {
      ...el,
      x: Math.max(0, Math.min(paper.w - el.width, el.x)),
      y: Math.max(0, Math.min(paper.h - el.height, el.y)),
    }
  }

  function patchElement(id: string, patch: Partial<TemplateElement>) {
    snapshot()
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  function deleteElement(id: string) {
    snapshot()
    setElements(prev => prev.filter(e => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  /** 复制选中元素，偏移 +2mm */
  function duplicateElement(id: string) {
    const src = elementsRef.current.find(e => e.id === id)
    if (!src) return
    snapshot()
    const copy = clampEl({ ...src, id: makeId(), x: src.x + 2, y: src.y + 2 })
    setElements(prev => [...prev, copy])
    setSelectedId(copy.id)
  }

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

  /** 选中元素对齐到画布六向 */
  function alignSelectedToCanvas(dir: AlignDir) {
    if (!selectedId) return
    snapshot()
    setElements(prev => prev.map(el => {
      if (el.id !== selectedId) return el
      let { x, y } = el
      if (dir === 'left') x = 0
      else if (dir === 'hcenter') x = Math.max(0, (paper.w - el.width) / 2)
      else if (dir === 'right') x = Math.max(0, paper.w - el.width)
      else if (dir === 'top') y = 0
      else if (dir === 'vmiddle') y = Math.max(0, (paper.h - el.height) / 2)
      else if (dir === 'bottom') y = Math.max(0, paper.h - el.height)
      return { ...el, x: Math.round(x), y: Math.round(y) }
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
      : { elements }
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
    setSelectedId(null)
    toast.success('已恢复默认布局')
  }

  // ── Palette → Canvas drag (HTML5 drag API) ───────────────────
  const handlePaletteDragStart = useCallback((field: FieldDef) => {
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
    const xMm  = Math.max(0, xPx / canvasScale - field.defaultW / 2)
    const yMm  = Math.max(0, yPx / canvasScale - field.defaultH / 2)

    snapshot()
    const newEl = mkElement(field, xMm, yMm, isZplLabelType(type))
    setElements(prev => [...prev, newEl])
    setSelectedId(newEl.id)
  }

  // ── Element mouse-drag (move) ────────────────────────────────
  function handleElementMouseDown(e: React.MouseEvent, el: TemplateElement) {
    if (preview) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(el.id)

    draggingElId.current   = el.id
    dragStartMouse.current = { x: e.clientX, y: e.clientY }
    dragStartEl.current    = { x: el.x, y: el.y }
    let moved = false

    function onMouseMove(me: MouseEvent) {
      if (!moved) { moved = true; snapshot() }
      const dxMm = (me.clientX - dragStartMouse.current.x) / canvasScale
      const dyMm = (me.clientY - dragStartMouse.current.y) / canvasScale
      const rawX = Math.max(0, dragStartEl.current.x + dxMm)
      const rawY = Math.max(0, dragStartEl.current.y + dyMm)
      const snap = computeSnap(rawX, rawY, el.width, el.height, el.id)
      setGuides(snap.guides)
      setElements(prev => prev.map(e => e.id === draggingElId.current ? { ...e, x: snap.x, y: snap.y } : e))
    }

    function onMouseUp() {
      setGuides({ x: [], y: [] })
      // clamp to canvas bounds
      setElements(prev => prev.map(e => e.id === draggingElId.current ? clampEl(e) : e))
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
    setSelectedId(el.id)
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
      if (mod && !inField && (e.key === 'd' || e.key === 'D') && selectedId) {
        e.preventDefault(); duplicateElement(selectedId); return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !inField) {
        deleteElement(selectedId)
      }
      if (e.key === 'Escape') setSelectedId(null)
      if (selectedId && !inField && ARROWS[e.key]) {
        e.preventDefault()
        snapshot()
        const step = e.shiftKey ? 5 : 1
        const [dx, dy] = ARROWS[e.key]
        setElements(prev => prev.map(el => el.id === selectedId
          ? clampEl({ ...el, x: el.x + dx * step, y: el.y + dy * step }) : el))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, paper.w, paper.h])

  // ── Loading state ────────────────────────────────────────────
  if (!isNew && (isLoading || !hydrated)) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-4 pb-4 pt-2">
        <PageHeader title="编辑打印模板" description="正在加载…" />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          加载模板...
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-4 pb-4 pt-2">
      <PageHeader
        title={isNew ? '新建打印模板' : `编辑打印模板 #${id}`}
        description="拖拽字段到画布编排版式；热敏标签与单据均使用毫米坐标；标签打印统一使用 ZPL 指令集。工具栏「画布」可缩放以便编辑。"
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
                disabled={!selectedId} onClick={() => selectedId && duplicateElement(selectedId)} title="复制选中元素 (Ctrl+D)">
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
              onClick={() => { setPreview(p => !p); setSelectedId(null) }}
            >
              {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {preview ? '退出预览' : '预览'}
            </Button>

            <Button size="sm" onClick={handleSave} disabled={isPending} className="gap-1.5">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isPending ? '保存中...' : '保存'}
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

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-auto bg-muted/40 p-6 gap-4">
            {preview && (
              <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
                <Eye className="size-3.5" />
                预览模式 — 示例数据
              </div>
            )}
            {!preview && (
              <p className="text-xs text-muted-foreground text-center max-w-xl">
                {isZplLabelType(type)
                  ? '从左侧拖拽字段到画布 · 打印时按毫米坐标生成 ZPL · 工具栏可放大画布 · '
                  : '从左侧拖拽字段到画布 · 点击选中元素后可拖动位置或在右侧修改属性 · 工具栏可放大画布 · '}
                <kbd className="rounded border px-1">Delete</kbd> 删除
              </p>
            )}

            <div
              ref={canvasRef}
              style={{ width: canvasW, height: canvasH, position: 'relative' }}
              className={`shrink-0 bg-white shadow-xl ring-1 ring-border/30 ${!preview ? 'cursor-crosshair' : ''}`}
              onDragOver={handleCanvasDragOver}
              onDrop={handleCanvasDrop}
              onClick={() => { if (!draggingElId.current) setSelectedId(null) }}
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

              {/* 单据打印安全区（距纸边 5mm）：提示避让打印机不可打印区，避免边缘裁切 */}
              {!preview && !isZplLabelType(type) && (
                <div style={{ position: 'absolute', inset: 5 * canvasScale, border: '1px dashed rgba(236,72,153,0.35)', pointerEvents: 'none', zIndex: 1 }} />
              )}

              {elements.map(el => (
                <ElementNode
                  key={el.id}
                  el={el}
                  selected={selectedId === el.id}
                  preview={preview}
                  previewData={previewData}
                  scale={canvasScale}
                  isLabel={isZplLabelType(type)}
                  onMouseDown={e => handleElementMouseDown(e, el)}
                  onClick={e => { e.stopPropagation(); setSelectedId(el.id) }}
                  onResizeStart={(e, dir) => handleResizeMouseDown(e, el, dir)}
                />
              ))}

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

            <p className="text-xs text-muted-foreground">
              {paper.label} · {paper.w} × {paper.h} mm
            </p>
          </div>

          {!preview && (
            <PropertiesPanel
              el={selected}
              isLabel={isZplLabelType(type)}
              onChange={patchElement}
              onDelete={deleteElement}
              onAlign={alignSelectedToCanvas}
            />
          )}
        </div>
      </div>

    </div>
  )
}
