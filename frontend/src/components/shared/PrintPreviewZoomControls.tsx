/**
 * 单据/标签对话框内预览缩放（不改变打印内容：缩放作用在 printRef 外层，打印仍取 ref 内 HTML）
 */
import { Button } from '@/components/ui/button'
import { ZoomIn, ZoomOut } from 'lucide-react'

export const PRINT_PREVIEW_ZOOM_MIN = 0.5
export const PRINT_PREVIEW_ZOOM_MAX = 2.5
export const PRINT_PREVIEW_ZOOM_STEP = 0.1

export function clampPrintPreviewZoom(z: number) {
  return Math.min(PRINT_PREVIEW_ZOOM_MAX, Math.max(PRINT_PREVIEW_ZOOM_MIN, Math.round(z * 100) / 100))
}

interface PrintPreviewZoomControlsProps {
  value: number
  onChange: (z: number) => void
  /** 紧凑模式：用于对话框工具条 */
  compact?: boolean
  className?: string
}

export function PrintPreviewZoomControls({
  value,
  onChange,
  compact = true,
  className = '',
}: PrintPreviewZoomControlsProps) {
  return (
    <div
      className={[
        'flex items-center gap-1 rounded-md border border-border bg-muted/30',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
        className,
      ].join(' ')}
    >
      <span className={`text-muted-foreground ${compact ? 'text-[10px] px-0.5' : 'text-xs'}`}>预览</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={compact ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0'}
        disabled={value <= PRINT_PREVIEW_ZOOM_MIN + 1e-6}
        onClick={() => onChange(clampPrintPreviewZoom(value - PRINT_PREVIEW_ZOOM_STEP))}
        title="缩小"
      >
        <ZoomOut className="size-3.5" />
      </Button>
      <span
        className={`min-w-[2.75rem] text-center tabular-nums text-muted-foreground ${
          compact ? 'text-[11px]' : 'text-xs'
        }`}
      >
        {Math.round(value * 100)}%
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={compact ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0'}
        disabled={value >= PRINT_PREVIEW_ZOOM_MAX - 1e-6}
        onClick={() => onChange(clampPrintPreviewZoom(value + PRINT_PREVIEW_ZOOM_STEP))}
        title="放大"
      >
        <ZoomIn className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={compact ? 'h-7 px-1.5 text-[10px]' : 'h-8 px-2 text-xs'}
        onClick={() => onChange(1)}
        title="100%"
      >
        重置
      </Button>
    </div>
  )
}
