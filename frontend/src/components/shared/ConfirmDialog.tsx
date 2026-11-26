/**
 * ConfirmDialog — 全系统通用确认弹窗
 *
 * - **Electron 桌面端**：使用主进程 `dialog.showMessageBox`（与系统原生一致），不渲染 AppDialog。
 * - **浏览器 / 无桥接**：使用 AppDialog（可拖拽、与现有布局一致）。
 *
 * API 不变：open, title, description, confirmText, cancelText, variant, loading, onConfirm, onCancel
 */

import { useLayoutEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppDialog } from '@/components/shared/AppDialog'
import { isElectronRuntime } from '@/lib/platform'

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
  /** 浏览器弹窗关闭后的焦点归属；原生桌面确认仍由系统管理。 */
  onCloseAutoFocus?: (event: Event) => void
}

function useNativeConfirmAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    isElectronRuntime() &&
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
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  const native = useNativeConfirmAvailable()
  const latest = useRef({ onConfirm, onCancel })
  useLayoutEffect(() => { latest.current = { onConfirm, onCancel } })
  const nativePrompt = useRef<{ signature: string; answer: Promise<{ response: number }> } | null>(null)
  useLayoutEffect(() => {
    if (!native || !open) {
      nativePrompt.current = null
      return
    }
    const signature = JSON.stringify([title, description, confirmText, cancelText, variant])
    if (nativePrompt.current?.signature !== signature) {
      const answer = window.flowcubeDesktop!.showMessageBox!({
        type: variant === 'destructive' ? 'warning' : 'question',
        title,
        message: description,
        buttons: [confirmText, cancelText],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      nativePrompt.current = { signature, answer }
    }
    let active = true
    void nativePrompt.current.answer.then(({ response }) => {
      if (!active) return
      if (response === 0) latest.current.onConfirm()
      else latest.current.onCancel()
    }, () => {
      if (active) latest.current.onCancel()
    })
    return () => { active = false }
  }, [open, native, title, description, confirmText, cancelText, variant])

  if (native) {
    return null
  }

  return (
    <AppDialog
      open={open}
      onCloseAutoFocus={onCloseAutoFocus}
      onOpenChange={v => {
        if (!v) {
          if (loading) return
          onCancel()
        }
      }}
      dialogId="confirm-dialog"
      resizable={false}
      sizeToContent
      description={description}
      defaultWidth={520}
      defaultHeight={250}
      minWidth={360}
      minHeight={180}
      title={
        <span className="flex items-center gap-2">
          {variant === 'destructive' && (
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive-ink" aria-hidden />
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
            {loading ? '处理中…' : confirmText}
          </Button>
        </div>
      }
    />
  )
}
