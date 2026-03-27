/**
 * 构建时注入的运行时平台标识（与 Vite env 一致）。
 * 业务与组件请从这里引用，避免散落 `import.meta.env.VITE_*` 字符串比较。
 */
export const IS_ELECTRON_DESKTOP = import.meta.env.VITE_ELECTRON === '1'

/** Capacitor / Android PDA WebView 打包 */
export const IS_CAPACITOR_PDA = import.meta.env.VITE_CAPACITOR === '1'
