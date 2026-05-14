/**
 * OrderPrintOverlay — 通用订单打印预览遮罩
 *
 * 从数据库加载指定类型的打印模板，渲染预览，支持浏览器打印。
 * 替代原有的 SaleOrderPrintTemplate / PrintOrderDialog，统一四种订单的打印体验。
 */

import { createPortal, flushSync } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Printer, X, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PrintPreviewZoomControls } from '@/components/shared/PrintPreviewZoomControls'
import { getPrintTemplateListApi } from '@/api/print-templates'
import TemplateRenderer from './TemplateRenderer'
import type { PrintItem } from './TemplateRenderer'
import type { PrintTemplate } from '@/types/print-template'

const PRINT_STYLE_ID = 'fc-order-print-style'
const PRINT_CSS = `
@media print {
  body > *:not(#fc-print-root) { display: none !important; }
  #fc-print-root   { position: static !important; overflow: visible !important; background: #fff !important; }
  #fc-print-tb     { display: none !important; }
  #fc-print-page   { box-shadow: none !important; margin: 0 !important; width: 100% !important; height: auto !important; overflow: visible !important; transform: none !important; }
  @page            { size: A4; margin: 0; }
}
`

export interface OrderPrintOverlayProps {
  templateType: number
  title: string
  data: Record<string, string>
  items: PrintItem[]
  onClose: () => void
}

export function OrderPrintOverlay({ templateType, title, data, items, onClose }: OrderPrintOverlayProps) {
  const [templates, setTemplates] = useState<PrintTemplate[]>([])
  const [selected,  setSelected]  = useState<PrintTemplate | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [docZoom, setDocZoom] = useState(1)
  const prePrintZoomRef = useRef(1)
  const docZoomRef = useRef(1)
  docZoomRef.current = docZoom

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

  useEffect(() => {
    setLoading(true)
    getPrintTemplateListApi({ type: templateType })
      .then(res => {
        const list = res ?? []
        setTemplates(list)
        setSelected(list.find(t => t.isDefault) ?? list[0] ?? null)
      })
      .catch(() => setSelected(null))
      .finally(() => setLoading(false))
  }, [templateType])

  return createPortal(
    <div
      id="fc-print-root"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, overflowY: 'auto', background: '#e0e0e0' }}
    >
      {/* 工具栏 */}
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
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>打印预览</span>
          <span style={{ color: '#bbb' }}>·</span>
          <span style={{ fontSize: 13, color: '#333' }}>{title}</span>
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

        <div style={{ flexShrink: 0 }}>
          <PrintPreviewZoomControls value={docZoom} onChange={setDocZoom} compact />
        </div>

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

      {/* 纸张预览 */}
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
              data={data}
              items={items}
              displayScale={docZoom}
            />
          </div>
        ) : (
          <div style={{
            marginTop: 60, padding: '32px 48px', background: '#fff', borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.1)', textAlign: 'center', color: '#666',
          }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>暂无可用的打印模板</p>
            <p style={{ fontSize: 13 }}>
              请前往 <strong>系统设置 → 打印模板</strong> 创建对应类型的模板后再打印。
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
