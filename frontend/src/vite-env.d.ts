/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_ELECTRON?: string
  /** 非 192.168 / localhost 的页面 hostname 对应的 ERP API 生产根地址，如 https://api.example.com */
  readonly VITE_ERP_PRODUCTION_ORIGIN?: string
}

interface Window {
  /** PDA：ZPL 经后端 POST /api/print-jobs 入队，由打印客户端执行 */
  printLabel?: (zpl: string) => Promise<void>
  /** Electron 预加载脚本注入 */
  flowcubeDesktop?: {
    isDesktop: boolean
    notifyApiOriginReady?: (origin: string) => void
    /** 主进程请求关闭窗口，由 DesktopQuitDialog 展示确认 */
    onCloseRequest?: (cb: () => void) => () => void
    /** 用户确认退出，通知主进程关闭窗口 */
    acceptClose?: () => void
    /** 主进程替代 showMessageBox */
    onDesktopMessageBox?: (cb: (payload: {
      id: string
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title: string
      message: string
      detail?: string
      buttons: string[]
      defaultId?: number
      cancelId?: number
    }) => void) => () => void
    sendDesktopMessageBoxResponse?: (id: string, response: number) => void
    /** 本机已安装打印机列表，与系统设置中一致 */
    getSystemPrinters?: () => Promise<
      Array<{
        name: string
        displayName: string
        description: string
        status: number
        isDefault: boolean
      }>
    >
  }
}
