import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'

const AUTH_SESSION_KEY = 'flowcube-auth-v3'

/** 旧版 localStorage 持久化会话；升级后清除，避免长期免密 */
function removeLegacyAuthStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem('flowcube-auth')
    localStorage.removeItem('flowcube-auth-v2')
  } catch {
    /* ignore */
  }
}

removeLegacyAuthStorage()

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  /** JWT 仅存 sessionStorage，关闭浏览器/壳后需重新登录 */
  login: (token: string, user: User) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: (token, user) => {
        set({
          token,
          user,
          isAuthenticated: true,
        })
      },

      logout: () => {
        try {
          sessionStorage.removeItem(AUTH_SESSION_KEY)
        } catch {
          /* ignore */
        }
        set({
          token: null,
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
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => {
        if (!state.token) return {}
        return {
          token: state.token,
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
          state.user = null
          state.isAuthenticated = false
        }
      },
    },
  ),
)
