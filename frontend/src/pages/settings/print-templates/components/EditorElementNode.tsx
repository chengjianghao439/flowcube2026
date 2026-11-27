import type React from 'react'
import { Image as ImageIcon } from 'lucide-react'
import BarcodePreview from '@/components/print/BarcodePreview'
import { TABLE_COLUMN_OPTIONS } from '@/constants/printFieldDefs'
import type { PreviewTableRow } from '@/lib/printTemplatePreview'
import type { TemplateElement } from '@/types/print-template'
import { labelFontMm, labelText, type ResizeDir } from './editorUtils'

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
  previewItems: PreviewTableRow[]
  useRealData: boolean
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

export function ElementNode({ el, selected, preview, previewData, previewItems, useRealData, scale, isLabel, onMouseDown, onClick, onResizeStart, onFocusSelect, onColumnResizeStart }: ElementNodeProps) {
  const px = (mm: number) => mm * scale
  const showData = preview || useRealData

  const style: React.CSSProperties = {
    position: 'absolute',
    left:     px(el.x),
    top:      px(el.y),
    width:    px(el.width),
    height:   px(el.height),
    fontSize: isLabel ? `${labelFontMm(el) * scale}px` : `${el.fontSize * scale * 0.35}px`,
    fontWeight: isLabel ? 'normal' : el.fontWeight,
    textAlign: el.textAlign,
    border:   (!isLabel && el.border && el.type !== 'table') ? '1px solid #999' : undefined,
    outline:  (!preview && selected) ? '2px solid hsl(var(--primary))' : undefined,
    cursor:   preview ? 'default' : 'move',
    overflow: (!preview && selected) ? 'visible' : 'hidden',
    boxSizing: 'border-box',
    padding:  el.type === 'divider' ? '0' : '1px 2px',
    userSelect: 'none',
    background: !preview && selected ? 'hsl(var(--primary)/0.05)' : undefined,
  }

  let content: React.ReactNode
  if (isLabel) {
    content = <span className="sr-only">{labelText(el, previewData)}</span>
  } else if (el.type === 'image') {
    const src = previewData[el.fieldKey] ?? ''
    content = showData && src ? (
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
    const v = useRealData ? (previewData[el.fieldKey] ?? '') : ((previewData[el.fieldKey] ?? '') || el.label)
    content = showData
      ? <div style={{ width: '100%', height: '100%', padding: '1px 2px' }}>
          <BarcodePreview value={v} symbology={el.barcodeSymbology} hri={el.barcodeHRI} />
        </div>
      : <span className="text-muted-foreground">{el.label}（{el.barcodeSymbology === 'ean13' ? 'EAN13' : '条码'}）</span>
  } else if (el.type === 'table') {
    const cols = el.tableColumns ?? ['name', 'qty', 'price', 'amount']
    const showIndex = el.showIndex !== false
    const allCols = showIndex ? ['#', ...cols] : cols
    const colDefs = allCols.map(k => TABLE_COLUMN_OPTIONS.find(c => c.key === k) ?? { key: k, label: k, align: 'left' as const })
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
          {(preview ? previewItems : previewItems.slice(0, 2)).map((row, i) => (
            <tr key={i}>
              {allCols.map(k => {
                const raw = k === '#' ? String(i + 1) : (row as Record<string, string>)[k] ?? ''
                const cell = k === 'name' && el.nameAttrs?.length
                  ? (() => {
                      const parts = el.nameAttrs.map(a => (row as Record<string, string>)[a] ?? '').filter(v => String(v).trim() !== '')
                      return parts.length ? `${raw} [${parts.join('] [')}]` : raw
                    })()
                  : raw
                const previewCode = preview && k === 'code'
                return <td key={k} title={previewCode ? cell : undefined} style={{
                  ...cellStyle,
                  width: `${widthMmOf(k) * scale}px`,
                  ...(previewCode && { wordBreak: 'normal', overflowWrap: wrap ? 'anywhere' : undefined }),
                }}>
                  {previewCode && !wrap ? <span className="block overflow-x-auto">{cell}</span> : cell}
                </td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else {
    const docText = previewData[el.fieldKey] ?? ''
    const isDocTitle = !isLabel && el.type === 'title'
    content = showData
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
