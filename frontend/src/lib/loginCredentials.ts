/**
 * 本机登录表单记忆：用户名默认记住；密码仅在勾选「记住密码」时写入 localStorage。
 * 与 JWT 会话（sessionStorage）分离，关闭应用后需重新登录，但可带出账号/密码。
 */

const USERNAME_KEY = 'flowcube-saved-username'
const PASSWORD_KEY = 'flowcube-saved-password'
const REMEMBER_PWD_FLAG = 'flowcube-remember-password'

export function loadSavedLoginForm(): {
  username: string
  password: string
  rememberPassword: boolean
} {
  if (typeof localStorage === 'undefined') {
    return { username: '', password: '', rememberPassword: false }
  }
  const username = localStorage.getItem(USERNAME_KEY) ?? ''
  const rememberPassword = localStorage.getItem(REMEMBER_PWD_FLAG) === '1'
  const password = rememberPassword ? (localStorage.getItem(PASSWORD_KEY) ?? '') : ''
  return { username, password, rememberPassword }
}

export function persistLoginSuccess(
  username: string,
  password: string,
  rememberPassword: boolean,
): void {
  if (typeof localStorage === 'undefined') return
  const u = username.trim()
  if (u) localStorage.setItem(USERNAME_KEY, u)
  if (rememberPassword) {
    localStorage.setItem(PASSWORD_KEY, password)
    localStorage.setItem(REMEMBER_PWD_FLAG, '1')
  } else {
    localStorage.removeItem(PASSWORD_KEY)
    localStorage.setItem(REMEMBER_PWD_FLAG, '0')
  }
}
