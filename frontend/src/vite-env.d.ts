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
  flowcubeDesktop?: { isDesktop: boolean }
}
