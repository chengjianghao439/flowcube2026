/**
 * Electron 用户已确认退出时，下一次 beforeunload 不再拦截（避免系统原生离开提示）。
 * 仅内存，刷新后失效。
 */
let allowOnce = false

export function setAllowUnloadOnce(): void {
  allowOnce = true
}

export function consumeAllowUnloadOnce(): boolean {
  if (!allowOnce) return false
  allowOnce = false
  return true
}
