/**
 * TemplateRenderer
 *
 * 将数据库存储的 TemplateLayout（layout_json）与真实订单数据结合，
 * 渲染出可打印的订单页面。
 *
 * 坐标单位：mm（与编辑器 layout_json 一致）
 * 渲染单位：px，按屏幕 96dpi 换算（1mm ≈ 3.7795px）
 */

import type { TemplateLayout, TemplateElement } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'
import type { SaleOrder } from '@/types/sale'

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 1mm → px（96dpi 标准，与 @page 打印一致） */
const MM_PX = 3.7795

const PAPER_MM: Record<string, { w: number; h: number }> = {
  A4:        { w: 210, h: 297 },
  A5:        { w: 148, h: 210 },
  A6:        { w: 105, h: 148 },
  thermal80: { w: 80,  h: 200 },
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

// ─── 字段映射 ─────────────────────────────────────────────────────────────────

function resolveField(fieldKey: string, order: SaleOrder): string {
  const map: Record<string, string> = {
    title:           '销售订单',
    orderNo:         order.orderNo ?? '',
    customerName:    order.customerName ?? '',
    orderDate:       order.saleDate ?? String(order.createdAt ?? '').slice(0, 10),
    warehouseName:   order.warehouseName ?? '',
    salesperson:     order.operatorName ?? '',
    receiverName:    order.receiverName ?? '',
    receiverPhone:   order.receiverPhone ?? '',
    receiverAddress: order.receiverAddress ?? '',
    totalAmount:     `¥ ${Number(order.totalAmount ?? 0).toFixed(2)}`,
    remark:          order.remark ?? '',
    operator:        order.operatorName ?? '',
    printDate:       new Date().toLocaleDateString('zh-CN'),
  }
  return map[fieldKey] ?? ''
}

// ─── 单个元素渲染 ─────────────────────────────────────────────────────────────

function px(mm: number) { return mm * MM_PX }

function ElementNode({ el, order }: { el: TemplateElement; order: SaleOrder }) {
  const base: React.CSSProperties = {
    position:   'absolute',
    left:       px(el.x),
    top:        px(el.y),
    width:      px(el.width),
    height:     px(el.height),
    fontSize:   `${el.fontSize}pt`,
    fontWeight: el.fontWeight,
    textAlign:  el.textAlign,
    overflow:   'hidden',
    boxSizing:  'border-box',
    lineHeight: 1.3,
  }

  // ── 分隔线 ──
  if (el.type === 'divider') {
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center', padding: 0 }}>
        <div style={{ width: '100%', borderTop: '1px solid #555' }} />
      </div>
    )
  }

  // ── 标题 ──
  if (el.type === 'title') {
    return (
      <div style={{ ...base, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start' }}>
        {resolveField(el.fieldKey, order) || el.label}
      </div>
    )
  }

  // ── 商品明细表 ──
  if (el.type === 'table') {
    const items = order.items ?? []
    const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']

    return (
      <div style={{ ...base, padding: 0, overflow: 'visible' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: `${el.fontSize}pt`,
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
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                <td style={tdStyle('center')}>{i + 1}</td>
                {cols.map(c => (
                  <td key={c} style={tdStyle(COL_DEF[c]?.align ?? 'left')}>
                    {colValue(c, item)}
                  </td>
                ))}
              </tr>
            ))}
            {/* 合计行 */}
            <tr style={{ background: '#f5f5f5', fontWeight: 600 }}>
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
      </div>
    )
  }

  // ── 普通文本 ──
  const label = el.label ? `${el.label}：` : ''
  const value = resolveField(el.fieldKey, order)
  return (
    <div
      style={{
        ...base,
        padding: '1px 3px',
        border: el.border ? '1px solid #ccc' : undefined,
        display: 'flex',
        alignItems: 'flex-start',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {label && <span style={{ color: '#888', fontSize: '0.9em', whiteSpace: 'nowrap', marginRight: 2 }}>{label}</span>}
      <span>{value}</span>
    </div>
  )
}

function thStyle(key: string, align: string): React.CSSProperties {
  return {
    background:  '#f0f0f0',
    border:      '1px solid #bbb',
    padding:     '4px 5px',
    fontWeight:  600,
    textAlign:   align as React.CSSProperties['textAlign'],
    whiteSpace:  'nowrap',
  }
}

function tdStyle(align: string): React.CSSProperties {
  return {
    border:   '1px solid #d8d8d8',
    padding:  '4px 5px',
    textAlign: align as React.CSSProperties['textAlign'],
    verticalAlign: 'top',
  }
}

function colValue(col: string, item: SaleOrder['items'] extends (infer T)[] | undefined ? NonNullable<T> : never): string {
  switch (col) {
    case 'code':   return item.productCode ?? ''
    case 'name':   return item.productName ?? ''
    case 'spec':   return ''
    case 'unit':   return item.unit ?? ''
    case 'qty':    return String(item.quantity ?? 0)
    case 'price':  return `¥${Number(item.unitPrice ?? 0).toFixed(2)}`
    case 'amount': return `¥${Number(item.amount ?? 0).toFixed(2)}`
    default:       return ''
  }
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface Props {
  layout:    TemplateLayout
  paperSize: string
  order:     SaleOrder
}

export default function TemplateRenderer({ layout, paperSize, order }: Props) {
  const paper = PAPER_MM[paperSize] ?? PAPER_MM.A4

  if (isZplTemplateLayout(layout)) {
    return (
      <div
        style={{
          padding:    24,
          maxWidth:   px(paper.w),
          minHeight:  px(40),
          background: '#fff',
          fontSize:   12,
          color:      '#666',
        }}
      >
        当前为 ZPL 标签模板，请在业务（PDA / 打印任务）中发送至热敏打印机；此预览仅适用于画布类单据模板。
      </div>
    )
  }

  return (
    <div
      style={{
        position:   'relative',
        width:      px(paper.w),
        height:     px(paper.h),
        background: '#fff',
        overflow:   'hidden',
        fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
        fontSize:   '9pt',
        color:      '#000',
      }}
    >
      {layout.elements.map(el => (
        <ElementNode key={el.id} el={el} order={order} />
      ))}
    </div>
  )
}
