import type React from 'react'
import {
  Table2, Type, SeparatorHorizontal, Barcode,
  Image as ImageIcon, ChevronUp, ChevronDown, X,
} from 'lucide-react'
import type { PrintFieldDef } from '@/constants/printFieldDefs'
import type { TemplateElement } from '@/types/print-template'

/** 字段类型 → 面板图标映射（字段元数据不混入 JSX，见 printFieldDefs.ts） */
function fieldIcon(f: PrintFieldDef): React.ReactNode {
  switch (f.type) {
    case 'barcode': return <Barcode className="size-3.5" />
    case 'table':   return <Table2 className="size-3.5" />
    case 'divider': return <SeparatorHorizontal className="size-3.5" />
    case 'image':   return <ImageIcon className="size-3.5" />
    default:        return <Type className="size-3.5" />
  }
}

export function PalettePanel({
  fields,
  hint,
  onDragStart,
  layers,
  selectedIds,
  onSelectLayer,
  onMoveLayer,
  onDeleteLayer,
  showLayers,
}: {
  fields: PrintFieldDef[]
  hint?: string
  onDragStart: (field: PrintFieldDef) => void
  /** 图层列表（= elements 数组，渲染顺序即 z 序；评审 P2） */
  layers: TemplateElement[]
  selectedIds: string[]
  onSelectLayer: (id: string, additive: boolean) => void
  onMoveLayer: (id: string, dir: -1 | 1) => void
  onDeleteLayer: (id: string) => void
  showLayers: boolean
}) {
  return (
    <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r bg-muted/20">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium text-foreground">字段列表</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint ?? '拖拽字段到画布'}</p>
      </div>
      {showLayers ? (
        <>
          <div className="max-h-[42%] overflow-y-auto p-3 space-y-1">
            {fields.map(f => (
              <div
                key={f.key}
                draggable
                onDragStart={() => onDragStart(f)}
                className="flex cursor-grab items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-sm hover:border-primary/50 hover:bg-primary/5 active:cursor-grabbing select-none"
              >
                <span className="text-muted-foreground">{fieldIcon(f)}</span>
                <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{f.label}</span>
              </div>
            ))}
          </div>
          {/* 元素图层（评审 P2）：列表点击选中、上下移动调 z 序、× 删除——重叠元素不再只能「删了重加」 */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/60">
            <div className="px-4 py-2.5">
              <p className="text-sm font-medium text-foreground">元素图层</p>
              <p className="mt-0.5 text-xs text-muted-foreground">越靠上越先绘制（可重叠置顶置底）</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 space-y-1">
              {layers.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  画布上暂无元素
                </div>
              )}
              {layers.map((el, idx) => (
                <div
                  key={el.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                    selectedIds.includes(el.id)
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-primary/40'
                  }`}
                  onClick={(e) => onSelectLayer(el.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                >
                  <span className="w-5 shrink-0 text-center text-[10px] text-muted-foreground/70">{idx + 1}</span>
                  <span className="shrink-0">{fieldIcon({ key: el.fieldKey, label: el.label, type: el.type === 'image' ? 'image' : el.type === 'barcode' ? 'barcode' : el.type === 'table' ? 'table' : el.type === 'divider' ? 'divider' : 'text' })}</span>
                  <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{el.label || el.fieldKey}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                    title="上移（更早绘制，垫底）"
                    aria-label={`上移元素 ${el.label || el.fieldKey}`}
                    disabled={idx === 0}
                    onClick={(e) => { e.stopPropagation(); onMoveLayer(el.id, -1) }}
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                    title="下移（更晚绘制，置顶）"
                    aria-label={`下移元素 ${el.label || el.fieldKey}`}
                    disabled={idx === layers.length - 1}
                    onClick={(e) => { e.stopPropagation(); onMoveLayer(el.id, 1) }}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive-ink"
                    title="删除元素"
                    aria-label={`删除元素 ${el.label || el.fieldKey}`}
                    onClick={(e) => { e.stopPropagation(); onDeleteLayer(el.id) }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {fields.map(f => (
            <div
              key={f.key}
              draggable
              onDragStart={() => onDragStart(f)}
              className="flex cursor-grab items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-sm hover:border-primary/50 hover:bg-primary/5 active:cursor-grabbing select-none"
            >
              <span className="text-muted-foreground">{fieldIcon(f)}</span>
              <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{f.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
