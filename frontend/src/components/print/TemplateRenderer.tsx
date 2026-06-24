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
  code:   { label: '商品编码', align: 'left'   },
  name:   { label: '商品名称', align: 'left'   },
  spec:   { label: '规格',     align: 'left'   },
  unit:   { label: '单位',     align: 'center' },
  qty:    { label: '数量',     align: 'right'  },
  price:  { label: '单价',     align: 'right'  },
  amount: { label: '金额',     align: 'right'  },
}

// ─── 通用商品行 ───────────────────────────────────────────────────────────────

export interface PrintItem {
  productCode: string
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  amount: number
  remark?: string
}

function colValue(col: string, item: PrintItem): string {
  switch (col) {
    case 'code':   return item.productCode
    case 'name':   return item.productName
    case 'spec':   return ''
    case 'unit':   return item.unit
    case 'qty':    return String(item.quantity)
    case 'price':  return `¥${(Number(item.unitPrice) || 0).toFixed(2)}`
    case 'amount': return `¥${(Number(item.amount) || 0).toFixed(2)}`
    default:       return ''
  }
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

    return (
      <div style={{ ...base, padding: 0, overflow: 'visible' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: `${el.fontSize * scale}pt`,
            fontFamily: 'inherit',
          }}
        >
          <thead>
            <tr>
              <th style={thStyle('#', 'center')}>序号</th>
              {cols.map(c => (
                <th key={c} style={thStyle(c, COL_DEF[c]?.align ?? 'left')}>
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

function thStyle(_key: string, align: string): React.CSSProperties {
  return {
    background:  '#f0f0f0',
    border:      '1px solid #bbb',
    padding:     '4px 5px',
    fontWeight:  600,
    textAlign:   align as React.CSSProperties['textAlign'],
    whiteSpace:  'nowrap',
  }
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

  // 无明细表格：单页固定版式（绝对定位），保留原行为
  if (!tableEl) {
    return (
      <div style={{ ...baseStyle, position: 'relative', width: pw(paper.w), height: pw(paper.h), overflow: 'hidden' }}>
        {layout.elements.map(el => <ElementNode key={el.id} el={el} data={data} scale={scale} />)}
      </div>
    )
  }

  // 有明细表格：上方定位区 + 表格流式分页 + 下方跟随区。整体高度自适应、可跨页、不裁剪。
  const tableBottom = tableEl.y + tableEl.height
  const aboveEls = layout.elements.filter(e => e.type !== 'table' && e.y < tableEl.y)
  const belowEls = layout.elements.filter(e => e.type !== 'table' && e.y >= tableBottom)
  const belowHeight = belowEls.reduce((m, e) => Math.max(m, (e.y - tableBottom) + e.height), 0)

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
          {belowEls.map(el => (
            <ElementNode key={el.id} el={{ ...el, y: el.y - tableBottom }} data={data} scale={scale} />
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
  return (
    <table
      style={{
        marginLeft: pw(el.x),
        width: pw(el.width),
        borderCollapse: 'collapse',
        fontSize: `${el.fontSize * scale}pt`,
        fontFamily: 'inherit',
        tableLayout: 'fixed',
      }}
    >
      {/* table-header-group：跨页时每页顶部重复表头 */}
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th style={thStyle('#', 'center')}>序号</th>
          {cols.map(c => (
            <th key={c} style={thStyle(c, COL_DEF[c]?.align ?? 'left')}>
              {COL_DEF[c]?.label ?? c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff', breakInside: 'avoid' }}>
            <td style={tdStyle('center')}>{i + 1}</td>
            {cols.map(c => (
              <td key={c} style={tdStyle(COL_DEF[c]?.align ?? 'left')}>
                {colValue(c, item)}
              </td>
            ))}
          </tr>
        ))}
        <tr style={{ background: '#f5f5f5', fontWeight: 600, breakInside: 'avoid' }}>
          <td colSpan={cols.indexOf('amount') >= 0 ? cols.indexOf('amount') + 1 : cols.length} style={tdStyle('right')}>
            合计：
          </td>
          {cols.indexOf('amount') >= 0 && (
            <td style={tdStyle('right')}>
              ¥{items.reduce((s, it) => s + Number(it.amount ?? 0), 0).toFixed(2)}
            </td>
          )}
        </tr>
      </tbody>
    </table>
  )
}

function tdStyle(align: string): React.CSSProperties {
  return {
    border:   '1px solid #d8d8d8',
    padding:  '4px 5px',
    textAlign: align as React.CSSProperties['textAlign'],
    verticalAlign: 'top',
  }
}
