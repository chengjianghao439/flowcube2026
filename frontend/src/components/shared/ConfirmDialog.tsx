/**
 * ConfirmDialog — 全系统通用确认弹窗
 *
 * 基于 AppDialog，尺寸固定（不可拖拽 resize），保持原有 API 完全不变。
 *
 * API（与迁移前完全一致）：
 *   open, title, description, confirmText, cancelText, variant, loading, onConfirm, onCancel
 */

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppDialog } from '@/components/shared/AppDialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText  = '取消',
  variant     = 'default',
  loading     = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AppDialog
      open={open}
      onOpenChange={v => {
        if (!v) {
          if (loading) return
          onCancel()
        }
      }}
      dialogId="confirm-dialog"
      resizable={false}
      defaultWidth={440}
      defaultHeight={210}
      minWidth={360}
      minHeight={180}
      title={
        <span className="flex items-center gap-2">
          {variant === 'destructive' && (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          )}
          {title}
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? '处理中...' : confirmText}
          </Button>
        </div>
      }
    >
      {/* Body：description 文字，带自动滚动 */}
      <div className="overflow-auto px-5 py-4 text-sm text-muted-foreground">
        {description}
      </div>
    </AppDialog>
  )
}
