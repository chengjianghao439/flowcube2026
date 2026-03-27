/** 与 preload `showMessageBox` / 主进程 dialog.showMessageBox 对齐的载荷 */
export interface DesktopShowMessageBoxPayload {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message?: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  noLink?: boolean
}
