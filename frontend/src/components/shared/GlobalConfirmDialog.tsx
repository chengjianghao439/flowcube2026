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

  // 解析后的 variant 必须与渲染用的是同一个值：原先 confirmText 判定读的是 state.variant，
  // 而渲染用的是 state.variant ?? 'destructive'，未显式传 variant 时两者判断不同——
  // 死三元（'确认' : '确认'）把这个问题掩盖了。现在统一读解析后的 variant。
  const variant = state.variant ?? 'destructive'

  return (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      description={state.description}
      confirmText={state.confirmText ?? (variant === 'destructive' ? '确认执行' : '确定')}
      cancelText={state.cancelText ?? '取消'}
      variant={variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
