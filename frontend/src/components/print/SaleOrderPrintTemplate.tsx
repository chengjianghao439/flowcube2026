/**
 * SaleOrderPrintTemplate
 *
 * 销售订单打印入口。
 *
 * 导出：
 *   PrintPreviewOverlay  — 全屏打印预览遮罩（portal）。
 *     1. 从数据库读取「销售订单」类型（type=1）的打印模板列表。
 *     2. 用户可在顶部工具栏切换模板。
 *     3. 用 TemplateRenderer 将 layout_json + 订单数据渲染成真实预览。
 *     4. 点击"打印"调用 window.print()，@media print 规则只显示纸张区域。
 *
 * 保留：
 *   SaleOrderPrintTemplate  — 兜底静态组件，在无数据库模板时使用。
 */

import { createPortal, flushSync } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Printer, X, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PrintPreviewZoomControls } from '@/components/shared/PrintPreviewZoomControls'
import { getPrintTemplateListApi } from '@/api/print-templates'
import TemplateRenderer from './TemplateRenderer'
import type { SaleOrder, SaleOrderItem } from '@/types/sale'
import type { PrintTemplate } from '@/types/print-template'

// ─── @media print（动态注入）────────────────────────────────────────────────

const PRINT_STYLE_ID = 'fc-sale-print-style'
const PRINT_CSS = `
@media print {
  body > *:not(#fc-print-root) { display: none !important; }
  #fc-print-root   { position: static !important; overflow: visible !important; background: #fff !important; }
  #fc-print-tb     { display: none !important; }
  #fc-print-page   { box-shadow: none !important; margin: 0 !important; width: 100% !important; height: auto !important; overflow: visible !important; transform: none !important; }
  @page            { size: A4; margin: 0; }
}
`

// ─── 打印预览遮罩 ─────────────────────────────────────────────────────────────

interface OverlayProps {
  order:   SaleOrder
  onClose: () => void
}

