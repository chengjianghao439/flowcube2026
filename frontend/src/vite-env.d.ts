/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ELECTRON?: string
}

interface Window {
  /** PDA：ZPL 经后端 POST /api/print-jobs 入队，由打印客户端执行 */
  printLabel?: (zpl: string) => Promise<void>
  /** Electron 预加载脚本注入 */
  flowcubeDesktop?: { isDesktop: boolean }
}
