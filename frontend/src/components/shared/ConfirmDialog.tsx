/**
 * ConfirmDialog — 全系统通用确认弹窗
 *
 * - **Electron 桌面端**：使用主进程 `dialog.showMessageBox`（与系统原生一致），不渲染 AppDialog。
 * - **浏览器 / 无桥接**：使用 AppDialog（可拖拽、与现有布局一致）。
 *
 * API 不变：open, title, description, confirmText, cancelText, variant, loading, onConfirm, onCancel
 */

import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppDialog } from '@/components/shared/AppDialog'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

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

function useNativeConfirmAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    IS_ELECTRON_DESKTOP &&
    typeof window.flowcubeDesktop?.showMessageBox === 'function'
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const native = useNativeConfirmAvailable()
  const handledRef = useRef(false)

  useEffect(() => {
    if (!native) return
    if (!open) {
      handledRef.current = false
      return
    }
    if (handledRef.current) return
    handledRef.current = true
    let cancelled = false
    void window.flowcubeDesktop!
      .showMessageBox!({
        type: variant === 'destructive' ? 'warning' : 'question',
        title,
        message: description,
        buttons: [confirmText, cancelText],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (cancelled) return
        if (response === 0) onConfirm()
        else onCancel()
      })
      .catch(() => {
        if (!cancelled) onCancel()
      })
    return () => {
      cancelled = true
    }
  }, [open, native, title, description, confirmText, cancelText, variant, onConfirm, onCancel])

  if (native) {
    return null
  }

  if (!open) {
    return null
  }

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
      <div className="overflow-auto px-5 py-4 text-sm text-muted-foreground">
        {description}
      </div>
    </AppDialog>
  )
}
