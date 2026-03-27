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
    /** 主进程发现新版本时推送；返回取消订阅函数 */
    subscribeUpdateAvailable?: (cb: (payload: {
      version: string
      notes: string
      downloadUrl: string
      current: string
      forceDebug?: boolean
    }) => void) => () => void
    getAppVersion?: () => Promise<string>
    isPackaged?: () => Promise<boolean>
    startUpdateDownload?: (downloadUrl: string) => Promise<void>
    ignoreUpdateVersion?: (version: string) => Promise<void>
    notifyApiOriginReady?: (origin: string) => void
    /** 渲染层已确认后通知主进程关闭窗口 */
    acceptClose?: () => void
    /** 系统原生 messageBox（与 Electron dialog.showMessageBox 一致） */
    showMessageBox?: (payload: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message?: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
      noLink?: boolean
    }) => Promise<{ response: number }>
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
    /** 主进程：按 printerName 本机 RAW 出 ZPL */
    printZpl?: (opts: { content: string; printerName: string }) => Promise<null>
  }
}
