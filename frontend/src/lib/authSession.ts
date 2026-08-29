/**
 * 登录态持久化与整页跳转退出（Hash 路由，replace 防后退进入已退出态）。
 */
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { queryClient } from '@/lib/queryClient'
import { logoutApi } from '@/api/auth'

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
  // 先取 refreshToken 再清状态，作废服务端会话（一次性轮换：登出后泄露的 refresh 无法续期）
  const refreshToken = useAuthStore.getState().refreshToken
  useWorkspaceStore.getState().closeAll()
  useAuthStore.getState().logout()
  // 清 React Query 缓存（2026-08-21 审计 C.1 修复）：queryKey 无用户维度 + keepAlive
  // 组件不卸载 + staleTime 5min，不清缓存会让切换账号短暂看到上一账号的销售/账款/审批数据
  queryClient.clear()
  // 清 PDA 待确认请求（2026-08-30 审计）：跨会话残留会命中上一账号的 pending 误报「结果待确认」
  try { localStorage.removeItem('pda_pending_request_confirmations') } catch { /* ignore */ }
  // fire-and-forget：不阻塞本地登出跳转
  void logoutApi(refreshToken)
  redirectReplaceToLogin()
}
