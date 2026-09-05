/**
 * OrderPrintOverlay — 通用订单打印预览遮罩
 *
 * 从数据库加载指定类型的打印模板，渲染预览，支持浏览器打印。
 * 替代原有的 SaleOrderPrintTemplate / PrintOrderDialog，统一四种订单的打印体验。
 */

import { createPortal, flushSync } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, X, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PrintPreviewZoomControls } from '@/components/shared/PrintPreviewZoomControls'
import { getPrintTemplateListApi } from '@/api/print-templates'
import { getLogoApi } from '@/api/settings'
import TemplateRenderer from './TemplateRenderer'
import type { PrintItem } from './TemplateRenderer'
import type { PrintTemplate } from '@/types/print-template'
import { isZplTemplateLayout } from '@/types/print-template'

const PRINT_STYLE_ID = 'fc-order-print-style'

/** CSS @page size 关键字：单据纸张只可能是 A4/A5/A6（编辑器纸张下拉已过滤热敏纸） */
function paperCssSize(paperSize: PrintTemplate['paperSize']): string {
  return paperSize === 'A5' || paperSize === 'A6' ? paperSize : 'A4'
}

/** 从模板布局读取页面边距（mm）；缺省与历史默认一致：上下 8 / 左右 0 */
function marginsOf(t: PrintTemplate | null): { top: number; bottom: number; left: number; right: number } {
  const layout = t?.layout
  if (!layout || isZplTemplateLayout(layout)) return { top: 8, bottom: 8, left: 0, right: 0 }
  const m = layout.margins
  const n = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    top: n(m?.top, 8),
    bottom: n(m?.bottom, 8),
    left: n(m?.left, 0),
    right: n(m?.right, 0),
  }
}

function buildPrintCss(t: PrintTemplate | null): string {
  const m = marginsOf(t)
  return `
@media print {
  body > *:not(#fc-print-root) { display: none !important; }
  #fc-print-root   { position: static !important; overflow: visible !important; background: #fff !important; }
  #fc-print-tb     { display: none !important; }
  #fc-print-page   { box-shadow: none !important; margin: 0 !important; width: 100% !important; height: auto !important; overflow: visible !important; transform: none !important; }
  /* 页边距读模板 layout.margins（编辑器「页边距」可调）：避免边缘裁切、续页不贴顶；左右边距参与避免 210mm 内容溢出 */
  @page            { size: ${paperCssSize(t?.paperSize ?? 'A4')}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
}
`
}

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
  const printRootRef = useRef<HTMLDivElement>(null)
  docZoomRef.current = docZoom

  // 公司 Logo（image 元素数据源）：与 BrandLogo/设置页共享查询键；未上传 url='' → 模板 image 元素不渲染
  const { data: brandLogo } = useQuery({
    queryKey: ['brand-logo'],
    queryFn: () => getLogoApi({ skipGlobalError: true }),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  // @page 边距跟随选中模板（layout.margins），切换模板时重写 style 标签
  useEffect(() => {
    const el = document.getElementById(PRINT_STYLE_ID)
    if (el) {
      el.textContent = buildPrintCss(selected)
    } else {
      const style = document.createElement('style')
      style.id = PRINT_STYLE_ID
      style.textContent = buildPrintCss(selected)
      document.head.appendChild(style)
    }
    return () => { document.getElementById(PRINT_STYLE_ID)?.remove() }
  }, [selected])

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

  /**
   * 打印前等待打印页内所有 <img> 完成解码（公司 Logo 等），避免首帧未解码导致打印空白。
   * decode() 失败（如 CORS/非法图片）时静默放行，不阻塞打印。
   */
  async function handlePrint() {
    const root = printRootRef.current
    if (root) {
      const imgs = Array.from(root.querySelectorAll('img'))
      await Promise.all(imgs.map(img => (img.decode?.() ?? Promise.resolve()).catch(() => {})))
    }
    window.print()
  }

  /** 传给 TemplateRenderer 的 data：把公司 Logo URL 注入 companyLogo 键（模板 image 元素取用） */
  const printData = { ...data, companyLogo: brandLogo?.url ?? '' }

  return createPortal(
    <div
      id="fc-print-root"
      ref={printRootRef}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, overflowY: 'auto', background: '#e0e0e0' }}
    >
      {/* 工具栏 */}
      <div
        id="fc-print-tb"
        style={{
          position: 'sticky', top: 0, zIndex: 1,
          background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', borderBottom: '1px solid hsl(var(--border))',
          padding: '10px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          gap: 12,
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>打印预览</span>
          <span style={{ color: '#bbb' }}>·</span>
          <span style={{ fontSize: 13, color: 'hsl(var(--foreground))' }}>{title}</span>
          <span style={{ color: '#bbb' }}>·</span>
          {loading ? (
            <span style={{ fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
              加载模板…
            </span>
          ) : selected ? (
            <button
              aria-label="选择打印模板"
              aria-expanded={showPicker}
              onClick={() => setShowPicker(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 6, border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--background))', cursor: 'pointer', fontSize: 13, color: 'hsl(var(--foreground))',
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
              background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 10, minWidth: 200, padding: 4,
            }}>
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSelected(t); setShowPicker(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px', border: 'none', background: t.id === selected?.id ? 'hsl(var(--accent))' : 'transparent',
                    color: t.id === selected?.id ? 'hsl(var(--primary))' : 'hsl(var(--popover-foreground))', cursor: 'pointer', borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  {t.name}
                  {t.isDefault && <span style={{ fontSize: 12, marginLeft: 6, color: 'hsl(var(--muted-foreground))' }}>默认</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0 }}>
          <PrintPreviewZoomControls value={docZoom} onChange={setDocZoom} compact />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={handlePrint} disabled={!selected}>
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
            <span>加载模板中…</span>
          </div>
        ) : selected ? (
          <div
            id="fc-print-page"
            style={{ background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}
          >
            <TemplateRenderer
              layout={selected.layout}
              paperSize={selected.paperSize}
              data={printData}
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
