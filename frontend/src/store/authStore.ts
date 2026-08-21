import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'

const AUTH_SESSION_KEY = 'flowcube-auth-v3'

/**
 * 会话存哪儿：
 * - 生产（桌面包 / PDA APK / Nginx 产物）恒为 sessionStorage——关窗即失效是刻意的安全取向，别放宽。
 * - 仅「本机 dev/preview 服务 + 后端也在本机」时改用 localStorage。sessionStorage 是标签页级隔离的，
 *   每开一个新标签页就是一个空会话（验证 PDA 页面必须开新标签页，见 CLAUDE.md 第 5 节），
 *   调试时被迫反复登录；localStorage 同源共享且跨重启存活，登录一次即可。
 *   连生产后端的 dev（DEV_API_TARGET 指向线上）不在此列：生产 token 不落盘。
 */
const USE_PERSISTENT_DEV_SESSION =
  typeof __DEV_LOCAL_BACKEND__ !== 'undefined' && __DEV_LOCAL_BACKEND__ === true

/** 旧版 localStorage 持久化会话；升级后清除，避免长期免密 */
function removeLegacyAuthStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem('flowcube-auth')
    localStorage.removeItem('flowcube-auth-v2')
    // 非本地开发模式下顺手清掉本机调试时可能留下的持久会话，
    // 避免同一浏览器切到生产 / 连生产后端时残留 token
    if (!USE_PERSISTENT_DEV_SESSION) localStorage.removeItem(AUTH_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

removeLegacyAuthStorage()

interface AuthState {
  token: string | null
  /** refresh token（2026-08-21 权衡修复）：access 2h 过期后自动换新，无需重登 */
  refreshToken: string | null
  user: User | null
  isAuthenticated: boolean
  /** JWT 存 sessionStorage（本地开发连本机后端时为 localStorage），见 USE_PERSISTENT_DEV_SESSION */
  login: (token: string, refreshToken: string | null, user: User) => void
  setTokens: (token: string, refreshToken: string | null) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,

      login: (token, refreshToken, user) => {
        set({
          token,
          refreshToken,
          user,
          isAuthenticated: true,
        })
      },

      /** 刷新成功后更新令牌（2026-08-21 权衡修复） */
      setTokens: (token, refreshToken) => {
        set((state) => ({
          token,
          refreshToken: refreshToken ?? state.refreshToken,
        }))
      },

      logout: () => {
        try {
          // 两处都清：切换存储位置后不留残影
          sessionStorage.removeItem(AUTH_SESSION_KEY)
          localStorage.removeItem(AUTH_SESSION_KEY)
        } catch {
          /* ignore */
        }
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        })
      },

      updateUser: (partial) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        }))
      },
    }),
    {
      name: AUTH_SESSION_KEY,
      storage: createJSONStorage(() => (USE_PERSISTENT_DEV_SESSION ? localStorage : sessionStorage)),
      partialize: (state) => {
        if (!state.token) return {}
        return {
          token: state.token,
          refreshToken: state.refreshToken,
          user: state.user,
          isAuthenticated: true,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.token && state.user) {
          state.isAuthenticated = true
        } else {
          state.token = null
          state.refreshToken = null
          state.user = null
          state.isAuthenticated = false
        }
      },
    },
  ),
)
