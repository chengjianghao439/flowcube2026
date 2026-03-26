/**
 * 构建时由 Vite define 注入。
 * Electron 包与 desktop/package.json 一致；Web 与 frontend/package.json 一致。
 */
export const CURRENT_ERP_WEB_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
