import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
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
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { usePrintTemplatePreview } from '@/hooks/usePrintTemplatePreview'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { defaultPreviewElements } from '@/lib/printTemplatePreview'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import {
  Save, Eye, EyeOff, Loader2, RotateCcw,
  ZoomIn, ZoomOut, Undo2, Redo2, Copy,
  PanelLeft, PanelRight, Table2,
} from 'lucide-react'
import { getLogoApi } from '@/api/settings'
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
  SALE_TOTAL_FIELD_DEFS,
  DOC_PREVIEW_ITEMS,
  DOC_PREVIEW_SAMPLE,
  LABEL_FIELD_DEFS_BY_TYPE,
  LABEL_PREVIEW_SAMPLE,
  type PrintFieldDef,
} from '@/constants/printFieldDefs'
import { resolveLabelWidthMm, resolveLabelHeightMm } from '@/lib/labelGeometry'
import LabelRasterPreview from '@/components/print/LabelRasterPreview'
import {
  MM_PX, EDITOR_ZOOM_MIN, EDITOR_ZOOM_MAX, EDITOR_ZOOM_STEP,
  PAPER_SIZES, TEMPLATE_TYPES,
  clampEditorZoom, clampVal, isZplLabelType, cloneDefaultLabelElements,
  makeId, mkElement, snapAxis,
  type AlignDir, type ResizeDir,
} from './components/editorUtils'
import { LayoutNumberInput } from './components/LayoutNumberInput'
import { PalettePanel } from './components/EditorPalettePanel'
import { ElementNode } from './components/EditorElementNode'
import { PropertiesPanel } from './components/EditorPropertiesPanel'

// ──────────────────────────────────────────────────────────────────────────
// Main editor component
// ──────────────────────────────────────────────────────────────────────────

