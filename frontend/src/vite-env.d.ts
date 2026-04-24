/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_ELECTRON?: string
  /**
   * ERP 生产 API 根（不含 /api）。
   * 这是桌面安装包 / 安卓 PDA APK 的 build-time default；
   * runtime override 统一使用 API_BASE_URL。
   * 例：https://api.example.com 或 http://192.168.1.10:3000
   */
  readonly VITE_ERP_PRODUCTION_ORIGIN?: string
  /**
   * 仅 PDA APK 可选兜底地址。为空时不做额外回退，避免把生产地址写死到包里。
   */
  readonly VITE_PDA_FALLBACK_API_ORIGIN?: string
}

interface Window {
  __FLOWCUBE_DEFAULT_API_ORIGIN__?: string
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
    /** 当前桌面工作站标识 */
    getClientInfo?: () => Promise<{ clientId: string; hostname: string }>
    /** 主进程：按 printerName 本机 RAW 出 ZPL / TSPL */
    printZpl?: (opts: { content: string; printerName: string }) => Promise<null>
  }
}
