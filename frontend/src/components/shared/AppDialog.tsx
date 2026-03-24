/**
 * AppDialog — 全系统统一弹窗基础组件
 *
 * 特性：
 * - 右下角拖拽 resize（可关闭）
 * - 尺寸持久化至 localStorage（key: flowcube-dialog-size-{dialogId}）
 * - 结构固定：Header(固定) / Body(flex-1 overflow-hidden) / Footer(固定)
 * - 不使用 shadcn DialogContent，直接使用 Radix Dialog.Content 原语，获得完整样式控制
 * - 位置：打开时居中计算，resize 期间左上角保持锚定
 *
 * 默认尺寸：
 *   width:     900px   minWidth:  600px
 *   height:    600px   minHeight: 400px
 *   maxWidth:  95vw（由 resize handler 动态限制）
 *   maxHeight: 90vh（由 resize handler 动态限制）
 *
 * 按钮层级约定（在 footer 中）：
 *   destructive → outline → default（从左到右，primary 在最右）
 *
 * 使用示例：
 * ```tsx
 * <AppDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   dialogId="my-feature"
 *   title="功能标题"
 *   footer={
 *     <>
 *       <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
 *       <Button onClick={handleConfirm}>确认</Button>
 *     </>
 *   }
 * >
 *   内容区域
 * </AppDialog>
 * ```
 */

import { useLayoutEffect, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DialogPortal, DialogOverlay } from '@/components/ui/dialog'
import { useResizableDialog } from '@/hooks/useResizableDialog'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void

  /**
   * 弹窗唯一标识，用于 localStorage 持久化 key。
   * 同类弹窗共用同一个 dialogId 即可共享尺寸记忆。
   */
  dialogId: string

  /** 顶部标题（Header 区域） */
  title: React.ReactNode

  /** Body 区域内容（flex-1 + overflow-hidden，内部自行控制滚动） */
  children: React.ReactNode

  /** Footer 区域内容（固定在底部，通常放操作按钮） */
  footer?: React.ReactNode

  /** 初始/默认宽度（px），默认 900 */
  defaultWidth?: number

  /** 初始/默认高度（px），默认 600 */
  defaultHeight?: number

  /** 最小宽度（px），默认 600 */
  minWidth?: number

  /** 最小高度（px），默认 400 */
  minHeight?: number

  /**
   * 是否启用右下角拖拽 resize 与尺寸持久化，默认 true。
   * 小型确认框等场景可设为 false。
   */
  resizable?: boolean
}

// ─── Resize Handle ────────────────────────────────────────────────────────────

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="absolute bottom-0 right-0 flex h-6 w-6 cursor-se-resize select-none items-end justify-end pb-1.5 pr-1.5"
      onMouseDown={onMouseDown}
      aria-hidden="true"
    >
      {/* 3 点对角排列，经典 resize 视觉 */}
      <svg width="10" height="10" viewBox="0 0 10 10" className="text-muted-foreground/35">
        <circle cx="9" cy="9" r="1.5" fill="currentColor" />
        <circle cx="5" cy="9" r="1.5" fill="currentColor" />
        <circle cx="9" cy="5" r="1.5" fill="currentColor" />
      </svg>
    </div>
  )
}

// ─── AppDialog ────────────────────────────────────────────────────────────────

export function AppDialog({
  open,
  onOpenChange,
  dialogId,
  title,
  children,
  footer,
  defaultWidth  = 900,
  defaultHeight = 600,
  minWidth      = 600,
  minHeight     = 400,
  resizable     = true,
}: AppDialogProps) {
  const { width, height, handleResizeMouseDown } = useResizableDialog({
    dialogId,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    resizable,
  })

  /**
   * 弹窗位置：
   * - 打开时居中计算一次
   * - resize 过程中左上角保持锚定（仅改变宽高，不改变 left/top）
   * - 使用 useLayoutEffect 确保位置在浏览器绘制前就已正确，避免闪烁
   */
  const [pos, setPos] = useState(() => ({
    left: Math.max(0, Math.floor((window.innerWidth  - defaultWidth)  / 2)),
    top:  Math.max(0, Math.floor((window.innerHeight - defaultHeight) / 2)),
  }))

  useLayoutEffect(() => {
    if (open) {
      setPos({
        left: Math.max(0, Math.floor((window.innerWidth  - width)  / 2)),
        top:  Math.max(0, Math.floor((window.innerHeight - height) / 2)),
      })
    }
  // 仅在 open 变化时重新居中，resize 过程中保持 pos 不变
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        {/* 半透明背景遮罩 */}
        <DialogOverlay />

        {/* 弹窗主体：使用 Radix Content 原语，完全控制位置和尺寸 */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed z-50 flex flex-col rounded-lg border bg-background shadow-xl',
            'focus:outline-none',
            // 进入/退出动画
            'data-[state=open]:animate-in   data-[state=open]:fade-in-0   data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'duration-200',
          )}
          style={{
            left:   pos.left,
            top:    pos.top,
            width,
            height,
          }}
        >
          {/* ── Header（固定，h-14） ── */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-5">
            <DialogPrimitive.Title className="text-base font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className={cn(
                'rounded-md p-1.5 text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
          </div>

          {/* ── Body（flex-1，overflow-hidden，内部自行控制滚动） ── */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {children}
          </div>

          {/* ── Footer（固定，仅在有内容时渲染） ── */}
          {footer && (
            <div className="shrink-0 border-t bg-muted/20 px-5 py-3">
              {footer}
            </div>
          )}

          {/* ── Resize Handle（右下角，仅 resizable=true 时显示） ── */}
          {resizable && <ResizeHandle onMouseDown={handleResizeMouseDown} />}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}
