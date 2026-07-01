/**
 * 构建时注入的运行时平台标识（与 Vite env 一致）。
 *
 * 交付形态：
 * - **桌面 ERP**：`npm run dev` / `npm run build`（`VITE_ELECTRON=1`），仅随 Electron 安装包分发，非独立 Web 站点。
 * - **安卓 PDA**：`npm run dev:pda` / `npm run build:pda`（`VITE_CAPACITOR=1`）。
 */
export const IS_ELECTRON_DESKTOP = import.meta.env.VITE_ELECTRON === '1'

/** Capacitor / Android PDA WebView 打包 */
export const IS_CAPACITOR_PDA = import.meta.env.VITE_CAPACITOR === '1'

/**
 * 运行时是否真的运行在 Electron 桌面壳内。
 *
 * ⚠️ 不要用 IS_ELECTRON_DESKTOP（VITE_ELECTRON 构建期常量）来判断「是不是桌面」：
 * 生产浏览器端同样用 Electron target 构建（VITE_ELECTRON=1），该常量也为 true，
 * 会把普通网页用户误当成桌面安装包（曾导致网页端被「安装包未配置服务器地址」门控挡死）。
 * 真正的桌面壳由 preload 注入 window.flowcubeDesktop，浏览器里不存在，故以此作运行时判据。
 */
export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && !!window.flowcubeDesktop
}
