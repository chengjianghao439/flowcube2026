/**
 * TemplateRenderer
 *
 * 将数据库存储的 TemplateLayout（layout_json）与订单数据结合，渲染出可打印的页面。
 * 坐标单位：mm（与编辑器 layout_json 一致）
 * 渲染单位：px，按屏幕 96dpi 换算（1mm ≈ 3.7795px）
 */

import type { TemplateLayout, TemplateElement } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'
import BarcodePreview from '@/components/print/BarcodePreview'

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 1mm → px（96dpi 标准，与 @page 打印一致） */
const MM_PX = 3.7795

const PAPER_MM: Record<string, { w: number; h: number }> = {
  A4:        { w: 210, h: 297 },
  A5:        { w: 148, h: 210 },
  A6:        { w: 105, h: 148 },
  thermal80: { w: 80,  h: 200 },
  thermal75: { w: 75,  h: 50  },
  thermal58: { w: 58,  h: 150 },
}

const COL_DEF: Record<string, { label: string; align: 'left' | 'center' | 'right' }> = {
  articleNo: { label: '货号',     align: 'left'   },
  code:      { label: '商品编码', align: 'left'   },
  name:      { label: '商品名称', align: 'left'   },
  spec:      { label: '型号',     align: 'left'   },
  color:     { label: '颜色',     align: 'center' },
  unit:      { label: '单位',     align: 'center' },
  qty:       { label: '数量',     align: 'right'  },
  price:     { label: '单价',     align: 'right'  },
  amount:    { label: '金额',     align: 'right'  },
  remark:    { label: '备注',     align: 'left'   },
}

/** 模板页面边距（mm）；缺省与历史默认一致：上下 8 / 左右 0。打印 @page 与无表格单页高度共用 */
function layoutMargins(layout: TemplateLayout): { top: number; bottom: number; left: number; right: number } {
  if (isZplTemplateLayout(layout)) return { top: 8, bottom: 8, left: 0, right: 0 }
  const m = layout.margins
  const n = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    top:    n(m?.top, 8),
    bottom: n(m?.bottom, 8),
    left:   n(m?.left, 0),
    right:  n(m?.right, 0),
  }
}

// ─── 通用商品行 ───────────────────────────────────────────────────────────────

export interface PrintItem {
  productCode: string
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  amount: number
  /** 货号 / 型号 / 颜色 / 行备注（订单明细行均有，透传后可由模板列显示） */
  articleNumber?: string
  spec?: string
  color?: string
  remark?: string
}

function colValue(col: string, item: PrintItem): string {
  switch (col) {
    case 'articleNo': return item.articleNumber ?? ''
    case 'code':      return item.productCode
    case 'name':      return item.productName
    case 'spec':      return item.spec ?? ''
    case 'color':     return item.color ?? ''
    case 'unit':      return item.unit
    case 'qty':       return String(item.quantity)
    case 'price':     return `¥${(Number(item.unitPrice) || 0).toFixed(2)}`
    case 'amount':    return `¥${(Number(item.amount) || 0).toFixed(2)}`
    case 'remark':    return item.remark ?? ''
    default:          return ''
  }
}

/** nameAttrs 的取值（与 colValue 的规则一致） */
function nameAttrValue(key: string, item: PrintItem): string {
  switch (key) {
    case 'spec':      return item.spec ?? ''
    case 'color':     return item.color ?? ''
    case 'unit':      return item.unit
    case 'articleNo': case 'articleNumber': return item.articleNumber ?? ''
    case 'code':      return item.productCode
    case 'name':      return item.productName
    default:          return ''
  }
}

/**
 * 名称列内容：商品名称 + 勾选的附加信息（nameAttrs）依次拼在名称后，
 * 如「商品A [黑色] [500g/件] [件]」。空值跳过；nameAttrs 缺省 = 不拼接（兼容旧模板）。
 */
function nameValue(el: TemplateElement, item: PrintItem): string {
  const attrs = el.nameAttrs ?? []
  if (!attrs.length) return item.productName
  const parts = attrs.map(k => nameAttrValue(k, item)).filter(v => String(v).trim() !== '')
  return parts.length ? `${item.productName} [${parts.join('] [')}]` : item.productName
}

// ─── 单元渲染 ─────────────────────────────────────────────────────────────────

