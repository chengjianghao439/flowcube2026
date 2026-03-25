/**
 * 401 跳转登录：Electron 使用 HashRouter，需改 hash 而非整页 path。
 */
function routeLooksLikePda(): boolean {
  if (import.meta.env.VITE_ELECTRON === '1') {
    const h = (window.location.hash.replace(/^#/, '').split('?')[0] || '/').trim()
    return h.startsWith('/pda')
  }
  return window.location.pathname.startsWith('/pda')
}

export function redirectToLoginAfterUnauthorized(): void {
  const loginPath = routeLooksLikePda() ? '/pda/login' : '/login'
  if (import.meta.env.VITE_ELECTRON === '1') {
    window.location.hash = `#${loginPath}`
    return
  }
  window.location.href = loginPath
}
