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
