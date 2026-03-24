/**
 * confirmAction — 命令式全局确认弹窗 API
 *
 * 使用方式（与 toast 相同风格，无需在组件内维护 open 状态）：
 *
 * ```tsx
 * import { confirmAction } from '@/lib/confirm'
 *
 * // 危险操作（红色确认按钮）
 * confirmAction({
 *   title: '确认删除',
 *   description: '该操作不可撤销，是否继续？',
 *   onConfirm: () => del.mutate(id),
 * })
 *
 * // 普通确认（默认按钮）
 * confirmAction({
 *   title: '执行出库',
 *   description: '将扣减库存并完成销售单。',
 *   variant: 'default',
 *   confirmText: '确认出库',
 *   onConfirm: () => ship.mutate(id),
 * })
 * ```
 */

export interface ConfirmOptions {
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  /** 默认 'destructive'（红色） */
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel?: () => void
}

type ShowConfirmFn = (options: ConfirmOptions) => void

let _showFn: ShowConfirmFn | null = null

/** 由 GlobalConfirmDialog 组件在 mount 时注册，外部不需调用 */
export function _registerConfirmFn(fn: ShowConfirmFn): void {
  _showFn = fn
}

/**
 * 打开全局确认弹窗。
 * 组件未挂载（登录页等）时静默忽略。
 */
export function confirmAction(options: ConfirmOptions): void {
  if (_showFn) {
    _showFn(options)
  } else {
    console.warn('[confirmAction] GlobalConfirmDialog 未挂载，无法显示确认弹窗')
  }
}
