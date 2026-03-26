/** 构建时由 Vite define 注入，与 frontend/package.json version 一致（类型见 vite-env.d.ts） */
export const CURRENT_ERP_WEB_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.2.1'