export function PrintPreviewOverlay({ order, onClose }: OverlayProps) {
  const [templates,   setTemplates]   = useState<PrintTemplate[]>([])
  const [selected,    setSelected]    = useState<PrintTemplate | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [showPicker,  setShowPicker]  = useState(false)
  const [docZoom, setDocZoom]        = useState(1)
  const prePrintZoomRef             = useRef(1)
  const docZoomRef                  = useRef(1)
  docZoomRef.current = docZoom

  // 注入 @media print 样式
  useEffect(() => {
    if (!document.getElementById(PRINT_STYLE_ID)) {
      const el = document.createElement('style')
      el.id = PRINT_STYLE_ID
      el.textContent = PRINT_CSS
      document.head.appendChild(el)
    }
    return () => { document.getElementById(PRINT_STYLE_ID)?.remove() }
  }, [])

  useEffect(() => {
    const before = () => {
      prePrintZoomRef.current = docZoomRef.current
      flushSync(() => setDocZoom(1))
    }
    const after = () => {
      flushSync(() => setDocZoom(prePrintZoomRef.current))
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  // 加载「销售订单」类型模板
  useEffect(() => {
    setLoading(true)
    getPrintTemplateListApi({ type: 1 })
      .then(res => {
        const list = res.data.data ?? []
        setTemplates(list)
        // 优先使用默认模板，没有则取第一个
        setSelected(list.find(t => t.isDefault) ?? list[0] ?? null)
      })
      .catch(() => setSelected(null))
      .finally(() => setLoading(false))
  }, [])

  return createPortal(
    <div
      id="fc-print-root"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, overflowY: 'auto', background: '#e0e0e0' }}
    >
      {/* ── 工具栏 ── */}
      <div
        id="fc-print-tb"
        style={{
          position: 'sticky', top: 0, zIndex: 1,
          background: '#fff', borderBottom: '1px solid #d0d0d0',
          padding: '10px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          gap: 12,
        }}
      >
        {/* 左：模板选择器 */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>打印预览</span>
          <span style={{ color: '#bbb' }}>·</span>
          {loading ? (
            <span style={{ fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
              加载模板...
            </span>
          ) : selected ? (
            <button
              onClick={() => setShowPicker(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 6, border: '1px solid #d0d0d0',
                background: '#fafafa', cursor: 'pointer', fontSize: 12, color: '#444',
              }}
            >
              {selected.name}
              {templates.length > 1 && <ChevronDown style={{ width: 12, height: 12 }} />}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: '#e88' }}>暂无打印模板</span>
          )}

          {/* 模板下拉 */}
          {showPicker && templates.length > 1 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: '#fff', border: '1px solid #ddd', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 10, minWidth: 200, padding: 4,
            }}>
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSelected(t); setShowPicker(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px', border: 'none', background: t.id === selected?.id ? '#f0f4ff' : 'transparent',
                    color: t.id === selected?.id ? '#3b6fd4' : '#333', cursor: 'pointer', borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  {t.name}
                  {t.isDefault && <span style={{ fontSize: 10, marginLeft: 6, color: '#f59e0b' }}>默认</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 中：预览缩放 */}
        <div style={{ flexShrink: 0 }}>
          <PrintPreviewZoomControls value={docZoom} onChange={setDocZoom} compact />
        </div>

        {/* 右：操作按钮 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={() => window.print()} disabled={!selected}>
            <Printer className="mr-1.5 h-4 w-4" />
            打印
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="mr-1.5 h-4 w-4" />
            关闭
          </Button>
        </div>
      </div>

      {/* ── 纸张预览区 ── */}
      <div style={{ padding: '28px 0 56px', display: 'flex', justifyContent: 'center' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', marginTop: 60 }}>
            <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite' }} />
            <span>加载模板中...</span>
          </div>
        ) : selected ? (
          <div
            id="fc-print-page"
            style={{ background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}
          >
            <TemplateRenderer
              layout={selected.layout}
              paperSize={selected.paperSize}
              order={order}
              displayScale={docZoom}
            />
          </div>
        ) : (
          /* 无模板时的兜底提示 */
          <div style={{
            marginTop: 60, padding: '32px 48px', background: '#fff', borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.1)', textAlign: 'center', color: '#666',
          }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>暂无可用的打印模板</p>
            <p style={{ fontSize: 13 }}>
              请前往 <strong>系统设置 → 打印模板</strong> 创建销售订单模板后再打印。
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─── 兜底静态组件（保留，供直接引用预览） ─────────────────────────────────────

export interface PrintCompanyInfo {
  name?: string
  address?: string
  phone?: string
}

interface Props {
  order:    SaleOrder
  items?:   SaleOrderItem[]
  company?: PrintCompanyInfo
}

export default function SaleOrderPrintTemplate({
  order,
  items,
  company = {},
}: Props) {
  const resolvedItems = items ?? order.items ?? []
  const total = Number(order.totalAmount)
  const dateStr =
    order.saleDate || (order.createdAt ? String(order.createdAt).slice(0, 10) : '—')

  return (
    <div
      style={{
        fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
        fontSize: 12,
        color: '#000',
        background: '#fff',
        padding: '18mm 14mm 14mm',
      }}
    >
      {/* 页眉 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 10, borderBottom: '2px solid #000' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{company.name || '（公司名称）'}</div>
          {company.address && <div style={{ fontSize: 10.5, color: '#444' }}>地址：{company.address}</div>}
          {company.phone   && <div style={{ fontSize: 10.5, color: '#444' }}>电话：{company.phone}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4, marginBottom: 7, margin: '0 0 7px' }}>销售订单</h1>
          <div style={{ fontSize: 11, color: '#333', lineHeight: 1.9 }}>
            <div><span style={{ color: '#777' }}>订单号：</span><strong>{order.orderNo}</strong></div>
            <div><span style={{ color: '#777' }}>日期：</span>{dateStr}</div>
            <div><span style={{ color: '#777' }}>经办人：</span>{order.operatorName}</div>
            <div><span style={{ color: '#777' }}>状态：</span>{order.statusName}</div>
          </div>
        </div>
      </div>

      {/* 订单信息 */}
      <PSection title="订单信息">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '7px 18px' }}>
          <InfoItem label="客户" value={order.customerName} />
          <InfoItem label="仓库" value={order.warehouseName} />
          {order.carrier    && <InfoItem label="承运商"   value={order.carrier} />}
          {order.freightType && <InfoItem label="运费方式" value={order.freightTypeName || '—'} />}
        </div>
      </PSection>

      {/* 收货信息 */}
      {(order.receiverName || order.receiverPhone || order.receiverAddress) && (
        <PSection title="收货信息">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '7px 18px' }}>
            {order.receiverName    && <InfoItem label="收货人"   value={order.receiverName} />}
            {order.receiverPhone   && <InfoItem label="联系电话" value={order.receiverPhone} />}
            {order.receiverAddress && <InfoItem label="收货地址" value={order.receiverAddress} style={{ gridColumn: '1 / -1' }} />}
          </div>
        </PSection>
      )}

      {/* 商品明细 */}
      <PSection title="商品明细">
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
          <thead>
            <tr>
              {([
                { label: '序号', w: 28, align: 'center' }, { label: '商品编码', w: 90 }, { label: '商品名称' },
                { label: '单位', w: 42, align: 'center' }, { label: '数量', w: 52, align: 'right' },
                { label: '单价', w: 68, align: 'right' },  { label: '金额', w: 78, align: 'right' }, { label: '备注', w: 76 },
              ] as { label: string; w?: number; align?: string }[]).map(({ label, w, align }) => (
                <th key={label} style={{ background: '#f0f0f0', border: '1px solid #bbb', padding: '6px 5px', fontSize: 11, fontWeight: 600, textAlign: (align as React.CSSProperties['textAlign']) || 'left', width: w }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resolvedItems.map((item, i) => (
              <tr key={item.id ?? i} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                <td style={td('center')}>{i + 1}</td>
                <td style={{ ...td('left'), fontFamily: 'monospace', fontSize: 10.5, color: '#555' }}>{item.productCode || '—'}</td>
                <td style={td('left')}>{item.productName}</td>
                <td style={td('center')}>{item.unit}</td>
                <td style={td('right')}>{item.quantity}</td>
                <td style={td('right')}>¥{Number(item.unitPrice).toFixed(2)}</td>
                <td style={{ ...td('right'), fontWeight: 600 }}>¥{Number(item.amount).toFixed(2)}</td>
                <td style={td('left')}>{item.remark || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PSection>

      {/* 金额汇总 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <div style={{ border: '1px solid #ccc', padding: '9px 14px', minWidth: 210 }}>
          <ARow label="商品种数" value={`${resolvedItems.length} 种`} />
          <ARow label="合计数量" value={String(resolvedItems.reduce((s, i) => s + Number(i.quantity), 0))} />
          <ARow label="订单总金额" value={`¥${total.toFixed(2)}`} total />
        </div>
      </div>

      {/* 签字区 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14, padding: '12px 0', borderTop: '1px solid #ddd', marginBottom: 10 }}>
        {['制单人', '审核人', '客户签字', '日期'].map(label => (
          <div key={label}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 22 }}>{label}</div>
            <div style={{ borderBottom: '1px solid #000' }} />
          </div>
        ))}
      </div>

      {/* 备注 */}
      {order.remark && (
        <div style={{ border: '1px solid #ddd', padding: '8px 10px', minHeight: 38, fontSize: 11, color: '#333', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>备注</div>
          <div>{order.remark}</div>
        </div>
      )}
    </div>
  )
}

// ─── 局部小组件 ───────────────────────────────────────────────────────────────

function PSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: '#666', marginBottom: 6, paddingBottom: 3, borderBottom: '1px solid #ddd' }}>{title}</div>
      {children}
    </div>
  )
}

function InfoItem({ label, value, style: s }: { label: string; value: string; style?: React.CSSProperties }) {
  return (
    <div style={s}>
      <span style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 1 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function td(align: string): React.CSSProperties {
  return { border: '1px solid #d0d0d0', padding: '6px 5px', fontSize: 11, verticalAlign: 'top', textAlign: align as React.CSSProperties['textAlign'] }
}

function ARow({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28, fontSize: total ? 13.5 : 12, fontWeight: total ? 700 : undefined, marginBottom: total ? 0 : 3, borderTop: total ? '1px solid #bbb' : undefined, marginTop: total ? 6 : undefined, paddingTop: total ? 6 : undefined }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}
