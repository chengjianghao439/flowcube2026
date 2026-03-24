/**
 * toast — 全局提示条工具
 *
 * 使用方式：
 *   import { toast } from '@/lib/toast'
 *   toast.success('操作成功')
 *   toast.error('操作失败')
 *   toast.warning('请先选择客户')
 *
 * AppToast 组件挂载时会注册处理函数，
 * 调用早于挂载时不会报错（静默丢弃），
 * AppLayout 挂载后可立即使用。
 */

export type ToastType = 'success' | 'error' | 'warning'

type AddToastFn = (type: ToastType, message: string, duration?: number) => void

let _addFn: AddToastFn | null = null

/** AppToast 组件内部调用，注册实际的添加函数 */
export function _registerToastFn(fn: AddToastFn): void {
  _addFn = fn
}

function add(type: ToastType, message: string, duration?: number): void {
  if (!_addFn) {
    // AppToast 未挂载（如在路由守卫层触发），静默忽略
    return
  }
  _addFn(type, message, duration)
}

export const toast = {
  /** 绿色成功提示，默认 3 秒自动关闭 */
  success: (message: string, duration?: number) => add('success', message, duration),
  /** 红色失败提示，默认 4 秒自动关闭 */
  error:   (message: string, duration?: number) => add('error', message, duration ?? 4000),
  /** 橙色警告提示，默认 3 秒自动关闭 */
  warning: (message: string, duration?: number) => add('warning', message, duration),
}
