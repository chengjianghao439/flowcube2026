/**
 * 登录态持久化与整页跳转退出（Hash 路由，replace 防后退进入已退出态）。
 */
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'

function routeLooksLikePda(): boolean {
  const h = (window.location.hash.replace(/^#/, '').split('?')[0] || '/').trim()
  return h.startsWith('/pda')
}

/** 仅清状态（不跳转），等同于 store.logout */
export function clearAuthPersistedState(): void {
  useWorkspaceStore.getState().closeAll()
  useAuthStore.getState().logout()
}

/**
 * 使用 replace 进入登录页。
 * 不再向 history push，避免后退回到需登录页。
 */
export function redirectReplaceToLogin(): void {
  const loginPath = routeLooksLikePda() ? '/pda/login' : '/login'
  const prefix = window.location.href.split('#')[0]
  window.location.replace(`${prefix}#${loginPath}`)
}

/** 清状态并整页 replace 到登录（401、主动退出等） */
export function performSessionLogout(): void {
  useWorkspaceStore.getState().closeAll()
  useAuthStore.getState().logout()
  redirectReplaceToLogin()
}
