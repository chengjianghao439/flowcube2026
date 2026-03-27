/**
 * GlobalConfirmDialog
 *
 * 通过 confirmAction({...}) 触发的全局确认；渲染层统一走 ConfirmDialog
 *（桌面端由 ConfirmDialog 内部改为原生 messageBox，无需在此重复分支）。
 */

import { useState, useCallback, useEffect } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { _registerConfirmFn, type ConfirmOptions } from '@/lib/confirm'

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
    setState({ ...options, open: true })
  }, [])

  useEffect(() => {
    _registerConfirmFn(show)
  }, [show])

  function handleConfirm() {
    const fn = state.onConfirm
    setState(s => ({ ...s, open: false }))
    fn()
  }

  function handleCancel() {
    const fn = state.onCancel
    setState(s => ({ ...s, open: false }))
    fn?.()
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