function ElementNode({
  el,
  data,
  scale,
}: {
  el: TemplateElement
  data: Record<string, string>
  scale: number
}) {
  const px = (mm: number) => mm * MM_PX * scale
  const base: React.CSSProperties = {
    position:   'absolute',
    left:       px(el.x),
    top:        px(el.y),
    width:      px(el.width),
    height:     px(el.height),
    fontSize:   `${el.fontSize * scale}pt`,
    fontWeight: el.fontWeight,
    textAlign:  el.textAlign,
    overflow:   'hidden',
    boxSizing:  'border-box',
    lineHeight: 1.3,
  }

  if (el.type === 'image') {
    // 公司 Logo：src 取自 data[fieldKey]（系统 Logo URL，带 v= 参数）；空值表示未上传/无值 → 整体不渲染
    const src = data[el.fieldKey] ?? ''
    if (!src) return null
    return (
      <div style={{ ...base, padding: 0 }}>
        <img src={src} alt={el.label || 'Logo'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
    )
  }

  if (el.type === 'barcode') {
    const v = (data[el.fieldKey] ?? '') || el.label
    return (
      <div style={{ ...base, padding: '1px 2px' }}>
        <BarcodePreview value={v} />
      </div>
    )
  }

  if (el.type === 'divider') {
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center', padding: 0 }}>
        <div style={{ width: '100%', borderTop: '1px solid #555' }} />
      </div>
    )
  }

  if (el.type === 'title') {
    return (
      <div style={{ ...base, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start' }}>
        {data[el.fieldKey] ?? el.label}
      </div>
    )
  }

  if (el.type === 'table') {
    const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
    const wrap = el.tableRowWrap !== false
    // 表头预览：按列宽(mm)应用宽度，与 FlowTable 一致
    const explicit = el.tableColumnWidths ?? {}
    const widthPx = (k: string) => {
      const w = explicit[k]
      return w != null && Number.isFinite(w) && w > 0 ? px(w) : undefined
    }

    return (
      <div style={{ ...base, padding: 0, overflow: 'visible' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: `${el.fontSize * scale}pt`,
            fontFamily: 'inherit',
            tableLayout: 'fixed',
          }}
        >
          <thead>
            <tr>
              <th style={thStyle('center', wrap, widthPx('#'))}>序号</th>
              {cols.map(c => (
                <th key={c} style={thStyle(COL_DEF[c]?.align ?? 'left', wrap, widthPx(c))}>
                  {COL_DEF[c]?.label ?? c}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
    )
  }

  const label = el.label ? `${el.label}：` : ''
  const value = data[el.fieldKey] ?? ''
  const jc = el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start'
  return (
    <div
      style={{
        ...base,
        padding: '1px 3px',
        border: el.border ? '1px solid #ccc' : undefined,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: jc,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {label && <span style={{ color: '#888', fontSize: '0.9em', whiteSpace: 'nowrap', marginRight: 2 }}>{label}</span>}
      <span>{value}</span>
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface Props {
  layout:    TemplateLayout
  paperSize: string
  data:      Record<string, string>
  items:     PrintItem[]
  /** 屏幕预览放大（1=物理 mm 换算；打印前应恢复为 1） */
  displayScale?: number
}

export default function TemplateRenderer({ layout, paperSize, data, items, displayScale = 1 }: Props) {
  const paper = PAPER_MM[paperSize] ?? PAPER_MM.A4
  const scale = displayScale

  if (isZplTemplateLayout(layout)) {
    return (
      <div
        style={{
          padding:    24,
          maxWidth:   (paper.w * MM_PX * scale),
          minHeight:  (40 * MM_PX * scale),
          background: '#fff',
          fontSize:   12,
          color:      '#666',
        }}
      >
        当前为 ZPL 标签模板，请在业务（PDA / 打印任务）中发送至热敏打印机；此预览仅适用于画布类单据模板。
      </div>
    )
  }

  const pw = (mm: number) => mm * MM_PX * scale
  const baseStyle: React.CSSProperties = {
    background: '#fff',
    fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    fontSize:   `${9 * scale}pt`,
    color:      '#000',
  }

  const tableEl = layout.elements.find(e => e.type === 'table')

  // 无明细表格：单页固定版式（绝对定位），高度 = 可打印区高度（纸高 − 上下页边距），保留原行为
  if (!tableEl) {
    const m = layoutMargins(layout)
    const pageH = Math.max(1, paper.h - m.top - m.bottom)
    return (
      <div style={{ ...baseStyle, position: 'relative', width: pw(paper.w), height: pw(pageH), overflow: 'hidden' }}>
        {layout.elements.map(el => <ElementNode key={el.id} el={el} data={data} scale={scale} />)}
      </div>
    )
  }

  // 有明细表格：上方定位区 + 表格流式分页 + 下方跟随区。整体高度自适应、可跨页、不裁剪。
  const tableBottom = tableEl.y + tableEl.height
  const aboveEls = layout.elements.filter(e => e.type !== 'table' && e.y < tableEl.y)
  // 2026-08-25 评审修复：原实现只取 e.y >= tableBottom 为下方元素，y 落在 [table.y, tableBottom)
  // 区间内的元素（画布上「叠在表格框内」的非表格元素）既不进上方也不进下方 → 打印时无声消失。
  // 表格高度打印时随行数自适应，该区间无精确定位语义，统一归入下方跟随区顶部（按原 y 排序堆叠），保证可见且顺序稳定。
  const belowEls = layout.elements
    .filter(e => e.type !== 'table' && e.y >= tableEl.y)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const normalizedBelow = belowEls.map(e => ({
    ...e,
    // 原 y 已在表格底部之下 → 相对表格底部；夹在表格框内 → 归入跟随区顶部，按顺序堆叠
    y: e.y >= tableBottom ? e.y - tableBottom : 0,
  }))
  const belowHeight = normalizedBelow.reduce((m, e) => Math.max(m, e.y + e.height), 0)

  return (
    <div style={{ ...baseStyle, width: pw(paper.w) }}>
      {/* 表格上方：固定版式区（页眉/单据信息） */}
      <div style={{ position: 'relative', height: pw(tableEl.y) }}>
        {aboveEls.map(el => <ElementNode key={el.id} el={el} data={data} scale={scale} />)}
      </div>
      {/* 明细表格：流式，自动撑高 + 跨页分页 + 每页重复表头 */}
      <FlowTable el={tableEl} items={items} scale={scale} />
      {/* 表格下方：跟随区（合计/签字/备注），相对表格底部定位 */}
      {belowHeight > 0 && (
        <div style={{ position: 'relative', height: pw(belowHeight), marginTop: pw(2) }}>
          {normalizedBelow.map(el => (
            <ElementNode key={el.id} el={el} data={data} scale={scale} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 明细表格：流式渲染，自动撑高 + 跨页分页 + 每页重复表头 ─────────────────

function FlowTable({ el, items, scale }: { el: TemplateElement; items: PrintItem[]; scale: number }) {
  const pw = (mm: number) => mm * MM_PX * scale
  const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
  // 序号列可显隐（showIndex 缺省 true 兼容旧模板），用符号列名 '#' 与业务列统一进列宽/图元逻辑
  const showIndex = el.showIndex !== false
  const allCols = showIndex ? ['#', ...cols] : cols

  // 列宽：显式指定（mm）优先，其余均分剩余宽度
  const totalPx = pw(el.width)
  const explicit = el.tableColumnWidths ?? {}
  const explicitPx: Record<string, number | null> = {}
  for (const k of allCols) {
    const w = explicit[k]
    explicitPx[k] = w != null && Number.isFinite(w) && w > 0 ? pw(w) : null
  }
  const known = allCols.filter(k => explicitPx[k] != null)
  const used = known.reduce((s, k) => s + (explicitPx[k] as number), 0)
  const unknown = allCols.length - known.length
  const share = unknown > 0 ? Math.max(0, totalPx - used) / unknown : 0
  const widthOf = (k: string) => (explicitPx[k] != null ? (explicitPx[k] as number) : share)

  const wrap = el.tableRowWrap !== false
  const minRowPx =
    el.tableMinRowHeightMm != null && Number.isFinite(el.tableMinRowHeightMm) && el.tableMinRowHeightMm > 0
      ? pw(el.tableMinRowHeightMm)
      : undefined

  return (
    <table
      style={{
        marginLeft: pw(el.x),
        width: totalPx,
        borderCollapse: 'collapse',
        fontSize: `${el.fontSize * scale}pt`,
        fontFamily: 'inherit',
        tableLayout: 'fixed',
      }}
    >
      {/* table-header-group：跨页时每页顶部重复表头 */}
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          {showIndex && <th style={thStyle('center', wrap, widthOf('#'))}>序号</th>}
          {cols.map(c => (
            <th key={c} style={thStyle(COL_DEF[c]?.align ?? 'left', wrap, widthOf(c))}>
              {COL_DEF[c]?.label ?? c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff', breakInside: 'avoid' }}>
            {showIndex && <td style={tdStyle('center', wrap, minRowPx)}>{i + 1}</td>}
            {cols.map(c => (
              <td key={c} style={tdStyle(COL_DEF[c]?.align ?? 'left', wrap, minRowPx)}>
                {c === 'name' ? nameValue(el, item) : colValue(c, item)}
              </td>
            ))}
          </tr>
        ))}
        <tr style={{ background: '#f5f5f5', fontWeight: 600, breakInside: 'avoid' }}>
          {/* 合计标签跨列 = 序号列（如显示）+ amount 列之前的所有列 */}
          <td colSpan={(showIndex ? 1 : 0) + (cols.indexOf('amount') >= 0 ? cols.indexOf('amount') : cols.length)} style={tdStyle('right', wrap, minRowPx)}>
            合计：
          </td>
          {cols.indexOf('amount') >= 0 && (
            <td style={tdStyle('right', wrap, minRowPx)}>
              ¥{items.reduce((s, it) => s + Number(it.amount ?? 0), 0).toFixed(2)}
            </td>
          )}
        </tr>
      </tbody>
    </table>
  )
}

function thStyle(align: string, wrap: boolean, width?: number): React.CSSProperties {
  return {
    background: '#f0f0f0',
    border:     '1px solid #bbb',
    padding:    '4px 5px',
    fontWeight: 600,
    textAlign:  align as React.CSSProperties['textAlign'],
    verticalAlign: 'middle',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    wordBreak:  'break-all',
    width:      width,
  }
}

function tdStyle(align: string, wrap: boolean, minRowPx?: number): React.CSSProperties {
  return {
    border:     '1px solid #d8d8d8',
    padding:    '4px 5px',
    textAlign:  align as React.CSSProperties['textAlign'],
    verticalAlign: 'top',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    wordBreak:  'break-all',
    minHeight:  minRowPx,
  }
}