export default function PrintTemplateEditor() {
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.PRINT_TEMPLATE_MANAGE)
  const gridPatternUid = useId().replace(/:/g, '')
  const fieldsPanelId = useId()
  const propertiesPanelId = useId()
  const tabPath = useContext(TabPathContext)
  const active = useSectionActive()
  const pathname = tabPath.split(/[?#]/, 1)[0]
  const isNew = pathname.endsWith('/new') || pathname === ''
  const id = isNew ? undefined : pathname.split('/').pop()
  const validId = !!id && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
  const navigate = useNavigate()
  const qc = useQueryClient()

  // ── Remote data ──────────────────────────────────────────────
  const { data: remote, isLoading, isError, isPaused, error, refetch } = useQuery({
    queryKey: ['print-template', id],
    queryFn: () => getPrintTemplateDetailApi(+id!),
    enabled: active && validId,
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
  const [dpi, setDpi] = useState<203 | 300>(203)
  /** 单据类型页面边距（mm），写入 layout.margins；打印 @page 与安全区共用 */
  const [margins, setMargins] = useState<PrintPageMargins>({ top: 8, bottom: 8, left: 0, right: 0 })
  /** 多选：Shift+点击 toggle；空数组 = 未选中 */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [previewRequested, setPreview] = useState(false)
  const preview = previewRequested || !canManage
  const [fieldsOpen, setFieldsOpen] = useState(true)
  const [propertiesOpen, setPropertiesOpen] = useState(true)
  /** 画布仅影响显示与拖拽换算，不改变存库的 mm 坐标 */
  const [editorZoom, setEditorZoom] = useState(1)
  /** 用户手动缩放后暂停自适应（fit 由「适应画布」按钮/初始化触发；手动调回可再触发） */
  const manualZoomRef = useRef(false)
  /** 拖动时的对齐参考线（mm 坐标），松手清空 */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  /** 框选（marquee，评审 P2）：空白处拖动选择多个元素 */
  const [marqueeActive, setMarqueeActive] = useState(false)
  const [marqueeRect, setMarqueeRect] = useState({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  const marqueeStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
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
  const dpiRef = useRef(dpi)
  dpiRef.current = dpi
  const marginsRef = useRef(margins)
  marginsRef.current = margins
  const snapshotRefs = useRef({ type, paperSize, canvasWidthMm, canvasHeightMm, dpi, margins })
  snapshotRefs.current = { type, paperSize, canvasWidthMm, canvasHeightMm, dpi, margins }

  /** 未保存检测基准：水合完成时快照（评审 P1 修复） */
  const cleanSnapshotRef = useRef<CleanSnapshot | null>(isNew ? {
    name, type, paperSize, canvasWidthMm, canvasHeightMm, dpi, margins, elements,
  } : null)

  // 保存成功后基准前移（视作已保存）：水合时也调用重置基准
  const markClean = useCallback(() => {
    cleanSnapshotRef.current = {
      name: nameRef.current,
      type: typeRef.current,
      paperSize: paperSizeRef.current,
      canvasWidthMm: canvasWidthMmRef.current,
      canvasHeightMm: canvasHeightMmRef.current,
      dpi: dpiRef.current,
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
        dpiRef.current !== clean.dpi ||
        JSON.stringify(s.margins) !== JSON.stringify(clean.margins) ||
        JSON.stringify(elementsRef.current) !== JSON.stringify(clean.elements)
      )
    }
  }
  useDirtyGuard(tabPath, canManage && isDirty)

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
      setDpi(!isZplTemplateLayout(remote.layout) && remote.layout.dpi === 300 ? 300 : 203)
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
          const cw = resolveLabelWidthMm(lo, remote.paperSize)
          const ch = resolveLabelHeightMm(lo)
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
        dpi: !isZplTemplateLayout(remote.layout) && remote.layout.dpi === 300 ? 300 : 203,
        canvasWidthMm: isZplTemplateLayout(remote.layout)
          ? (isZplLabelType(remote.type) ? 75 : 80)
          : isZplLabelType(remote.type) ? resolveLabelWidthMm(remote.layout, remote.paperSize) : 75,
        canvasHeightMm: isZplTemplateLayout(remote.layout)
          ? (isZplLabelType(remote.type) ? 50 : 200)
          : isZplLabelType(remote.type) ? Math.max(40, resolveLabelHeightMm(remote.layout)) : 50,
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
  const editingInput = useRef<string | undefined>(undefined)
  const endInputEdit = useCallback(() => { editingInput.current = undefined }, [])

  // ── Save mutations ───────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof createPrintTemplateApi>[0]) => {
      if (!can(PERMISSIONS.PRINT_TEMPLATE_MANAGE)) throw new Error('没有管理打印模板权限')
      return createPrintTemplateApi(data)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['print-templates'] })
      toast.success('模板已保存')
      markClean() // 评审 P1：保存后基准前移（取消未保存状态）
      const newPath = `/settings/print-templates/${res!.id}`
      navigate(newPath, { replace: true })
    },
  })

  const updateMut = useMutation({
    mutationFn: (data: Parameters<typeof updatePrintTemplateApi>[0]) => {
      if (!can(PERMISSIONS.PRINT_TEMPLATE_MANAGE)) throw new Error('没有管理打印模板权限')
      return updatePrintTemplateApi(data)
    },
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

  const paletteFields = isZplLabelType(type) ? (LABEL_FIELD_DEFS_BY_TYPE[type] ?? []) : type === 1 ? [...DOC_FIELD_DEFS, ...SALE_TOTAL_FIELD_DEFS] : DOC_FIELD_DEFS
  const realPreview = usePrintTemplatePreview(type, isNew || hydrated === Number(id))
  const previewData: Record<string, string> = realPreview.mapped
    ? { ...realPreview.mapped.data, companyLogo: brandLogo?.url ?? '' }
    : isZplLabelType(type) ? { ...(LABEL_PREVIEW_SAMPLE[type] ?? {}) }
      : { ...DOC_PREVIEW_SAMPLE, companyLogo: brandLogo?.url ?? '', printDate: formatDisplayDateTime(new Date()) }
  const previewItems = realPreview.mapped?.items ?? DOC_PREVIEW_ITEMS
  const seededPreview = useRef(new Set<string>())
  const editedPreviewLayouts = useRef(new Set<string>())


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
    dpi: 203 | 300
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
    dpi: 203 | 300
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
      dpi: s.dpi,
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
    setDpi(snap.dpi)
    setMargins({ ...snap.margins })
    // 撤销保持选中（仅保留仍存在的元素 id，防选中已删元素）
    setSelectedIds(snap.selectedIds.filter(id => snap.elements.some(e => e.id === id)))
  }, [])

  /** 在改动「之前」调用：压入当前快照、清空 redo 栈 */
  const snapshot = useCallback((inputKey?: string) => {
    if (inputKey !== undefined && editingInput.current === inputKey) return
    editingInput.current = inputKey
    editedPreviewLayouts.current.add(`${tabPath}:${snapshotRefs.current.type}`)
    historyPast.current.push(currentSnapshot())
    if (historyPast.current.length > 100) historyPast.current.shift()
    historyFuture.current = []
    bumpHist(v => v + 1)
  }, [currentSnapshot, tabPath])
  useEffect(() => {
    if (!canManage || !realPreview.source || (!isNew && hydrated !== Number(id))) return
    const key = `${tabPath}:${type}`
    if (seededPreview.current.has(key)) return
    seededPreview.current.add(key)
    // 只给初始空布局补默认字段；后续手工清空、编辑及撤销不会被异步数据覆盖。
    if (elementsRef.current.length === 0 && !editedPreviewLayouts.current.has(key)) {
      snapshot()
      const defaults = defaultPreviewElements(type, paper.w, paper.h)
      if (isNew && cleanSnapshotRef.current && !isDirty) {
        cleanSnapshotRef.current = { ...cleanSnapshotRef.current, elements: defaults }
      }
      setElements(defaults)
    }
  }, [canManage, realPreview.source, isNew, isDirty, hydrated, id, tabPath, type, paper.w, paper.h, snapshot])
  const undo = useCallback(() => {
    endInputEdit()
    if (!historyPast.current.length) return
    historyFuture.current.push(currentSnapshot())
    restoreSnapshot(historyPast.current.pop()!)
    bumpHist(v => v + 1)
  }, [currentSnapshot, endInputEdit, restoreSnapshot])
  const redo = useCallback(() => {
    endInputEdit()
    if (!historyFuture.current.length) return
    historyPast.current.push(currentSnapshot())
    restoreSnapshot(historyFuture.current.pop()!)
    bumpHist(v => v + 1)
  }, [currentSnapshot, endInputEdit, restoreSnapshot])

  const clampEl = useCallback((el: TemplateElement): TemplateElement => {
    return {
      ...el,
      x: Math.max(0, Math.min(paper.w - el.width, el.x)),
      y: Math.max(0, Math.min(paper.h - el.height, el.y)),
    }
  }, [paper.w, paper.h])

  function patchElement(id: string, patch: Partial<TemplateElement>, inputKey?: string) {
    snapshot(inputKey === undefined ? undefined : JSON.stringify([id, inputKey]))
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
    if (!can(PERMISSIONS.PRINT_TEMPLATE_MANAGE)) return
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
      ? { elements, canvasWidthMm: cw, canvasHeightMm: ch, dpi }
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
    if (!active || preview) return
    const ARROWS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    function onKey(e: KeyboardEvent) {
      // Radix 选择组/浮层已消费的按键不再作为画布快捷键执行。
      if (e.defaultPrevented) return
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      const inControl = e.target instanceof Element && !!e.target.closest('button, select, [role="switch"], [role="radio"], [role="combobox"], [contenteditable="true"]')
      if (inField || inControl) return
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length && !inField && !inControl) {
        // 多选时整组删除（一次 snapshot）
        const ids = [...selectedIds]
        snapshot()
        setElements(prev => prev.filter(el => !ids.includes(el.id)))
        setSelectedIds([])
      }
      if (e.key === 'Escape') setSelectedIds([])
      if (selectedIds.length && !inField && !inControl && ARROWS[e.key]) {
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
  }, [active, preview, selectedIds, clampEl, duplicateGroup, redo, snapshot, undo])

  // ── Loading state ────────────────────────────────────────────
  // isNew 不需要 hydrated（新建页没有远程数据）；编辑页等 remote 加载完成
  if (!isNew && (!validId || isError || (isPaused && hydrated === null))) {
    return <div className="space-y-4">
      <PageHeader title="打印模板" description="查看或编辑打印版式。" actions={<Button variant="outline" onClick={() => navigate(getWorkspaceListPath('/settings/print-templates'))}>返回列表</Button>} />
      {!validId ? <p>模板编号无效</p> : <QueryErrorState title={isPaused ? '正在等待网络连接' : '模板加载失败'} error={error} onRetry={refetch} />}
    </div>
  }
  if (!isNew && (isLoading || hydrated !== Number(id))) {
    return (
      <div className="desktop-print-editor flex h-full min-h-0 flex-col gap-5 overflow-hidden">
        <PageHeader title="编辑打印模板"
        description="核对模板字段、纸张与打印版式。"  />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载模板…
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="desktop-print-editor flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <PageHeader
        title={isNew ? '新建打印模板' : `${canManage ? '编辑' : '查看'}打印模板 #${id}`}
        description={`${preview ? '画布下方显示真实纸张尺寸，保存后打印以预览为准。' : '从字段列表拖入元素，点选后拖动、缩放或修改属性，按 Delete 删除。画布下方显示真实纸张尺寸，打印以预览为准。'}${isZplLabelType(type) ? '打印时按毫米坐标生成 ZPL。' : ''}`}
        actions={<>
          {!preview && (
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-0.5" role="group" aria-label="编辑器面板">
                <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                  aria-expanded={fieldsOpen} aria-controls={fieldsPanelId} aria-label="字段列表" title={fieldsOpen ? '收起字段列表' : '展开字段列表'}
                  onClick={() => setFieldsOpen(open => !open)}>
                  <PanelLeft className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                  aria-expanded={propertiesOpen} aria-controls={propertiesPanelId} aria-label="属性面板" title={propertiesOpen ? '收起属性面板' : '展开属性面板'}
                  onClick={() => setPropertiesOpen(open => !open)}>
                  <PanelRight className="size-4" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5" role="group" aria-label="编辑历史">
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
            </div>
          )}
          <Button type="button" variant="outline" onClick={() => navigate(getWorkspaceListPath('/settings/print-templates'))}>
            返回列表
          </Button>
          {canManage && <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => { setPreview(p => !p); setSelectedIds([]) }}
          >
            {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {preview ? '退出预览' : '预览'}
          </Button>}

          {canManage && <Button type="button" onClick={handleSave} disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isPending ? '保存中…' : '保存'}
          </Button>}
        </>}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <fieldset disabled={!canManage} className="contents">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="模板名称"
            className="h-9 w-36 text-sm" aria-label="模板名称"
          />

          <Select value={String(type)} onValueChange={handleTypeChange}>
            <SelectTrigger className="h-9 min-h-9 w-32 px-2 py-1.5 text-sm" aria-label="模板类型">
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
              <LayoutNumberInput
                min={30}
                max={120}
                step={1}
                value={canvasWidthMm}
                roundOnBlur
                onValueChange={value => { snapshot('paper-width'); setCanvasWidthMm(value) }}
                onComplete={endInputEdit}
                className="h-9 w-[4.25rem] text-sm"
                title="宽度 mm"
              />
              <span className="text-muted-foreground">×</span>
              <LayoutNumberInput
                min={40}
                max={500}
                step={1}
                value={canvasHeightMm}
                roundOnBlur
                onValueChange={value => { snapshot('paper-height'); setCanvasHeightMm(value) }}
                onComplete={endInputEdit}
                className="h-9 w-[4.25rem] text-sm"
                title="高度 mm"
              />
              <span className="text-xs text-muted-foreground">宽×高</span>
              <Select value={String(dpi)} onValueChange={value => { snapshot(); setDpi(value === '300' ? 300 : 203) }}>
                <SelectTrigger aria-label="打印分辨率" title="须与打印机分辨率一致" className="h-9 w-auto min-w-24 px-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="203">203 DPI</SelectItem>
                  <SelectItem value="300">300 DPI</SelectItem>
                </SelectContent>
              </Select>
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
              <SelectTrigger className="h-9 min-h-9 w-24 shrink-0 px-2 py-1.5 text-sm" aria-label="纸张规格">
                <SelectValue>{paperSize.startsWith('thermal') ? paper.label : paperSize}</SelectValue>
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
                  <LayoutNumberInput
                    min={0}
                    max={40}
                    step={1}
                    value={margins[k]}
                    roundOnBlur
                    onValueChange={value => { snapshot(`page-margin-${k}`); setMargins(m => ({ ...m, [k]: value })) }}
                    onComplete={endInputEdit}
                    className="h-9 w-10 px-2 text-sm"
                    title={`页面${zh}边距 mm`}
                  />
                </div>
              ))}
            </div>
          )}

          </fieldset>
          <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
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
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!preview && (
            <div id={fieldsPanelId} className={fieldsOpen ? 'flex min-h-0 shrink-0' : 'hidden'}>
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
            </div>
          )}

          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-muted/30 p-4 gap-3"
            ref={canvasColRef}
          >
            <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
              {realPreview.source && <span className="max-w-full break-words">真实数据：{realPreview.source.sourceLabel}</span>}
              {realPreview.isError ? <>
                  <span>{(realPreview.error as { status?: number }).status === 403 ? '暂无可用业务数据（无查看权限）' : '真实数据加载失败，保留当前模板'}</span>
                  <Button variant="ghost" size="sm" onClick={() => { void realPreview.refetch() }}>重试</Button>
                </>
                : !realPreview.source && (realPreview.isPending ? <span>正在加载真实数据…</span>
                  : <span>暂无可用业务数据，保留当前模板</span>)}
              {preview && <span>· 预览模式</span>}
            </div>


            <div
              ref={canvasRef}
              style={{ width: canvasW, height: canvasH, position: 'relative' }}
              className={`mx-auto shrink-0 bg-white shadow-xl ring-1 ring-border/30 ${!preview ? 'cursor-crosshair' : ''}`}
              onDragOver={handleCanvasDragOver}
              onDrop={handleCanvasDrop}
              onPointerDown={e => {
                if (!active || preview || e.button !== 0 || e.target !== e.currentTarget || marqueeStartRef.current) return
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left, y = e.clientY - rect.top
                marqueeStartRef.current = { x, y, pointerId: e.pointerId }
                e.currentTarget.setPointerCapture(e.pointerId)
                marqueeJustSelectingRef.current = false
                setMarqueeRect({ minX: x, minY: y, maxX: x, maxY: y })
                setMarqueeActive(true)
                setSelectedIds([])
              }}
              onPointerMove={e => {
                const start = marqueeStartRef.current
                if (!start || e.pointerId !== start.pointerId) return
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left, y = e.clientY - rect.top
                setMarqueeRect({ minX: Math.min(start.x, x), minY: Math.min(start.y, y), maxX: Math.max(start.x, x), maxY: Math.max(start.y, y) })
              }}
              onPointerUp={e => {
                const start = marqueeStartRef.current
                if (!start || start.pointerId !== e.pointerId) return
                marqueeStartRef.current = null
                setMarqueeActive(false)
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left, y = e.clientY - rect.top
                if (!active || preview || Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) < 3) return
                marqueeJustSelectingRef.current = true
                const left = Math.min(start.x, x) / canvasScale, right = Math.max(start.x, x) / canvasScale
                const top = Math.min(start.y, y) / canvasScale, bottom = Math.max(start.y, y) / canvasScale
                setSelectedIds(elementsRef.current.filter(el => el.x + el.width >= left && el.x <= right
                  && el.y + el.height >= top && el.y <= bottom).map(el => el.id))
              }}
              onLostPointerCapture={e => {
                if (marqueeStartRef.current?.pointerId === e.pointerId) {
                  marqueeStartRef.current = null
                  setMarqueeActive(false)
                }
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

              {isZplLabelType(type) && elements.length > 0 && (
                <LabelRasterPreview
                  // 评审次要项：layout 对象字面量每渲染新建导致子组件 useMemo 恒失效，改为传原始 state 由子组件稳定化
                  elements={elements}
                  canvasWidthMm={safeCw}
                  canvasHeightMm={safeCh}
                  dpi={dpi}
                  data={previewData}
                  paperSize={labelPaperSize}
                  scale={canvasScale}
                />
              )}
              {(!isZplLabelType(type) || !previewRequested) && (
                elements.map(el => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    selected={selectedIds.includes(el.id)}
                    preview={preview}
                    previewData={previewData}
                    previewItems={previewItems}
                    useRealData={!!realPreview.source}
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
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground pointer-events-none">
                  <Table2 className="size-10" />
                  <p className="text-sm">{preview || fieldsOpen ? '从左侧拖拽字段到这里' : '展开字段列表后拖入字段'}</p>
                </div>
              )}
            </div>

            <p className="mx-auto text-xs text-muted-foreground">
              {paper.label} · {paper.w} × {paper.h} mm · {elements.length} 个元素
            </p>
          </div>

          {!preview && (
            <div id={propertiesPanelId} className={propertiesOpen ? 'flex min-h-0 shrink-0' : 'hidden'}>
              <PropertiesPanel
                key={selected?.id}
                el={selected}
                multiCount={selectedIds.length}
                isLabel={isZplLabelType(type)}
                canvasW={paper.w}
                canvasH={paper.h}
                onChange={patchElement}
                onToggle={toggleElementField}
                onEndInputEdit={endInputEdit}
                onDelete={deleteElement}
                onDeleteMulti={deleteSelectedGroup}
                onAlign={alignSelectedToCanvas}
                onDistribute={distributeSelected}
              />
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
