/**
 * 本机登录表单记忆：仅保存用户名，不保存密码。
 * 与 JWT 会话（sessionStorage）分离，关闭应用后需重新登录。
 */

const USERNAME_KEY = 'flowcube-saved-username'

export function loadSavedLoginForm(): {
  username: string
} {
  if (typeof localStorage === 'undefined') {
    return { username: '' }
  }
  const username = localStorage.getItem(USERNAME_KEY) ?? ''
  return { username }
}

export function persistLoginSuccess(
  username: string,
): void {
  if (typeof localStorage === 'undefined') return
  const u = username.trim()
  if (u) localStorage.setItem(USERNAME_KEY, u)
}
