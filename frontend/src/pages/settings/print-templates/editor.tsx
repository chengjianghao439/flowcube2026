/**
 * 打印模板编辑器
 *
 * 布局：左侧字段面板 | 中间画布（拖拽定位）| 右侧属性面板
 * 存储单位：mm（毫米），显示时乘以 MM_PX 换算为像素
 * 拖拽方式：
 *   - 从字段面板拖到画布：HTML5 drag API
 *   - 画布内移动：mouse events
 */

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import {
  Save, Eye, EyeOff, Trash2, ChevronLeft, Loader2,
  AlignLeft, AlignCenter, AlignRight, Bold, Minus,
  Table2, Type, SeparatorHorizontal,
} from 'lucide-react'
import { getPrintTemplateDetailApi, createPrintTemplateApi, updatePrintTemplateApi } from '@/api/print-templates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { PaperSize, TemplateElement, TemplateLayout, TemplateType } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'
import {
  TEMPLATE_ZPL_DEFAULTS,
  ZPL_PLACEHOLDER_ROWS,
  ZPL_PREVIEW_SAMPLE,
  applyZplPreview,
} from '@/constants/labelZplDefaults'

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const MM_PX = 3.0 // 1mm → px，编辑器显示比例（3.0 在 13 寸屏可完整显示 A4 三栏）

const PAPER_SIZES: Record<PaperSize, { w: number; h: number; label: string }> = {
  A4:        { w: 210, h: 297, label: 'A4 (210×297mm)' },
  A5:        { w: 148, h: 210, label: 'A5 (148×210mm)' },
  A6:        { w: 105, h: 148, label: 'A6 (105×148mm)' },
  thermal80: { w: 80,  h: 200, label: '热敏纸 80mm' },
  thermal58: { w: 58,  h: 150, label: '热敏纸 58mm' },
}

const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: 1, label: '销售订单' },
  { value: 2, label: '采购订单' },
  { value: 3, label: '出库单' },
  { value: 4, label: '仓库任务单' },
  { value: 5, label: '货架标签 (ZPL)' },
  { value: 6, label: '散件容器标签 (ZPL)' },
  { value: 7, label: '物流箱贴 (ZPL)' },
  { value: 8, label: '商品标签 (ZPL)' },
  { value: 9, label: '库存标签 (ZPL)' },
]

function isZplLabelType(t: number): t is 5 | 6 | 7 | 8 | 9 {
  return t >= 5 && t <= 9
}

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'table' | 'divider' | 'title'
  icon: React.ReactNode
  defaultW: number  // mm
  defaultH: number  // mm
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
  printDate:       new Date().toLocaleDateString('zh-CN'),
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

