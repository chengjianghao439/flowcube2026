/** PDA 构建入口与原生运行时独立，浏览器也可运行 PDA 构建。 */
export const IS_CAPACITOR_PDA = import.meta.env.VITE_CAPACITOR === '1'

/** 网页与桌面共用 VITE_ELECTRON 构建。只有 preload 标记的桥可以提供桌面能力。 */
export function getElectronBridge(): Window['flowcubeDesktop'] {
  if (typeof window === 'undefined') return undefined
  const bridge = window.flowcubeDesktop
  return bridge?.isDesktop === true ? bridge : undefined
}

export function isElectronRuntime(): boolean {
  return Boolean(getElectronBridge())
}

export const DESKTOP_UPDATE_OPEN_EVENT = 'flowcube-open-update'

export function openDesktopUpdateCenter() {
  window.dispatchEvent(new Event(DESKTOP_UPDATE_OPEN_EVENT))
}
