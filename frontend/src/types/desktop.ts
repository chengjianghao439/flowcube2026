/** 主进程 showMessageBox 映射到渲染层 AppDialog */
export interface DesktopMessageBoxPayload {
  id: string
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}