function mkElement(field: FieldDef, xMm: number, yMm: number): TemplateElement {
  return {
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
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function PalettePanel({ onDragStart }: { onDragStart: (field: FieldDef) => void }) {
  return (
    <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r bg-muted/20">
      <div className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">字段列表</p>
        <p className="mt-0.5 text-xs text-muted-foreground">拖拽字段到画布</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {FIELD_DEFS.map(f => (
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

interface ElementNodeProps {
  el: TemplateElement
  selected: boolean
  preview: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onClick: (e: React.MouseEvent) => void
}

function ElementNode({ el, selected, preview, onMouseDown, onClick }: ElementNodeProps) {
  const px = (mm: number) => mm * MM_PX
  const sampleVal = SAMPLE[el.fieldKey] ?? el.label

  const style: React.CSSProperties = {
    position: 'absolute',
    left:     px(el.x),
    top:      px(el.y),
    width:    px(el.width),
    height:   px(el.height),
    fontSize: `${el.fontSize * 1.2}px`,
    fontWeight: el.fontWeight,
    textAlign: el.textAlign,
    border:   (el.border && el.type !== 'table') ? '1px solid #999' : undefined,
    outline:  (!preview && selected) ? '2px solid hsl(var(--primary))' : undefined,
    cursor:   preview ? 'default' : 'move',
    overflow: 'hidden',
    boxSizing: 'border-box',
    padding:  el.type === 'divider' ? '0' : '1px 2px',
    userSelect: 'none',
    background: !preview && selected ? 'hsl(var(--primary)/0.05)' : undefined,
  }

  if (el.type === 'divider') {
    return (
      <div style={style} onMouseDown={onMouseDown} onClick={onClick}>
        <div className="h-px w-full bg-current" style={{ marginTop: px(el.height) / 2 - 0.5 }} />
      </div>
    )
  }

  if (el.type === 'table') {
    const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
    const colDefs = cols.map(k => TABLE_COLUMN_OPTIONS.find(c => c.key === k)!).filter(Boolean)
    const cellStyle: React.CSSProperties = { border: '1px solid #ddd', padding: '1px 3px', fontSize: `${el.fontSize * 1.2}px` }
    return (
      <div style={style} onMouseDown={onMouseDown} onClick={onClick}>
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
      </div>
    )
  }

  // text / title
  return (
    <div style={style} onMouseDown={onMouseDown} onClick={onClick}>
      {preview ? (
        <span>{sampleVal}</span>
      ) : (
        <span className="text-muted-foreground/60">{el.label}</span>
      )}
    </div>
  )
}

interface PropertiesPanelProps {
  el: TemplateElement | null
  onChange: (id: string, patch: Partial<TemplateElement>) => void
  onDelete: (id: string) => void
}

function PropertiesPanel({ el, onChange, onDelete }: PropertiesPanelProps) {
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

        {/* 字体 */}
        {el.type !== 'divider' && (
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
        )}

        {/* 对齐 */}
        {el.type !== 'divider' && (
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

        {/* 边框 */}
        {el.type === 'text' && (
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
  const tabPath = useContext(TabPathContext)
  const isNew   = tabPath.endsWith('/new') || tabPath === ''
  const id      = isNew ? undefined : tabPath.split('/').pop()
  const navigate = useNavigate()
  const { tabs, setActive } = useWorkspaceStore()
  const qc = useQueryClient()

  // ── Remote data ──────────────────────────────────────────────
  const { data: remote, isLoading } = useQuery({
    queryKey: ['print-template', id],
    queryFn: () => getPrintTemplateDetailApi(+id!).then(r => r.data.data!),
    enabled: !isNew,
  })

  // ── Template state ───────────────────────────────────────────
  const [name,       setName]       = useState('未命名模板')
  const [type,       setType]       = useState<TemplateType>(1)
  const [paperSize,  setPaperSize]  = useState<PaperSize>('A4')
  const [elements,   setElements]   = useState<TemplateElement[]>([])
  const [zplBody,    setZplBody]    = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview,    setPreview]    = useState(false)
  const [hydrated,   setHydrated]   = useState(isNew)

  // Load remote template once
  useEffect(() => {
    if (remote && !hydrated) {
      setName(remote.name)
      setType(remote.type)
      setPaperSize(remote.paperSize)
      if (isZplTemplateLayout(remote.layout)) {
        setZplBody(remote.layout.body)
        setElements([])
      } else {
        setElements(Array.isArray(remote.layout.elements) ? remote.layout.elements : [])
        setZplBody('')
      }
      setHydrated(true)
    }
  }, [remote, hydrated])

  function handleTypeChange(v: string) {
    const next = +v as TemplateType
    const prev = type
    setType(next)
    if (isZplLabelType(next)) {
      setPaperSize('thermal80')
      setZplBody(TEMPLATE_ZPL_DEFAULTS[next] ?? '')
      setElements([])
      setSelectedId(null)
    } else {
      setZplBody('')
      if (isZplLabelType(prev)) {
        setElements([])
        setSelectedId(null)
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
      const newPath = `/settings/print-templates/${res.data.data!.id}`
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
  const paper = PAPER_SIZES[paperSize]
  const canvasW = paper.w * MM_PX
  const canvasH = paper.h * MM_PX
  const paperSelectEntries = Object.entries(PAPER_SIZES).filter(([k]) =>
    isZplLabelType(type) ? k === 'thermal80' || k === 'thermal58' : true,
  )

  const selected = elements.find(e => e.id === selectedId) ?? null

  function clampEl(el: TemplateElement): TemplateElement {
    return {
      ...el,
      x: Math.max(0, Math.min(paper.w - el.width, el.x)),
      y: Math.max(0, Math.min(paper.h - el.height, el.y)),
    }
  }

  function patchElement(id: string, patch: Partial<TemplateElement>) {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  function deleteElement(id: string) {
    setElements(prev => prev.filter(e => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function handleSave() {
    if (isZplLabelType(type)) {
      const body = zplBody.trim()
      if (!body.includes('^XA')) {
        toast.error('ZPL 正文须包含 ^XA 起始指令')
        return
      }
      const layout: TemplateLayout = { format: 'zpl', body }
      if (isNew) {
        createMut.mutate({ name, type, paperSize, layout })
      } else {
        updateMut.mutate({ id: +id!, name, type, paperSize, layout })
      }
      return
    }
    const layout: TemplateLayout = { elements }
    if (isNew) {
      createMut.mutate({ name, type, paperSize, layout })
    } else {
      updateMut.mutate({ id: +id!, name, type, paperSize, layout })
    }
  }

  function goBack() {
    navigate('/settings/print-templates')
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
    const xMm  = Math.max(0, xPx / MM_PX - field.defaultW / 2)
    const yMm  = Math.max(0, yPx / MM_PX - field.defaultH / 2)

    const newEl = mkElement(field, xMm, yMm)
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

    function onMouseMove(me: MouseEvent) {
      const dxMm = (me.clientX - dragStartMouse.current.x) / MM_PX
      const dyMm = (me.clientY - dragStartMouse.current.y) / MM_PX
      const newX  = Math.max(0, dragStartEl.current.x + dxMm)
      const newY  = Math.max(0, dragStartEl.current.y + dyMm)
      setElements(prev => prev.map(e => e.id === draggingElId.current ? { ...e, x: newX, y: newY } : e))
    }

    function onMouseUp() {
      // clamp to canvas bounds
      setElements(prev => prev.map(e => e.id === draggingElId.current ? clampEl(e) : e))
      draggingElId.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // Delete key handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId &&
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        deleteElement(selectedId)
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  // ── Loading state ────────────────────────────────────────────
  if (!isNew && (isLoading || !hydrated)) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载模板...
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-2">
        <Button size="sm" variant="ghost" onClick={goBack} className="gap-1.5 text-muted-foreground">
          <ChevronLeft className="size-4" />
          返回
        </Button>
        <div className="h-5 w-px bg-border" />

        {/* 模板名称 */}
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="模板名称"
          className="h-8 w-44 text-sm"
        />

        {/* 类型 */}
        <Select value={String(type)} onValueChange={handleTypeChange}>
          <SelectTrigger className="h-8 w-[11rem] px-2 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_TYPES.map(t => (
              <SelectItem key={t.value} value={String(t.value)}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 纸张 */}
        <Select value={paperSize} onValueChange={v => setPaperSize(v as PaperSize)}>
          <SelectTrigger className="h-8 min-w-[10rem] px-2 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {paperSelectEntries.map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          {!isZplLabelType(type) && (
            <span className="text-xs text-muted-foreground">{elements.length} 个元素</span>
          )}
          {isZplLabelType(type) && (
            <span className="text-xs text-muted-foreground">ZPL · {zplBody.length} 字符</span>
          )}

          {/* 预览切换 */}
          <Button
            size="sm"
            variant={preview ? 'default' : 'outline'}
            className="gap-1.5"
            onClick={() => { setPreview(p => !p); setSelectedId(null) }}
          >
            {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {isZplLabelType(type)
              ? (preview ? '返回编辑' : '示例替换')
              : (preview ? '退出预览' : '预览')}
          </Button>

          {/* 保存 */}
          <Button size="sm" onClick={handleSave} disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isPending ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isZplLabelType(type) ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r bg-muted/20">
              <div className="border-b px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">占位符</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  使用双花括号包裹下列键名，保存后打印时替换为实际值。
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {(ZPL_PLACEHOLDER_ROWS[type] ?? []).map(row => (
                  <div key={row.key} className="text-xs font-mono">
                    <span className="text-primary">{`{{${row.key}}}`}</span>
                    <span className="ml-2 text-muted-foreground">{row.label}</span>
                  </div>
                ))}
              </div>
              <div className="border-t p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setZplBody(TEMPLATE_ZPL_DEFAULTS[type] ?? '')}
                >
                  恢复默认 ZPL
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-muted/40 p-6">
              <p className="shrink-0 text-xs text-muted-foreground">
                ZPL 正文须含 ^XA … ^XZ；中文建议含 ^CI28（UTF-8 需打印机支持）。
              </p>
              {preview ? (
                <pre className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {applyZplPreview(zplBody, ZPL_PREVIEW_SAMPLE[type] ?? {})}
                </pre>
              ) : (
                <textarea
                  value={zplBody}
                  onChange={e => setZplBody(e.target.value)}
                  className="min-h-0 flex-1 resize-none rounded-lg border bg-background p-4 font-mono text-xs leading-relaxed"
                  spellCheck={false}
                  placeholder="^XA..."
                />
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Left: Palette */}
            {!preview && <PalettePanel onDragStart={handlePaletteDragStart} />}

            {/* Center: Canvas — min-w-0 允许 flex 容器正确收缩，画布可滚动 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-auto bg-muted/40 p-8 gap-4">
              {preview && (
                <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
                  <Eye className="size-3.5" />
                  预览模式 — 显示示例数据
                </div>
              )}
              {!preview && (
                <p className="text-xs text-muted-foreground">
                  从左侧拖拽字段到画布 · 点击选中元素后可拖动位置或在右侧修改属性 · <kbd className="rounded border px-1">Delete</kbd> 删除
                </p>
              )}

              {/* Paper canvas */}
              <div
                ref={canvasRef}
                style={{ width: canvasW, height: canvasH, position: 'relative' }}
                className={`shrink-0 bg-white shadow-xl ring-1 ring-border/30 ${!preview ? 'cursor-crosshair' : ''}`}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                onClick={() => { if (!draggingElId.current) setSelectedId(null) }}
              >
                {/* Grid overlay */}
                {!preview && (
                  <svg
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <pattern id="grid" width={5 * MM_PX} height={5 * MM_PX} patternUnits="userSpaceOnUse">
                        <path d={`M ${5 * MM_PX} 0 L 0 0 0 ${5 * MM_PX}`} fill="none" stroke="hsl(var(--muted-foreground)/0.12)" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                  </svg>
                )}

                {/* Elements */}
                {elements.map(el => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    selected={selectedId === el.id}
                    preview={preview}
                    onMouseDown={e => handleElementMouseDown(e, el)}
                    onClick={e => { e.stopPropagation(); setSelectedId(el.id) }}
                  />
                ))}

                {/* Empty hint */}
                {elements.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 pointer-events-none">
                    <Table2 className="size-10" />
                    <p className="text-sm">从左侧拖拽字段到这里</p>
                  </div>
                )}
              </div>

              {/* Print helper info */}
              <p className="text-xs text-muted-foreground">
                {paper.label} · {paper.w} × {paper.h} mm
              </p>
            </div>

            {/* Right: Properties */}
            {!preview && (
              <PropertiesPanel
                el={selected}
                onChange={patchElement}
                onDelete={deleteElement}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
