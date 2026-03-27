/**
 * GlobalConfirmDialog
 *
 * 全局命令式确认弹窗的渲染层，挂载于 AppLayout 根节点（仅挂载一次）。
 * 通过 _registerConfirmFn 向 src/lib/confirm.ts 注册 showConfirm 函数，
 * 使得全局任意位置都可以用 confirmAction({...}) 打开弹窗。
 */

import { useState, useCallback, useEffect } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { _registerConfirmFn, type ConfirmOptions } from '@/lib/confirm'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

const INITIAL: ConfirmState = {
  open: false,
  title: '',
  description: '',
  onConfirm: () => {},
}

export function GlobalConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(INITIAL)

  const show = useCallback((options: ConfirmOptions) => {
    if (
      IS_ELECTRON_DESKTOP &&
      typeof window !== 'undefined' &&
      typeof window.flowcubeDesktop?.showMessageBox === 'function'
    ) {
      const variant = options.variant ?? 'destructive'
      const confirmLabel =
        options.confirmText ?? (variant === 'destructive' ? '确认' : '确认')
      void window.flowcubeDesktop
        .showMessageBox!({
          type: variant === 'destructive' ? 'warning' : 'question',
          title: options.title,
          message: options.description,
          buttons: [confirmLabel, options.cancelText ?? '取消'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 0) options.onConfirm()
          else options.onCancel?.()
        })
        .catch(() => options.onCancel?.())
      return
    }
    setState({ ...options, open: true })
  }, [])

  useEffect(() => {
    _registerConfirmFn(show)
  }, [show])

  function handleConfirm() {
    setState(s => ({ ...s, open: false }))
    state.onConfirm()
  }

  function handleCancel() {
    setState(s => ({ ...s, open: false }))
    state.onCancel?.()
  }

  return (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      description={state.description}
      confirmText={state.confirmText ?? (state.variant === 'destructive' ? '确认' : '确认')}
      cancelText={state.cancelText ?? '取消'}
      variant={state.variant ?? 'destructive'}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
