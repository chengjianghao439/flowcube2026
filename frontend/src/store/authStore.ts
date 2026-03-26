import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

const AUTH_STORAGE_KEY = 'flowcube-auth-v2'

/** 旧版仅 zustand persist、无「记住我」区分；升级后删除以免长期免密登录 */
function removeLegacyAuthStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem('flowcube-auth')
  } catch {
    /* ignore */
  }
}

removeLegacyAuthStorage()

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  /** 为 true 时才把 token 写入磁盘；false 则仅本次进程有效，关闭应用后需重新登录 */
  rememberLogin: boolean
  login: (token: string, user: User, remember?: boolean) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      rememberLogin: false,

      login: (token, user, remember = false) => {
        set({
          token,
          user,
          isAuthenticated: true,
          rememberLogin: !!remember,
        })
      },

      logout: () => {
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY)
        } catch {
          /* ignore */
        }
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          rememberLogin: false,
        })
      },

      updateUser: (partial) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        }))
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      partialize: (state) => {
        if (state.rememberLogin && state.token) {
          return {
            token: state.token,
            user: state.user,
            rememberLogin: true,
            isAuthenticated: true,
          }
        }
        return {}
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.token && state.rememberLogin) {
          state.isAuthenticated = true
        } else {
          state.token = null
          state.user = null
          state.isAuthenticated = false
          state.rememberLogin = false
        }
      },
    },
  ),
)
